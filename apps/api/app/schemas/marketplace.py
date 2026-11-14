from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.vendor import VendorProductAddon


class MarketplacePromotion(BaseModel):
    store_id: UUID | None = None
    id: UUID
    code: str
    title: str
    description: str
    discount_percent: Decimal | None = None
    discount_amount: Decimal | None = None
    minimum_order_amount: Decimal
    free_delivery: bool
    start_date: datetime
    end_date: datetime


class MarketplaceStoreSummary(BaseModel):
    store_closed_today: bool = False
    id: UUID
    name: str
    description: str | None = None
    category: str | None = None
    cover_image_url: str | None = None
    icon_url: str | None = None
    address: str
    rating: Decimal
    review_count: int
    distance_km: float | None = None
    estimated_delivery_minutes: int | None = None
    delivery_fee: Decimal = Decimal("0")
    best_promotion: MarketplacePromotion | None = None


class MarketplaceProduct(BaseModel):
    store_closed_today: bool = False
    id: UUID
    store_id: UUID
    name: str
    description: str | None = None
    image_url: str | None = None
    category: str | None = None
    subcategory: str | None = None
    unit_label: str | None = None
    brand: str | None = None
    size: str | None = None
    price: Decimal
    original_price: Decimal | None = None
    discount_percent: int
    expiry_date: datetime | None = None
    stock_quantity: int
    cart_quantity: int = 0
    addons: list[VendorProductAddon] = Field(default_factory=list)


class MarketplaceReview(BaseModel):
    id: UUID | None = None
    product_id: UUID | None = None
    product_name: str | None = None
    user_id: UUID
    user_name: str
    rating: int
    comment: str | None = None
    date_submitted: datetime


class MarketplaceProductReviewInput(BaseModel):
    rating: int = Field(ge=1, le=5, strict=True)
    comment: str | None = Field(default=None, max_length=2000)

    @field_validator("comment")
    @classmethod
    def clean_comment(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class MarketplaceProductReview(MarketplaceReview):
    id: UUID
    product_id: UUID
    product_name: str
    store_id: UUID


class MarketplaceProductReviewList(BaseModel):
    review_eligibility_reason: str | None = None
    reviews: list[MarketplaceProductReview]
    total: int
    rating: Decimal
    can_review: bool
    my_review: MarketplaceProductReview | None = None


class MarketplaceReviewPrompt(BaseModel):
    product_id: UUID
    product_name: str
    store_id: UUID
    store_name: str
    order_id: UUID
    purchased_at: datetime
    rated_at: datetime | None = None
    reviewed: bool
    rating: int | None = None
    comment: str | None = None


class MarketplaceReviewPromptList(BaseModel):
    items: list[MarketplaceReviewPrompt]


class MarketplaceHolidayClosure(BaseModel):
    starts_on: date
    ends_on: date
    whole_day: bool
    opens_at: time | None = None
    closes_at: time | None = None
    reason: str


class MarketplaceStoreDetail(MarketplaceStoreSummary):
    estimated_pickup_minutes: int | None = None
    closed_today: bool = False
    phone_number: str | None = None
    operating_hours: str | None = None
    operating_hours_schedule: dict[str, dict[str, str | bool]] = Field(default_factory=dict)
    holiday_closure: MarketplaceHolidayClosure | None = None
    is_favourite: bool = False
    latitude: float | None = None
    longitude: float | None = None
    promotions: list[MarketplacePromotion]
    products: list[MarketplaceProduct]


class MarketplaceCategoryStore(MarketplaceStoreSummary):
    products: list[MarketplaceProduct]
    popularity: int
    offer_count: int


class MarketplaceCategoryStoreList(BaseModel):
    category: str
    stores: list[MarketplaceCategoryStore]
    total: int


class MarketplaceSummary(BaseModel):
    deals_active: int
    average_savings_percent: int
    cart_item_count: int


class MarketplaceStoreList(BaseModel):
    stores: list[MarketplaceStoreSummary]
    total: int


class MarketplaceReviewList(BaseModel):
    reviews: list[MarketplaceReview]
    total: int


class MarketplaceLocation(BaseModel):
    name: str | None = None
    address_line_1: str
    city: str = ""
    state: str = ""
    postal_code: str = ""
    latitude: float
    longitude: float


class MarketplaceLocationList(BaseModel):
    locations: list[MarketplaceLocation]


class MarketplaceMapImage(BaseModel):
    data_uri: str


class CartQuantityUpdate(BaseModel):
    quantity: int = Field(ge=1, le=999)
    cart_id: UUID | None = None


class MarketplaceCartItem(BaseModel):
    product: MarketplaceProduct
    store_name: str
    line_total: Decimal


class MarketplaceCartStockAdjustment(BaseModel):
    product_id: UUID
    product_name: str
    previous_quantity: int
    adjusted_quantity: int


class MarketplaceCart(BaseModel):
    checkout_blocked_reason: str | None = None
    id: UUID
    items: list[MarketplaceCartItem]
    item_count: int
    subtotal: Decimal
    delivery_fee: Decimal
    discount: Decimal
    total: Decimal
    applied_promo: MarketplacePromotion | None = None
    stock_adjustments: list[MarketplaceCartStockAdjustment] = Field(default_factory=list)
    estimated_delivery_minutes: int | None = None
    estimated_delivery_distance_km: float | None = None


class PromoApplyRequest(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    store_id: UUID | None = None


class ShopCartRemoveRequest(BaseModel):
    store_ids: list[UUID] = Field(min_length=1, max_length=100)


class ProductReportInput(BaseModel):
    report_request: str = Field(min_length=10, max_length=1000)

    @field_validator("report_request")
    @classmethod
    def validate_report_request(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Report request must contain at least 10 characters.")
        return value


class CheckoutRequest(BaseModel):
    store_id: UUID | None = None
    fulfillment_method: str = Field(default="delivery", pattern="^(delivery|pickup)$")
    address_id: UUID | None = None
    temporary_location: MarketplaceLocation | None = None
    # "card" remains a backward-compatible alias; Stripe still selects eligible methods dynamically.
    payment_method: str = Field(default="stripe", pattern="^(stripe|card)$")
    arrival_at: datetime | None = None

    @model_validator(mode="after")
    def require_one_destination(self) -> "CheckoutRequest":
        if self.fulfillment_method == "pickup" and (
            self.address_id is not None or self.temporary_location is not None
        ):
            raise ValueError("Pickup orders do not use a delivery address.")
        if self.fulfillment_method == "delivery" and (
            (self.address_id is None) == (self.temporary_location is None)
        ):
            raise ValueError("Choose either a saved address or a temporary delivery location.")
        if self.arrival_at is not None:
            if self.arrival_at.tzinfo is None:
                raise ValueError("Scheduled delivery times must include a timezone.")
            now = datetime.now(self.arrival_at.tzinfo)
            if self.arrival_at < now + timedelta(minutes=30):
                raise ValueError(
                    "Schedule at least 30 minutes in the future for preparation and travel."
                )
            if self.arrival_at > now + timedelta(days=7):
                raise ValueError("Orders can only be scheduled up to 7 days ahead.")
        return self


class CheckoutResult(BaseModel):
    order_id: UUID
    payment_status: str
    total: Decimal
    message: str
    checkout_client_secret: str
    checkout_session_id: str
    simulation_available: bool = False


class CheckoutStatusResult(BaseModel):
    order_id: UUID
    payment_status: str
    order_status: str
    total: Decimal
    invoice_url: str | None = None
    invoice_pdf_url: str | None = None
