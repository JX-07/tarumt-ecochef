from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


NotificationCategory = Literal[
    "sensor_alert",
    "ingredient_expiry",
    "meal_reminder",
    "payment",
    "delivery",
    "order",
    "promotion",
    "moderation",
]


class NotificationItem(BaseModel):
    id: UUID
    category: NotificationCategory
    title: str
    message: str
    action_path: str | None = None
    metadata: dict = Field(default_factory=dict)
    created_at: datetime
    read_at: datetime | None = None


class NotificationList(BaseModel):
    items: list[NotificationItem]
    unread_count: int


class NotificationPreferences(BaseModel):
    sensor_alerts: bool = True
    ingredient_expiry: bool = True
    meal_reminders: bool = True
    payment_updates: bool = True
    delivery_updates: bool = True


class SensorAlertInput(BaseModel):
    sensor_id: str = Field(min_length=1, max_length=80)
    alert_code: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=500)
    reading: float | None = None
    unit: str | None = Field(default=None, max_length=20)
    action_path: str | None = Field(default=None, max_length=255)


class PushTokenInput(BaseModel):
    device_id: str = Field(min_length=8, max_length=120)
    expo_push_token: str = Field(min_length=20, max_length=255)
    platform: Literal["android", "ios"]
