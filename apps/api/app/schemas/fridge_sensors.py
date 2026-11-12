from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


FreshnessStatus = Literal["excellent", "good", "acceptable", "spoiled", "unknown"]
SensorConnectionStatus = Literal["online", "offline", "waiting"]


class FridgeSensorReading(BaseModel):
    id: int
    captured_at: datetime
    mq3: float
    mq135: float
    mq136: float
    mq137: float
    temperature_c: float
    humidity_percent: float
    freshness_status: FreshnessStatus
    confidence: float | None = None
    model_version: str | None = None


class FridgeSensorSummary(BaseModel):
    id: UUID
    device_code: str
    sensor_name: str
    fridge_name: str
    connection_status: SensorConnectionStatus
    created_at: datetime
    last_seen_at: datetime | None = None
    latest_reading: FridgeSensorReading | None = None


class FridgeSensorList(BaseModel):
    items: list[FridgeSensorSummary]


class PairFridgeSensorRequest(BaseModel):
    device_code: str = Field(min_length=4, max_length=80)
    sensor_name: str = Field(min_length=1, max_length=80)
    fridge_name: str = Field(min_length=1, max_length=80)

    @field_validator("device_code")
    @classmethod
    def normalize_device_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if len(normalized) < 4:
            raise ValueError("Device code must contain at least four non-padding characters.")
        return normalized

    @field_validator("sensor_name", "fridge_name")
    @classmethod
    def trim_names(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Name cannot be blank.")
        return normalized


class PairFridgeSensorResponse(FridgeSensorSummary):
    ingest_key: str


class ClaimFridgeSensorRequest(BaseModel):
    device_code: str | None = Field(default=None, min_length=4, max_length=80)
    claim_secret: str | None = Field(default=None, min_length=24, max_length=200)
    setup_code: str | None = Field(default=None, min_length=10, max_length=32)
    fridge_name: str = Field(min_length=1, max_length=80)
    sensor_name: str = Field(default="EcoChef Sensor Set", min_length=1, max_length=80)

    @field_validator("device_code")
    @classmethod
    def normalize_device_code(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else None

    @field_validator("setup_code")
    @classmethod
    def normalize_setup_code(cls, value: str | None) -> str | None:
        return value.replace("-", "").replace(" ", "").upper() if value else None

    @field_validator("fridge_name", "sensor_name")
    @classmethod
    def trim_names(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Name cannot be blank.")
        return normalized

    @model_validator(mode="after")
    def validate_claim_method(self):
        qr_claim = bool(self.device_code and self.claim_secret)
        manual_claim = bool(self.setup_code)
        if qr_claim == manual_claim:
            raise ValueError("Provide either the QR identity or the printed setup code.")
        return self


class ClaimFridgeSensorResponse(PairFridgeSensorResponse):
    ble_name: str


class ResolveFridgeSensorSetupRequest(BaseModel):
    setup_code: str = Field(min_length=10, max_length=32)

    @field_validator("setup_code")
    @classmethod
    def normalize_setup_code(cls, value: str) -> str:
        return value.replace("-", "").replace(" ", "").upper()


class ResolveFridgeSensorSetupResponse(BaseModel):
    device_code: str
    ble_name: str


class FridgeSensorDetail(FridgeSensorSummary):
    readings: list[FridgeSensorReading]


class FridgeSensorReadingInput(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    captured_at: datetime | None = None
    mq3: float = Field(ge=0)
    mq135: float = Field(ge=0)
    mq136: float = Field(ge=0)
    mq137: float = Field(ge=0)
    temperature_c: float = Field(ge=-40, le=80)
    humidity_percent: float = Field(ge=0, le=100)
    freshness_status: FreshnessStatus = "unknown"
    confidence: float | None = Field(default=None, ge=0, le=1)
    model_version: str | None = Field(default=None, max_length=80)

    @field_validator("captured_at")
    @classmethod
    def validate_capture_time(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Sensor capture time must include a timezone.")
        value = value.astimezone(timezone.utc)
        if value > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError("Sensor capture time cannot be more than five minutes in the future.")
        return value


class FridgeSensorReadingAccepted(BaseModel):
    accepted: Literal[True] = True
    reading_id: int
    alert_created: bool
