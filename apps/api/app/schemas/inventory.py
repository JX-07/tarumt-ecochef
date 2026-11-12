from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class InventoryItemInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    quantity: str = Field(min_length=1, max_length=20)
    expiry_date: datetime
    category: str | None = Field(default=None, max_length=50)
    source: str = Field(default="manual", pattern="^(manual|scanned|shopping)$")
    icon: str | None = Field(default=None, max_length=8)

    @field_validator("name", "quantity")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Value cannot be blank.")
        return normalized

    @field_validator("category")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("icon")
    @classmethod
    def normalize_icon(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("expiry_date")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Expiry date must include a timezone.")
        return value.astimezone(timezone.utc)


class InventoryItem(InventoryItemInput):
    id: UUID
    date_recorded: datetime


class InventoryList(BaseModel):
    items: list[InventoryItem]
    total: int
    expiring_soon: int


class InventoryBulkCreateRequest(BaseModel):
    items: list[InventoryItemInput] = Field(min_length=1, max_length=100)


class InventoryBulkCreateResult(BaseModel):
    items: list[InventoryItem]
    created_count: int
