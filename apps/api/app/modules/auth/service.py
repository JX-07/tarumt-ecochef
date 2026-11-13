from dataclasses import dataclass
import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as firebase_auth
from firebase_admin.exceptions import FirebaseError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.firebase import get_firebase_app
from app.db.session import get_db_session
from app.schemas.auth import (
    AccountRole,
    AuthenticatedUser,
    RegisterBusinessOwnerRequest,
    RegisterConsumerRequest,
)

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class FirebaseClaims:
    uid: str
    email: str
    email_verified: bool


def verify_firebase_id_token(token: str) -> FirebaseClaims:
    try:
        decoded = firebase_auth.verify_id_token(
            token, app=get_firebase_app(), check_revoked=True, clock_skew_seconds=60
        )
    except firebase_auth.CertificateFetchError as exc:
        logger.warning(
            "Firebase certificate verification service unavailable (%s)", type(exc).__name__
        )
        raise HTTPException(
            503, "Sign-in verification is temporarily unavailable. Please try again shortly."
        ) from exc
    except FirebaseError as exc:
        logger.warning("Firebase ID token verification failed (%s)", type(exc).__name__)
        if isinstance(exc, firebase_auth.RevokedIdTokenError):
            detail = "Your sign-in session was revoked. Please sign out and sign in again."
        elif isinstance(exc, firebase_auth.ExpiredIdTokenError):
            detail = "Your sign-in session expired. Please sign out and sign in again."
        else:
            detail = "Your sign-in could not be verified. Please sign out and sign in again."
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    email = decoded.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Firebase token has no email."
        )
    return FirebaseClaims(
        uid=decoded["uid"],
        email=email,
        email_verified=bool(decoded.get("email_verified")),
    )


def get_firebase_claims(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> FirebaseClaims:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A Firebase ID token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return verify_firebase_id_token(credentials.credentials)


def get_current_user(
    claims: FirebaseClaims = Depends(get_firebase_claims),
    session: Session = Depends(get_db_session),
) -> AuthenticatedUser:
    if not claims.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your Firebase email address before accessing the EcoChef portal.",
        )

    row = (
        session.execute(
            text(
                """
            SELECT id, firebase_uid, name, email, 'consumer' AS role FROM users WHERE firebase_uid = :uid
            UNION ALL
            SELECT id, firebase_uid, name, email, 'business_owner' AS role
            FROM business_owners WHERE firebase_uid = :uid
            UNION ALL
            SELECT id, firebase_uid, email AS name, email, 'administrator' AS role
            FROM administrators WHERE firebase_uid = :uid
            """
            ),
            {"uid": claims.uid},
        )
        .mappings()
        .all()
    )
    if len(row) != 1:
        detail = (
            "No EcoChef profile is provisioned for this Firebase account."
            if not row
            else "Ambiguous role assignment."
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

    account = row[0]
    return AuthenticatedUser(
        id=account["id"],
        firebase_uid=account["firebase_uid"],
        name=account["name"],
        email=account["email"],
        role=AccountRole(account["role"]),
    )


def require_roles(*allowed_roles: AccountRole):
    def role_guard(
        current_user: AuthenticatedUser = Depends(get_current_user),
    ) -> AuthenticatedUser:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions."
            )
        return current_user

    return role_guard


def register_business_owner(
    request: RegisterBusinessOwnerRequest,
    session: Session,
) -> AuthenticatedUser:
    """Provision Firebase and PostgreSQL together, compensating Firebase on DB failure."""
    try:
        collision = session.execute(
            text(
                """
                SELECT 1 FROM users WHERE lower(email) = lower(:email)
                UNION ALL SELECT 1 FROM business_owners WHERE lower(email) = lower(:email)
                UNION ALL SELECT 1 FROM administrators WHERE lower(email) = lower(:email)
                """
            ),
            {"email": request.email},
        ).first()
    except SQLAlchemyError as exc:
        logger.exception("Database unavailable while checking business registration")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The EcoChef database is temporarily unavailable. No Firebase account was created.",
        ) from exc
    if collision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email already has an EcoChef account.",
        )

    try:
        firebase_user = firebase_auth.create_user(
            email=str(request.email), password=request.password, app=get_firebase_app()
        )
    except FirebaseError as exc:
        if getattr(exc, "code", "") in {"EMAIL_ALREADY_EXISTS", "email-already-exists"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email already has a Firebase account.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase account creation is temporarily unavailable.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected Firebase registration failure")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase account creation is temporarily unavailable. No EcoChef profile was saved.",
        ) from exc

    try:
        profile = (
            session.execute(
                text(
                    """
                INSERT INTO business_owners (name, email, firebase_uid, terms_version, terms_accepted_at)
                VALUES (:name, :email, :uid, :terms_version, now())
                RETURNING id, firebase_uid, name, email
                """
                ),
                {
                    "name": request.name,
                    "email": str(request.email),
                    "uid": firebase_user.uid,
                    "terms_version": request.terms_version,
                },
            )
            .mappings()
            .one()
        )
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        try:
            firebase_auth.delete_user(firebase_user.uid, app=get_firebase_app())
        except FirebaseError:
            logger.exception("Failed to compensate Firebase registration uid=%s", firebase_user.uid)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Registration could not be completed or rolled back. Please contact support before retrying.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The business profile could not be saved. The Firebase account was removed; you can try again.",
        ) from exc

    return AuthenticatedUser(
        id=profile["id"],
        firebase_uid=profile["firebase_uid"],
        name=profile["name"],
        email=profile["email"],
        role=AccountRole.business_owner,
    )


def register_consumer(request: RegisterConsumerRequest, session: Session) -> AuthenticatedUser:
    """Provision Firebase and a consumer profile, removing Firebase if SQL fails."""
    try:
        collision = session.execute(
            text("""
                SELECT 1 FROM users WHERE lower(email) = lower(:email)
                UNION ALL SELECT 1 FROM business_owners WHERE lower(email) = lower(:email)
                UNION ALL SELECT 1 FROM administrators WHERE lower(email) = lower(:email)
            """),
            {"email": request.email},
        ).first()
    except SQLAlchemyError as exc:
        logger.exception("Database unavailable while checking consumer registration")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The EcoChef database is temporarily unavailable. No Firebase account was created.",
        ) from exc
    if collision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email already has an EcoChef account.",
        )

    try:
        firebase_user = firebase_auth.create_user(
            email=str(request.email), password=request.password, app=get_firebase_app()
        )
    except FirebaseError as exc:
        if getattr(exc, "code", "") in {"EMAIL_ALREADY_EXISTS", "email-already-exists"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email already has a Firebase account.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase account creation is temporarily unavailable.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected Firebase consumer registration failure")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase account creation is temporarily unavailable. No EcoChef profile was saved.",
        ) from exc

    try:
        profile = (
            session.execute(
                text("""
                INSERT INTO users (name, email, firebase_uid, terms_version, terms_accepted_at)
                VALUES (:name, :email, :uid, :terms_version, now())
                RETURNING id, firebase_uid, name, email
            """),
                {
                    "name": request.name,
                    "email": str(request.email),
                    "uid": firebase_user.uid,
                    "terms_version": request.terms_version,
                },
            )
            .mappings()
            .one()
        )
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        try:
            firebase_auth.delete_user(firebase_user.uid, app=get_firebase_app())
        except FirebaseError:
            logger.exception("Failed Firebase compensation for consumer uid=%s", firebase_user.uid)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Registration could not be completed or rolled back. Please contact support before retrying.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The EcoChef profile could not be saved. The Firebase account was removed; you can try again.",
        ) from exc

    return AuthenticatedUser(
        id=profile["id"],
        firebase_uid=profile["firebase_uid"],
        name=profile["name"],
        email=profile["email"],
        role=AccountRole.consumer,
    )


def verify_password_reset_eligibility(
    email: str, requested_role: AccountRole, session: Session
) -> None:
    table_by_role = {
        AccountRole.consumer: "users",
        AccountRole.business_owner: "business_owners",
        AccountRole.administrator: "administrators",
    }
    table = table_by_role[requested_role]
    try:
        exists = session.execute(
            text(f"SELECT 1 FROM {table} WHERE lower(email) = lower(:email)"), {"email": email}
        ).first()
    except SQLAlchemyError as exc:
        logger.exception("Database unavailable while checking password-reset eligibility")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="EcoChef could not verify this account right now.",
        ) from exc
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="We could not send password-reset instructions for this email address.",
        )
