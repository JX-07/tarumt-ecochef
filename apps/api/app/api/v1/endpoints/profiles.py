from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.profiles import (
    AccountDeletionRequest,
    Address,
    AddressInput,
    ConsumerProfile,
    ConsumerProfileUpdate,
)

router = APIRouter()
DELETION_RETENTION_DAYS = 30
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


def _profile(session: Session, user: AuthenticatedUser) -> ConsumerProfile:
    row = (
        session.execute(
            text("""
        SELECT u.id, u.firebase_uid, u.name, u.email, u.phone_number, u.bio,
               COALESCE(p.cuisine_preferences, '{}') AS cuisine_preferences,
               COALESCE(p.dietary_restrictions, '{}') AS dietary_restrictions,
               COALESCE(p.allergies, '{}') AS allergies,
               COALESCE(p.food_dislikes, '{}') AS food_dislikes,
               COALESCE(p.profile_visibility, 'public') AS profile_visibility,
               COALESCE(p.preferred_units, 'metric') AS preferred_units
        FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id WHERE u.id = :user_id
        """),
            {"user_id": user.id},
        )
        .mappings()
        .one()
    )
    addresses = (
        session.execute(
            text("""
        SELECT id, label, address_type, address_line_1, address_line_2, city, state,
               postal_code, delivery_note, latitude, longitude, is_default
        FROM addresses WHERE user_id = :user_id ORDER BY is_default DESC, id
        """),
            {"user_id": user.id},
        )
        .mappings()
        .all()
    )
    return ConsumerProfile(**row, addresses=[Address(**address) for address in addresses])


@router.get("/me", response_model=ConsumerProfile)
def get_my_profile(
    current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)
) -> ConsumerProfile:
    return _profile(session, current_user)


@router.put("/me", response_model=ConsumerProfile)
def update_my_profile(
    request: ConsumerProfileUpdate,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> ConsumerProfile:
    session.execute(
        text(
            "UPDATE users SET name = :name, phone_number = :phone_number, bio = :bio WHERE id = :user_id"
        ),
        {
            "name": request.name,
            "phone_number": request.phone_number,
            "bio": request.bio,
            "user_id": current_user.id,
        },
    )
    session.execute(
        text("""
        INSERT INTO user_preferences (user_id, cuisine_preferences, dietary_restrictions, allergies, food_dislikes, profile_visibility, preferred_units, updated_at)
        VALUES (:user_id, :cuisines, :dietary_restrictions, :allergies, :food_dislikes, :profile_visibility, :preferred_units, now())
        ON CONFLICT (user_id) DO UPDATE SET cuisine_preferences = EXCLUDED.cuisine_preferences,
        dietary_restrictions = EXCLUDED.dietary_restrictions, allergies = EXCLUDED.allergies,
        food_dislikes = EXCLUDED.food_dislikes,
        profile_visibility = EXCLUDED.profile_visibility,
        preferred_units = EXCLUDED.preferred_units, updated_at = now()
        """),
        {
            "user_id": current_user.id,
            "cuisines": request.cuisine_preferences,
            "dietary_restrictions": request.dietary_restrictions,
            "allergies": request.allergies,
            "food_dislikes": request.food_dislikes,
            "profile_visibility": request.profile_visibility.value,
            "preferred_units": request.preferred_units.value,
        },
    )
    session.commit()
    return _profile(session, current_user)


@router.post("/me/addresses", response_model=Address, status_code=status.HTTP_201_CREATED)
def add_my_address(
    request: AddressInput,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> Address:
    # Serialize default-address changes for this consumer, including concurrent adds.
    session.execute(
        text("SELECT id FROM users WHERE id = :user_id FOR UPDATE"), {"user_id": current_user.id}
    )
    has_address = session.execute(
        text("SELECT EXISTS(SELECT 1 FROM addresses WHERE user_id = :user_id)"),
        {"user_id": current_user.id},
    ).scalar_one()
    is_default = request.is_default or not has_address
    if is_default:
        session.execute(
            text("UPDATE addresses SET is_default = false WHERE user_id = :user_id"),
            {"user_id": current_user.id},
        )
    address = (
        session.execute(
            text("""
        INSERT INTO addresses (user_id, label, address_type, address_line_1, address_line_2,
                               city, state, postal_code, delivery_note, latitude, longitude, is_default)
        VALUES (:user_id, :label, :address_type, :address_line_1, :address_line_2,
                :city, :state, :postal_code, :delivery_note, :latitude, :longitude, :is_default)
        RETURNING id, label, address_type, address_line_1, address_line_2, city, state,
                  postal_code, delivery_note, latitude, longitude, is_default
        """),
            {
                "user_id": current_user.id,
                **request.model_dump(exclude={"is_default"}),
                "is_default": is_default,
            },
        )
        .mappings()
        .one()
    )
    session.commit()
    return Address(**address)


@router.put("/me/addresses/{address_id}", response_model=Address)
def update_my_address(
    address_id: UUID,
    request: AddressInput,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> Address:
    session.execute(
        text("SELECT id FROM users WHERE id = :user_id FOR UPDATE"), {"user_id": current_user.id}
    )
    existing = session.execute(
        text("SELECT is_default FROM addresses WHERE id = :address_id AND user_id = :user_id"),
        {"address_id": address_id, "user_id": current_user.id},
    ).one_or_none()
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found.")
    # Editing the current default must not silently unset it. Selecting another
    # address as default replaces it atomically.
    is_default = request.is_default or existing.is_default
    if request.is_default:
        session.execute(
            text("UPDATE addresses SET is_default = false WHERE user_id = :user_id"),
            {"user_id": current_user.id},
        )
    address = (
        session.execute(
            text("""
        UPDATE addresses SET label = :label, address_type = :address_type,
               address_line_1 = :address_line_1, address_line_2 = :address_line_2,
               city = :city, state = :state, postal_code = :postal_code,
               delivery_note = :delivery_note, latitude = :latitude, longitude = :longitude,
               is_default = :is_default
        WHERE id = :address_id AND user_id = :user_id
        RETURNING id, label, address_type, address_line_1, address_line_2, city, state,
                  postal_code, delivery_note, latitude, longitude, is_default
        """),
            {
                "address_id": address_id,
                "user_id": current_user.id,
                **request.model_dump(exclude={"is_default"}),
                "is_default": is_default,
            },
        )
        .mappings()
        .one_or_none()
    )
    if address is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found.")
    session.commit()
    return Address(**address)


@router.delete("/me/addresses/{address_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_my_address(
    address_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    session.execute(
        text("SELECT id FROM users WHERE id = :user_id FOR UPDATE"), {"user_id": current_user.id}
    )
    removed = session.execute(
        text(
            "DELETE FROM addresses WHERE id = :address_id AND user_id = :user_id RETURNING is_default"
        ),
        {"address_id": address_id, "user_id": current_user.id},
    ).one_or_none()
    if removed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found.")
    if removed.is_default:
        session.execute(
            text("""
            UPDATE addresses SET is_default = true WHERE id = (
                SELECT id FROM addresses WHERE user_id = :user_id ORDER BY id LIMIT 1
            )
        """),
            {"user_id": current_user.id},
        )
    session.commit()


@router.post(
    "/me/deletion-request",
    response_model=AccountDeletionRequest,
    status_code=status.HTTP_202_ACCEPTED,
)
def request_account_deletion(
    current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)
) -> AccountDeletionRequest:
    existing = session.execute(
        text("""
        SELECT scheduled_for FROM account_deletion_requests WHERE user_id = :user_id
        AND cancelled_at IS NULL AND completed_at IS NULL ORDER BY requested_at DESC LIMIT 1
        """),
        {"user_id": current_user.id},
    ).scalar_one_or_none()
    if existing:
        return AccountDeletionRequest(
            scheduled_for=existing, retention_days=DELETION_RETENTION_DAYS
        )
    scheduled_for = datetime.now(timezone.utc) + timedelta(days=DELETION_RETENTION_DAYS)
    session.execute(
        text(
            "INSERT INTO account_deletion_requests (user_id, scheduled_for) VALUES (:user_id, :scheduled_for)"
        ),
        {"user_id": current_user.id, "scheduled_for": scheduled_for},
    )
    session.commit()
    return AccountDeletionRequest(
        scheduled_for=scheduled_for, retention_days=DELETION_RETENTION_DAYS
    )
