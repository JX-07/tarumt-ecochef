import json
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import get_settings
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.scans import (
    FreshnessAnalysisResult,
    IngredientDetectionResult,
    ScanImageRequest,
)

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


def _post_json(url: str, payload: dict, headers: dict[str, str] | None = None) -> dict:
    request = UrlRequest(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def _gemini_image_json(image: ScanImageRequest, prompt: str, schema: dict) -> dict:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Image analysis is not configured yet. Set the trained model API URL or "
                "GEMINI_API_KEY, then restart the API."
            ),
        )
    payload = {
        "contents": [{"parts": [
            {"text": prompt},
            {"inlineData": {"mimeType": image.content_type, "data": image.data}},
        ]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }
    body = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent",
        payload,
        {"x-goog-api-key": settings.gemini_api_key},
    )
    return json.loads(body["candidates"][0]["content"]["parts"][0]["text"])


def _analysis_error(error: Exception, service_name: str) -> HTTPException:
    if isinstance(error, HTTPError):
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{service_name} rejected the image (HTTP {error.code}).",
        )
    if isinstance(error, (URLError, TimeoutError)):
        return HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"{service_name} did not respond in time. Please try again.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"{service_name} returned an invalid result. Please try another image.",
    )


INGREDIENT_SCHEMA = {
    "type": "OBJECT",
    "properties": {"items": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "name": {"type": "STRING"},
        "confidence": {"type": "NUMBER"},
        "suggested_amount": {"type": "NUMBER"},
        "suggested_unit": {"type": "STRING"},
        "suggested_expiry_days": {"type": "INTEGER"},
        "category": {"type": "STRING"},
    }, "required": ["name", "confidence", "suggested_amount", "suggested_unit", "suggested_expiry_days"]}}},
    "required": ["items"],
}

FRESHNESS_SCHEMA = {
    "type": "OBJECT",
    "properties": {"items": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "name": {"type": "STRING"},
        "status": {"type": "STRING", "enum": ["fresh", "use_soon", "spoiled", "unknown"]},
        "confidence": {"type": "NUMBER"},
        "finding": {"type": "STRING"},
        "spoilage_reasons": {"type": "ARRAY", "items": {"type": "STRING"}},
        "prevention": {"type": "ARRAY", "items": {"type": "STRING"}},
        "safe_to_consume": {"type": "BOOLEAN", "nullable": True},
        "safety_note": {"type": "STRING"},
    }, "required": ["name", "status", "confidence", "finding", "spoilage_reasons", "prevention", "safety_note"]}}},
    "required": ["items"],
}


@router.post("/ingredients", response_model=IngredientDetectionResult)
def detect_ingredients(
    image: ScanImageRequest,
    current_user: AuthenticatedUser = CurrentConsumer,
) -> IngredientDetectionResult:
    del current_user
    settings = get_settings()
    model_error: Exception | None = None
    try:
        if settings.ingredient_detection_api_url:
            try:
                result = _post_json(settings.ingredient_detection_api_url, image.model_dump())
                return IngredientDetectionResult.model_validate({**result, "provider": "food_detection_api"})
            except (HTTPError, URLError, TimeoutError, KeyError, json.JSONDecodeError, ValueError) as error:
                model_error = error
                if not settings.gemini_api_key:
                    raise _analysis_error(error, "Food detection model") from error
        result = _gemini_image_json(
            image,
            "Identify every visible food ingredient. Do not invent hidden items. Return one entry per "
            "ingredient with a concise grocery name, confidence from 0 to 1, estimated amount and unit, "
            "a practical refrigerated shelf-life in days, and an optional food category. Return an empty "
            "items array if no food can be identified.",
            INGREDIENT_SCHEMA,
        )
        return IngredientDetectionResult.model_validate({**result, "provider": "gemini"})
    except HTTPException:
        raise
    except (HTTPError, URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError, ValueError) as error:
        raise _analysis_error(model_error or error, "Food detection") from error


@router.post("/freshness", response_model=FreshnessAnalysisResult)
def analyze_freshness(
    image: ScanImageRequest,
    current_user: AuthenticatedUser = CurrentConsumer,
) -> FreshnessAnalysisResult:
    del current_user
    settings = get_settings()
    model_error: Exception | None = None
    try:
        if settings.freshness_model_api_url:
            try:
                result = _post_json(settings.freshness_model_api_url, image.model_dump())
                return FreshnessAnalysisResult.model_validate({**result, "provider": "freshness_model_api"})
            except (HTTPError, URLError, TimeoutError, KeyError, json.JSONDecodeError, ValueError) as error:
                model_error = error
                if not settings.gemini_api_key:
                    raise _analysis_error(error, "Freshness model") from error
        result = _gemini_image_json(
            image,
            "Assess each visible food item using only visible evidence. Classify as fresh, use_soon, "
            "spoiled, or unknown. Describe the visible finding, likely spoilage reasons, practical "
            "prevention, and whether it appears safe to consume. Be conservative: image analysis cannot "
            "detect pathogens, smell, internal spoilage, or confirm safety. If evidence is unclear set "
            "safe_to_consume to null and status to unknown. Never tell someone to taste food to test it.",
            FRESHNESS_SCHEMA,
        )
        return FreshnessAnalysisResult.model_validate({**result, "provider": "gemini"})
    except HTTPException:
        raise
    except (HTTPError, URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError, ValueError) as error:
        raise _analysis_error(model_error or error, "Freshness analysis") from error
