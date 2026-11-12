from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


class AccountRole(str, Enum):
    consumer = "consumer"
    administrator = "administrator"
    business_owner = "business_owner"


class CreateProfileRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    requested_role: AccountRole
    phone_number: str | None = Field(default=None, max_length=30)


class FirebaseIdentity(BaseModel):
    firebase_uid: str = Field(min_length=1, max_length=128)
    email: EmailStr


class CreateBusinessOwnerProfileRequest(BaseModel):
    name: str = Field(min_length=2, max_length=50)


class RegisterBusinessOwnerRequest(CreateBusinessOwnerProfileRequest):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    terms_version: Literal["business-v1-2026-10-21"]
    terms_accepted: Literal[True]

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        requirements = (
            any(character.isupper() for character in value),
            any(character.islower() for character in value),
            any(character.isdigit() for character in value),
            any(not character.isalnum() for character in value),
        )
        if not all(requirements):
            raise ValueError(
                "Password must include one uppercase letter, one lowercase letter, one number, and one symbol."
            )
        return value


class RegisterConsumerRequest(BaseModel):
    name: str = Field(min_length=2, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    terms_version: Literal["consumer-v1-2026-10-21"]
    terms_accepted: Literal[True]


class PasswordResetEligibilityRequest(BaseModel):
    email: EmailStr
    requested_role: AccountRole


class EmailAvailabilityRequest(BaseModel):
    email: EmailStr


class BusinessProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=50)


class AuthenticatedUser(BaseModel):
    id: UUID
    firebase_uid: str
    name: str
    email: EmailStr
    role: AccountRole
