from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class UnitPreference(str, Enum):
    metric = "metric"
    imperial = "imperial"


class ProfileVisibility(str, Enum):
    public = "public"
    friends_only = "friends_only"
    hidden = "hidden"


class AddressInput(BaseModel):
    label: str | None = Field(default=None, max_length=50)
    address_type: str = Field(default="saved", pattern="^(saved|home|work|school)$")
    address_line_1: str = Field(min_length=1, max_length=255)
    address_line_2: str | None = Field(default=None, max_length=255)
    city: str = Field(default="", max_length=50)
    state: str = Field(default="", max_length=50)
    postal_code: str = Field(default="", max_length=20)
    delivery_note: str | None = Field(default=None, max_length=280)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_default: bool = False


class Address(AddressInput):
    id: UUID


class ConsumerProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    phone_number: str | None = Field(default=None, max_length=30)
    bio: str | None = Field(default=None, max_length=280)
    cuisine_preferences: list[str] = Field(default_factory=list, max_length=20)
    dietary_restrictions: list[str] = Field(default_factory=list, max_length=20)
    allergies: list[str] = Field(default_factory=list, max_length=20)
    food_dislikes: list[str] = Field(default_factory=list, max_length=20)
    profile_visibility: ProfileVisibility = ProfileVisibility.public
    preferred_units: UnitPreference = UnitPreference.metric

    @field_validator("cuisine_preferences", "dietary_restrictions", "allergies", "food_dislikes")
    @classmethod
    def normalize_terms(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values if value.strip()]
        if any(len(value) > 50 for value in normalized):
            raise ValueError("Each preference must be 50 characters or fewer.")
        return list(dict.fromkeys(normalized))


class ConsumerProfile(ConsumerProfileUpdate):
    id: UUID
    firebase_uid: str
    email: str
    addresses: list[Address]


class AccountDeletionRequest(BaseModel):
    scheduled_for: datetime
    retention_days: int
