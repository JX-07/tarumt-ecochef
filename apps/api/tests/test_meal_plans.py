from datetime import date, time, timedelta
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.meal_plans import MealPlanEntryUpdate
from app.api.v1.endpoints import meal_plans
from fastapi import HTTPException


def test_shopping_range_is_at_most_31_inclusive_calendar_days():
    session, user = Mock(), SimpleNamespace(id=uuid4())
    session.execute.return_value.all.return_value = []
    start = date(2026, 11, 1)
    result = meal_plans.get_my_shopping_list(start, start + timedelta(days=30), user, session)
    assert result.items == []
    with pytest.raises(HTTPException) as error:
        meal_plans.get_my_shopping_list(start, start + timedelta(days=31), user, session)
    assert error.value.status_code == 422


def test_meal_plan_entry_parses_calendar_values() -> None:
    entry = MealPlanEntryUpdate(
        scheduled_date="2026-10-14", meal_slot="dinner", scheduled_time="19:30"
    )
    assert entry.scheduled_date == date(2026, 10, 14)
    assert entry.scheduled_time == time(19, 30)


def test_meal_plan_entry_rejects_invalid_slot() -> None:
    with pytest.raises(ValidationError):
        MealPlanEntryUpdate(scheduled_date="2026-10-14", meal_slot="midnight")


def test_meal_plan_entry_rejects_impossible_date() -> None:
    with pytest.raises(ValidationError):
        MealPlanEntryUpdate(scheduled_date="2026-02-30", meal_slot="lunch")


def test_shared_meal_includes_its_group_name() -> None:
    row = SimpleNamespace(
        id=uuid4(), recipe_id=uuid4(), title="Dinner", image_url=None,
        scheduled_date=date(2026, 11, 7), meal_slot="dinner", scheduled_time=None,
        prep_time=10, cook_time=20, nutrition={}, shared_group_id=uuid4(),
        shared_group_name="Ahmad's Cooking Group", added_by_name="Ahmad",
        can_edit=False,
    )

    entry = meal_plans._entry(row)

    assert entry.shared_group_name == "Ahmad's Cooking Group"
    assert entry.can_edit is False
