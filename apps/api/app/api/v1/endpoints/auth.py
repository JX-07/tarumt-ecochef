from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import auth as firebase_auth
from firebase_admin.exceptions import FirebaseError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.core.firebase import get_firebase_app
from app.modules.auth.service import FirebaseClaims, get_current_user, get_firebase_claims, register_business_owner, register_consumer, require_roles, verify_password_reset_eligibility
from app.schemas.auth import AccountRole, AuthenticatedUser, BusinessProfileUpdate, CreateBusinessOwnerProfileRequest, EmailAvailabilityRequest, PasswordResetEligibilityRequest, RegisterBusinessOwnerRequest, RegisterConsumerRequest

router = APIRouter()


@router.post("/business-email-availability")
def business_email_availability(request: EmailAvailabilityRequest,
                                session: Session = Depends(get_db_session)) -> dict[str, bool]:
    email = str(request.email).lower()
    collision = session.execute(text("""
        SELECT 1 FROM users WHERE lower(email) = :email
        UNION ALL SELECT 1 FROM business_owners WHERE lower(email) = :email
        UNION ALL SELECT 1 FROM administrators WHERE lower(email) = :email
    """), {"email": email}).first()
    if collision:
        return {"available": False}
    try:
        firebase_auth.get_user_by_email(email, app=get_firebase_app())
        return {"available": False}
    except firebase_auth.UserNotFoundError:
        return {"available": True}
    except FirebaseError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Email availability could not be checked right now.") from exc
    except Exception as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Email availability could not be checked right now.") from exc


@router.post("/business-owner-registrations", response_model=AuthenticatedUser, status_code=status.HTTP_201_CREATED)
def register_business_owner_account(
    request: RegisterBusinessOwnerRequest,
    session: Session = Depends(get_db_session),
) -> AuthenticatedUser:
    """Create the Firebase account and business-owner profile as one compensating operation."""
    return register_business_owner(request, session)


@router.post("/consumer-registrations", response_model=AuthenticatedUser, status_code=status.HTTP_201_CREATED)
def register_consumer_account(
    request: RegisterConsumerRequest,
    session: Session = Depends(get_db_session),
) -> AuthenticatedUser:
    return register_consumer(request, session)


@router.post("/password-reset-eligibility", status_code=status.HTTP_204_NO_CONTENT)
def password_reset_eligibility(
    request: PasswordResetEligibilityRequest,
    session: Session = Depends(get_db_session),
) -> None:
    """Only permit the matching EcoChef surface to start a Firebase reset."""
    verify_password_reset_eligibility(request.email, request.requested_role, session)


@router.get("/me", response_model=AuthenticatedUser)
def current_profile(current_user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    """Return the database-backed profile associated with the Firebase ID token."""
    return current_user


@router.put("/me", response_model=AuthenticatedUser)
def update_business_profile(
    request: BusinessProfileUpdate,
    current_user: AuthenticatedUser = Depends(require_roles(AccountRole.business_owner)),
    session: Session = Depends(get_db_session),
) -> AuthenticatedUser:
    profile = session.execute(text("""
        UPDATE business_owners SET name = :name WHERE id = :id
        RETURNING id, firebase_uid, name, email
    """), {"name": request.name.strip(), "id": current_user.id}).mappings().one()
    session.commit()
    return AuthenticatedUser(**profile, role=AccountRole.business_owner)


@router.post("/business-owner-profiles", response_model=AuthenticatedUser, status_code=status.HTTP_201_CREATED)
def create_business_owner_profile(
    request: CreateBusinessOwnerProfileRequest,
    claims: FirebaseClaims = Depends(get_firebase_claims),
    session: Session = Depends(get_db_session),
) -> AuthenticatedUser:
    """Create the portal profile; only a later store approval can make a store public."""
    existing = session.execute(
        text("SELECT id, firebase_uid, name, email FROM business_owners WHERE firebase_uid = :uid"),
        {"uid": claims.uid},
    ).mappings().one_or_none()
    if existing:
        return AuthenticatedUser(
            id=existing["id"], firebase_uid=existing["firebase_uid"], name=existing["name"],
            email=existing["email"], role="business_owner",
        )

    collision = session.execute(
        text(
            """
            SELECT 1 FROM users WHERE firebase_uid = :uid OR lower(email) = lower(:email)
            UNION ALL
            SELECT 1 FROM administrators WHERE firebase_uid = :uid OR lower(email) = lower(:email)
            """
        ),
        {"uid": claims.uid, "email": claims.email},
    ).first()
    if collision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email already has an EcoChef account.")

    profile = session.execute(
        text(
            """
            INSERT INTO business_owners (name, email, firebase_uid)
            VALUES (:name, :email, :uid)
            RETURNING id, firebase_uid, name, email
            """
        ),
        {"name": request.name, "email": claims.email, "uid": claims.uid},
    ).mappings().one()
    session.commit()
    return AuthenticatedUser(
        id=profile["id"], firebase_uid=profile["firebase_uid"], name=profile["name"],
        email=profile["email"], role="business_owner",
    )
