from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel


class PromoCode(BaseModel):
    id: UUID
    code: str
    title: str
    description: str
    discount_percent: Decimal | None
    discount_amount: Decimal | None
    audience: str
    end_date: datetime


class PromoList(BaseModel):
    promos: list[PromoCode]
