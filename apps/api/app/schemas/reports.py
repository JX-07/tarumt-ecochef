from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


ReportCategory = Literal['misinformation','inappropriate_content','other']


class ContentReportInput(BaseModel):
    subject_type: Literal['recipe', 'store']
    subject_id: UUID
    product_id: UUID | None = None
    category: ReportCategory
    description: str = Field(min_length=10, max_length=2000)

    @field_validator('description')
    @classmethod
    def clean_description(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 10:
            raise ValueError('Please explain the issue in at least 10 characters.')
        return value


class DecisionNote(BaseModel):
    note: str = Field(min_length=10, max_length=1000)

    @field_validator('note')
    @classmethod
    def clean_note(cls, value: str) -> str:
        if len(value.strip()) < 10:
            raise ValueError('Explain the decision in at least 10 characters.')
        return value.strip()


class ReportDecision(DecisionNote):
    decision: Literal['upheld', 'dismissed']
    expected_pending_count: int = Field(ge=1)


class FeedbackFlagDecision(DecisionNote):
    decision: Literal['dismissed', 'removed']
