import logging
import re
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging

settings = get_settings()
configure_logging()
logger = logging.getLogger(__name__)

app = FastAPI(
    title="EcoChef API",
    version="0.1.0",
    openapi_url=f"{settings.api_prefix}/openapi.json",
    docs_url=f"{settings.api_prefix}/docs",
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix=settings.api_prefix)


def error_response(
    error: str,
    message: str,
    status_code: int,
    details: object = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={
            "error": error,
            "message": message,
            "details": details,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


def cors_error_headers(request: Request) -> dict[str, str] | None:
    """Preserve CORS headers when an exception is handled before middleware can add them."""
    origin = request.headers.get("origin")
    if origin and (
        origin in settings.cors_origins
        or re.fullmatch(r"http://(localhost|127\.0\.0\.1)(:\d+)?", origin)
    ):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return None


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(
        error="validation_error",
        message="Request validation failed.",
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        details=exc.errors(),
        headers=cors_error_headers(_),
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return error_response(
        "http_error", message, exc.status_code, headers=cors_error_headers(request)
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = str(uuid4())
    logger.exception("Unhandled error request_id=%s path=%s", request_id, request.url.path)
    return error_response(
        error="internal_error",
        message="An unexpected error occurred.",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        details={"request_id": request_id},
        headers=cors_error_headers(request),
    )
