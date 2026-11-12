from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error: str
    message: str
    details: Any | None = None
    timestamp: datetime
