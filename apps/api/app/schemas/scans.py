import base64
import binascii

from pydantic import BaseModel, Field, field_validator


class ScanImageRequest(BaseModel):
    data: str = Field(min_length=32)
    content_type: str = Field(pattern=r"^image\/(jpeg|jpg|png|webp)$")

    @field_validator("data")
    @classmethod
    def validate_image_data(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("The selected image could not be read.") from error
        if len(decoded) > 10 * 1024 * 1024:
            raise ValueError("Scan images must be smaller than 10 MB.")
        return value


class DetectedIngredient(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    confidence: float = Field(ge=0, le=1)
    suggested_amount: float = Field(default=1, gt=0, le=100000)
    suggested_unit: str = Field(default="pcs", min_length=1, max_length=20)
    suggested_expiry_days: int = Field(default=7, ge=0, le=365)
    category: str | None = Field(default=None, max_length=50)


class IngredientDetectionResult(BaseModel):
    items: list[DetectedIngredient] = Field(max_length=30)
    provider: str = Field(default="gemini", pattern="^(food_detection_api|gemini)$")


class FreshnessItem(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    status: str = Field(pattern="^(fresh|use_soon|spoiled|unknown)$")
    confidence: float = Field(ge=0, le=1)
    finding: str = Field(min_length=1, max_length=500)
    spoilage_reasons: list[str] = Field(default_factory=list, max_length=8)
    prevention: list[str] = Field(default_factory=list, max_length=8)
    safe_to_consume: bool | None = None
    safety_note: str = Field(min_length=1, max_length=500)


class FreshnessAnalysisResult(BaseModel):
    items: list[FreshnessItem] = Field(max_length=30)
    provider: str = Field(default="gemini", pattern="^(freshness_model_api|gemini)$")
    disclaimer: str = (
        "AI image assessment cannot confirm food safety. When in doubt, discard the food."
    )
