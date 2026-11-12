from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel


class PurchaseItem(BaseModel):
    name: str
    quantity: int
    unit_price: Decimal


class PurchaseOrder(BaseModel):
    id: UUID
    shop: str
    order_date: datetime
    status: str
    total_amount: Decimal
    items: list[PurchaseItem]


class PurchaseHistory(BaseModel):
    total_spend: Decimal
    transaction_count: int
    orders: list[PurchaseOrder]
