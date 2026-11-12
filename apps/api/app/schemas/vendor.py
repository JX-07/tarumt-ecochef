from datetime import datetime
from decimal import Decimal
from uuid import UUID

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator


class VendorStoreInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    address: str = Field(min_length=5, max_length=255)
    phone_number: str | None = Field(default=None, max_length=20)
    operating_hours: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=50)
    delivery_fee: Decimal = Field(default=Decimal("0"), ge=0)
    estimated_delivery_minutes: int | None = Field(default=None, gt=0, le=1440)
    street_address: str | None = Field(default=None, max_length=255)
    postal_code: str | None = Field(default=None, max_length=20)
    city: str | None = Field(default=None, max_length=80)
    state: str | None = Field(default=None, max_length=80)
    country: str | None = Field(default="Malaysia", max_length=80)
    additional_location_details: str | None = Field(default=None, max_length=255)
    contact_email: str | None = Field(default=None, max_length=100)
    helpline_phones: list[str] = Field(default_factory=list)
    icon_url: str | None = None
    cover_image_url: str | None = None
    slot_order_limit: int = Field(default=10, ge=1, le=1000)
    slot_item_limit: int = Field(default=100, ge=1, le=10000)
    operating_hours_schedule: dict[str, dict[str, str | bool]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_weekly_hours(self) -> "VendorStoreInput":
        total_minutes = 0
        for hours in self.operating_hours_schedule.values():
            if hours.get("closed"):
                continue
            try:
                open_hour, open_minute = map(int, str(hours.get("open", "")).split(":"))
                close_hour, close_minute = map(int, str(hours.get("close", "")).split(":"))
            except (TypeError, ValueError):
                raise ValueError("Invalid Operating Hour Set: enter a valid opening and closing time.")
            if not (0 <= open_hour <= 23 and 0 <= close_hour <= 23 and 0 <= open_minute <= 59 and 0 <= close_minute <= 59):
                raise ValueError("Invalid Operating Hour Set: time is outside the 24-hour clock.")
            duration = close_hour * 60 + close_minute - open_hour * 60 - open_minute
            if duration <= 0:
                raise ValueError("Invalid Operating Hour Set: closing time must be later than opening time.")
            total_minutes += duration
        if total_minutes < 60:
            raise ValueError("Invalid Operating Hour Set: Operation Hour cannot be less than 1 hour")
        return self


class StoreStaffInviteInput(BaseModel):
    email: EmailStr
    assigned_role: str = Field(default="Staff", min_length=2, max_length=60)


class StoreStaffPermissionInput(BaseModel):
    can_edit_store: bool


class VendorProductAddonOption(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    price: Decimal = Field(default=Decimal("0"), ge=0)


class VendorProductAddon(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    required: bool = False
    selection_mode: Literal["single", "multiple"] = "single"
    max_selections: int = Field(default=1, ge=1, le=20)
    options: list[VendorProductAddonOption] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_selection_limit(self) -> "VendorProductAddon":
        if self.selection_mode == "single" and self.max_selections != 1:
            raise ValueError("Single-select add-on groups must allow exactly one selection.")
        if self.max_selections > len(self.options):
            raise ValueError("Maximum selections cannot exceed the number of add-on options.")
        return self


class VendorProductDiscount(BaseModel):
    type: Literal["percentage", "fixed_amount", "buy_x_get_y"]
    value: Decimal | None = Field(default=None, gt=0)
    buy_quantity: int | None = Field(default=None, ge=1, le=100)
    gift_quantity: int | None = Field(default=None, ge=1, le=100)
    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def validate_discount(self) -> "VendorProductDiscount":
        if self.type == "percentage" and (self.value is None or self.value >= 100):
            raise ValueError("Percentage discounts must be greater than 0 and below 100.")
        if self.type == "fixed_amount" and self.value is None:
            raise ValueError("Fixed-amount discounts require a value.")
        if self.type == "buy_x_get_y" and (self.buy_quantity is None or self.gift_quantity is None):
            raise ValueError("Gift discounts require buy and free-item quantities.")
        if self.ends_at <= self.starts_at:
            raise ValueError("The discount end date and time must be after its start.")
        return self


class VendorProductImageUpload(BaseModel):
    data: str = Field(min_length=1)
    content_type: Literal["image/jpeg", "image/png", "image/webp"]


class VendorProductImageUploadResult(BaseModel):
    image_url: str


class VendorProductInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=100)
    price: Decimal = Field(ge=0)
    stock_quantity: int = Field(ge=0)
    category: str | None = Field(default=None, max_length=50)
    subcategory: str | None = Field(default=None, max_length=80)
    unit_label: str | None = Field(default=None, max_length=40)
    brand: str | None = Field(default=None, max_length=100)
    size: str | None = Field(default=None, max_length=40)
    image_url: str | None = None
    original_price: Decimal | None = Field(default=None, ge=0)
    expiry_date: datetime | None = None
    status: str = Field(default="active", pattern="^(active|hidden|sold_out)$")
    addons: list[VendorProductAddon] = Field(default_factory=list, max_length=10)
    discount: VendorProductDiscount | None = None

    @model_validator(mode="after")
    def validate_original_price(self) -> "VendorProductInput":
        if self.original_price is not None and self.original_price < self.price:
            raise ValueError("Original price must be greater than or equal to the listing price.")
        if self.discount and self.discount.type == "fixed_amount" and self.discount.value >= self.price:
            raise ValueError("Fixed discount must be less than the listing price.")
        return self


class VendorProduct(VendorProductInput):
    id: UUID
    store_id: UUID


class VendorPromotionInput(BaseModel):
    promotion_kind: Literal["direct", "coupon"]
    title: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=300)
    discount_type: Literal["percentage", "fixed_amount", "buy_x_get_y"]
    value: Decimal | None = Field(default=None, gt=0)
    buy_quantity: int | None = Field(default=None, ge=1, le=100)
    gift_quantity: int | None = Field(default=None, ge=1, le=100)
    starts_at: datetime
    ends_at: datetime
    product_ids: list[UUID] = Field(default_factory=list, max_length=100)
    code: str | None = Field(default=None, min_length=3, max_length=30, pattern="^[A-Za-z0-9_-]+$")
    minimum_order_amount: Decimal = Field(default=Decimal("0"), ge=0)
    usage_limit: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_promotion(self) -> "VendorPromotionInput":
        if self.ends_at <= self.starts_at:
            raise ValueError("The promotion must end after it starts.")
        if self.discount_type in {"percentage", "fixed_amount"} and self.value is None:
            raise ValueError("Enter a discount value.")
        if self.discount_type == "percentage" and self.value is not None and self.value >= 100:
            raise ValueError("Percentage discounts must be below 100.")
        if self.discount_type == "buy_x_get_y" and (self.buy_quantity is None or self.gift_quantity is None):
            raise ValueError("Enter the purchased and free quantities.")
        if self.promotion_kind == "direct" and not self.product_ids:
            raise ValueError("Select at least one product for a direct promotion.")
        if self.promotion_kind == "coupon" and (not self.code or self.discount_type == "buy_x_get_y"):
            raise ValueError("Coupons require a code and a percentage or fixed discount.")
        return self


class VendorStore(BaseModel):
    id: UUID
    name: str
    address: str
    phone_number: str | None = None
    operating_hours: str | None = None
    description: str | None = None
    category: str | None = None
    status: str
    delivery_fee: Decimal
    estimated_delivery_minutes: int | None = None
    street_address: str | None = None
    postal_code: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    additional_location_details: str | None = None
    contact_email: str | None = None
    helpline_phones: list[str] = Field(default_factory=list)
    icon_url: str | None = None
    cover_image_url: str | None = None
    slot_order_limit: int = Field(default=10, ge=1, le=1000)
    slot_item_limit: int = Field(default=100, ge=1, le=10000)
    operating_hours_schedule: dict[str, dict[str, str | bool]] = Field(default_factory=dict)
    is_owner: bool = True
    can_edit_store: bool = True
    products: list[VendorProduct] = []


class VendorStoreList(BaseModel):
    stores: list[VendorStore]

