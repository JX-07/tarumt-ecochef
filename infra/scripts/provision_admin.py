"""Provision a trusted EcoChef administrator in Firebase and PostgreSQL."""

from __future__ import annotations

import argparse
import secrets

from firebase_admin import auth as firebase_auth
from sqlalchemy import text

from app.core.firebase import get_firebase_app
from app.db.session import SessionLocal


def provision(email: str, access_level: str, name: str | None = None) -> None:
    normalized_email = email.strip().lower()
    display_name = (name or normalized_email.split("@", 1)[0]).strip()
    if len(display_name) < 2 or len(display_name) > 100:
        raise SystemExit("Administrator display name must contain between 2 and 100 characters.")

    with SessionLocal() as session:
        existing = session.execute(
            text(
                """
                SELECT 'consumer' AS role FROM users WHERE lower(email) = :email
                UNION ALL
                SELECT 'business_owner' AS role FROM business_owners WHERE lower(email) = :email
                UNION ALL
                SELECT access_level AS role FROM administrators WHERE lower(email) = :email
                """
            ),
            {"email": normalized_email},
        ).scalars().all()
        if existing:
            raise SystemExit(f"Account already exists in EcoChef with role/access level: {', '.join(existing)}")

    app = get_firebase_app()
    temporary_password: str | None = None
    created_firebase_user = False

    try:
        firebase_user = firebase_auth.get_user_by_email(normalized_email, app=app)
    except firebase_auth.UserNotFoundError:
        temporary_password = "Ec9!" + secrets.token_urlsafe(18)
        firebase_user = firebase_auth.create_user(
            email=normalized_email,
            password=temporary_password,
            email_verified=True,
            app=app,
        )
        created_firebase_user = True

    try:
        with SessionLocal.begin() as session:
            session.execute(
                text(
                    """
                    INSERT INTO administrators (name, access_level, email, firebase_uid)
                    VALUES (:name, :access_level, :email, :firebase_uid)
                    """
                ),
                {
                    "name": display_name,
                    "access_level": access_level,
                    "email": normalized_email,
                    "firebase_uid": firebase_user.uid,
                },
            )
    except Exception:
        if created_firebase_user:
            firebase_auth.delete_user(firebase_user.uid, app=app)
        raise

    print(f"Administrator created: {normalized_email}")
    print(f"Display name: {display_name}")
    print(f"Access level: {access_level}")
    if temporary_password:
        print(f"Temporary password: {temporary_password}")
    else:
        print("Firebase identity already existed; use its existing password or password reset flow.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("email")
    parser.add_argument("--name", help="Initial display name (defaults to the email prefix)")
    parser.add_argument("--access-level", default="super_admin")
    args = parser.parse_args()
    provision(args.email, args.access_level, args.name)
