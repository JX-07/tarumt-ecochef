from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

ItemT = TypeVar("ItemT")


class ApiMetaResponse(BaseModel):
    service: str
    version: str
    timestamp: datetime


class PaginationMeta(BaseModel):
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total_items: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class PaginatedResponse(BaseModel, Generic[ItemT]):
    data: list[ItemT]
    meta: PaginationMeta


class ValidationIssue(BaseModel):
    field: str
    message: str
