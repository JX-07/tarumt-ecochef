from datetime import datetime, timezone

from fastapi import APIRouter

from app.schemas.common import ApiMetaResponse

router = APIRouter()


@router.get("/meta", response_model=ApiMetaResponse)
def api_meta() -> ApiMetaResponse:
    return ApiMetaResponse(
        service="EcoChef API",
        version="v1",
        timestamp=datetime.now(timezone.utc),
    )
