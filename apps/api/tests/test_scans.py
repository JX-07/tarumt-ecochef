import base64
from types import SimpleNamespace
from urllib.error import URLError
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints import scans
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.scans import ScanImageRequest


def _image() -> ScanImageRequest:
    return ScanImageRequest(
        data=base64.b64encode(b"test-image-content" * 3).decode("ascii"),
        content_type="image/jpeg",
    )


def _consumer() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(),
        firebase_uid="scan-test",
        name="Scan Tester",
        email="scan@example.com",
        role=AccountRole.consumer,
    )


def test_scan_image_rejects_invalid_base64() -> None:
    with pytest.raises(ValidationError):
        ScanImageRequest(data="not-valid-base64-data-value-xxxxxxxx", content_type="image/jpeg")


def test_ingredient_scan_prefers_trained_service(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scans, "get_settings", lambda: SimpleNamespace(ingredient_detection_api_url="http://detector.local"))
    monkeypatch.setattr(scans, "_post_json", lambda *_: {"items": [{
        "name": "Spinach", "confidence": 0.94, "suggested_amount": 1,
        "suggested_unit": "bunch", "suggested_expiry_days": 4,
    }]})
    result = scans.detect_ingredients(_image(), _consumer())
    assert result.provider == "food_detection_api"
    assert result.items[0].name == "Spinach"


def test_freshness_scan_uses_gemini_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scans, "get_settings", lambda: SimpleNamespace(freshness_model_api_url=None))
    monkeypatch.setattr(scans, "_gemini_image_json", lambda *_: {"items": [{
        "name": "Tomato", "status": "use_soon", "confidence": 0.86,
        "finding": "Wrinkling is visible.", "spoilage_reasons": ["Moisture loss"],
        "prevention": ["Keep refrigerated"], "safe_to_consume": True,
        "safety_note": "Use promptly and discard if there is mold or an off smell.",
    }]})
    result = scans.analyze_freshness(_image(), _consumer())
    assert result.provider == "gemini"
    assert result.items[0].status == "use_soon"
    assert "cannot confirm food safety" in result.disclaimer


def test_ingredient_scan_falls_back_when_trained_service_is_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(scans, "get_settings", lambda: SimpleNamespace(
        ingredient_detection_api_url="http://detector.local",
        gemini_api_key="configured",
    ))
    monkeypatch.setattr(scans, "_post_json", lambda *_: (_ for _ in ()).throw(URLError("offline")))
    monkeypatch.setattr(scans, "_gemini_image_json", lambda *_: {"items": [{
        "name": "Carrot", "confidence": 0.81, "suggested_amount": 2,
        "suggested_unit": "pcs", "suggested_expiry_days": 7,
    }]})
    result = scans.detect_ingredients(_image(), _consumer())
    assert result.provider == "gemini"
    assert result.items[0].name == "Carrot"
