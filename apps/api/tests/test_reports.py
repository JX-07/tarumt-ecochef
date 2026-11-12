"""Report contracts and route authorization without external credentials or services."""
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
import pytest

from app.api.v1.endpoints import reports
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.reports import ContentReportInput, FeedbackFlagDecision, ReportDecision


@pytest.mark.parametrize("description",[" "*20,"too short","x"*2001])
def test_reports_require_a_meaningful_bounded_description(description):
    with pytest.raises(ValidationError):
        ContentReportInput(subject_type="recipe",subject_id=uuid4(),category="misinformation",description=description)


def test_feedback_flag_decisions_are_separate_from_content_report_decisions():
    with pytest.raises(ValidationError):
        FeedbackFlagDecision(decision="upheld",note="This is the detailed decision.")
    with pytest.raises(ValidationError):
        ReportDecision(decision="removed",note="This is the detailed decision.")


@pytest.mark.parametrize("role",[AccountRole.consumer,AccountRole.business_owner])
def test_non_moderators_cannot_read_or_decide_moderation_tasks(role):
    actor = AuthenticatedUser(id=uuid4(),firebase_uid="audit-user",name="Audit user",email="audit@example.com",role=role)
    paths = {
        "/moderation",
        "/moderation/issues/{issue_id}/decision",
        "/moderation/feedback-flags/{flag_id}/decision",
    }
    routes = [route for route in reports.router.routes if route.path in paths]
    assert {route.path for route in routes} == paths
    for route in routes:
        # Exercise each route's actual authorization dependency, rather than
        # calling an endpoint directly (which deliberately bypasses DI).
        guard = next(dependency.call for dependency in route.dependant.dependencies if dependency.name == "current_user")
        with pytest.raises(HTTPException) as denied:
            guard(current_user=actor)
        assert denied.value.status_code == 403



@pytest.mark.parametrize("category",["misleading_listing","food_safety","harassment","spam"])
def test_removed_categories_cannot_be_submitted(category):
    with pytest.raises(ValidationError):
        ContentReportInput(subject_type="store",subject_id=uuid4(),category=category,description="Details of the issue being reported.")


def test_report_category_picker_only_contains_supported_choices():
    assert {item["id"] for item in reports.CATEGORIES} == {"misinformation","inappropriate_content","other"}
