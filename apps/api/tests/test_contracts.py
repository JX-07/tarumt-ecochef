import pytest
from pydantic import ValidationError

from app.schemas.auth import AccountRole, CreateProfileRequest, FirebaseIdentity, RegisterBusinessOwnerRequest
from app.schemas.common import PaginationMeta, PaginatedResponse


def test_firebase_profile_contract() -> None:
    request = CreateProfileRequest(
        name="Eco Chef",
        requested_role=AccountRole.consumer,
    )
    identity = FirebaseIdentity(firebase_uid="firebase-user-123", email="chef@example.com")

    assert request.requested_role is AccountRole.consumer
    assert identity.firebase_uid == "firebase-user-123"


def test_pagination_contract() -> None:
    response = PaginatedResponse[str](
        data=["recipe-1"],
        meta=PaginationMeta(page=1, page_size=20, total_items=1, total_pages=1),
    )

    assert response.meta.total_items == 1


def test_business_registration_contract_requires_a_strong_password() -> None:
    request = RegisterBusinessOwnerRequest(
        name="Eco Owner",
        email="owner@example.com",
        password="Safe-password1",
        terms_version="business-v1-2026-10-21",
        terms_accepted=True,
    )

    assert request.email == "owner@example.com"


@pytest.mark.parametrize("password", ["lowercase1!", "UPPERCASE1!", "NoNumber!", "NoSymbol1"])
def test_business_registration_contract_rejects_passwords_missing_a_required_character_type(password: str) -> None:
    with pytest.raises(ValidationError):
        RegisterBusinessOwnerRequest(
            name="Eco Owner",
            email="owner@example.com",
            password=password,
            terms_version="business-v1-2026-10-21",
            terms_accepted=True,
        )
