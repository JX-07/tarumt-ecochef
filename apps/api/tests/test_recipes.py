from app.schemas.recipes import RecipeCatalogueQuery, RecipeCreate, RecipeIngredient, RecipeSafetyProfile, RecipeScheduleInput, recipe_safety_warnings
from pydantic import ValidationError
import pytest


def test_recipe_query_normalizes_filters() -> None:
    query = RecipeCatalogueQuery(search="  Green   Curry ", dietary_tag=" Vegetarian ")
    assert query.search == "green curry"
    assert query.dietary_tag == "vegetarian"


def test_recipe_safety_warnings_match_allergies_and_diet() -> None:
    profile = RecipeSafetyProfile(allergies=[" Peanuts "], dietary_restrictions=["vegetarian"])
    warnings = recipe_safety_warnings(["peanuts", "soy"], ["gluten-free"], profile)
    assert warnings == ["Contains peanuts", "Not confirmed suitable for vegetarian"]


def test_recipe_safety_warnings_accept_matching_diet() -> None:
    profile = RecipeSafetyProfile(dietary_restrictions=["vegetarian"])
    assert recipe_safety_warnings([], ["vegetarian"], profile) == []


def test_recipe_create_normalizes_author_content() -> None:
    recipe = RecipeCreate(title="  Green   Curry ", instructions=["  Simmer gently  "], ingredients=[RecipeIngredient(name=" coconut milk ", quantity=" 400 ml ")])
    assert recipe.title == "Green Curry"
    assert recipe.instructions == ["Simmer gently"]
    assert recipe.ingredients[0].quantity == "400 ml"


def test_recipe_ingredient_accepts_and_preserves_chinese_text() -> None:
    ingredient = RecipeIngredient(name="  青葱  ", quantity=" 2 根 ")
    assert ingredient.name == "青葱"
    assert ingredient.quantity == "2 根"


def test_recipe_rejects_multiple_meal_type_tags() -> None:
    with pytest.raises(ValidationError, match="Choose only one meal type"):
        RecipeCreate(title="Toast", instructions=["Toast"], ingredients=[RecipeIngredient(name="Bread", quantity="2 slices")], dietary_tags=["breakfast", "brunch"])


def test_recipe_rejects_dietary_tag_that_conflicts_with_ingredients() -> None:
    with pytest.raises(ValidationError, match="vegan tag conflicts"):
        RecipeCreate(title="Cheese Toast", instructions=["Toast"], ingredients=[RecipeIngredient(name="Cheese", quantity="20 g")], dietary_tags=["vegan"])


def test_recipe_schedule_validates_date_meal_and_time() -> None:
    schedule = RecipeScheduleInput(scheduled_date="2026-10-14", meal_slot="dinner", scheduled_time="19:30")
    assert schedule.meal_slot == "dinner"


from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4
from fastapi import HTTPException
from app.api.v1.endpoints import recipes
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.recipes import RecipeReviewInput, RecipeFeedbackFlagInput


def _review_user():
    return AuthenticatedUser(id=uuid4(),firebase_uid="review-user",name="Recipe tester",email="tester@example.com",role=AccountRole.consumer)


def _result(**values):
    result = Mock()
    for method, value in values.items():
        getattr(result,method).return_value = value
    result.mappings.return_value = result
    return result


def test_recipe_feedback_requires_server_recorded_use():
    user, session = _review_user(), Mock()
    session.execute.side_effect = [_result(one_or_none=SimpleNamespace(user_id=uuid4())),_result(scalar_one_or_none=None)]
    with pytest.raises(HTTPException) as error:
        recipes.review_recipe(uuid4(),RecipeReviewInput(rating=4),user,session)
    assert error.value.status_code == 403
    session.commit.assert_not_called()


def test_recipe_author_cannot_review_own_recipe():
    user, session = _review_user(), Mock()
    session.execute.return_value = _result(one_or_none=SimpleNamespace(user_id=user.id))
    with pytest.raises(HTTPException) as error:
        recipes.review_recipe(uuid4(),RecipeReviewInput(rating=4),user,session)
    assert error.value.status_code == 400


def test_recipe_cook_now_records_eligibility_for_authenticated_user():
    user, session, recipe_id = _review_user(), Mock(), uuid4()
    session.execute.return_value = _result(scalar_one_or_none=1)
    recipes.start_recipe_cooking(recipe_id,user,session)
    calls = session.execute.call_args_list
    assert "INSERT INTO recipe_review_eligibility" in str(calls[1].args[0])
    assert calls[1].args[1] == {"recipe_id":recipe_id,"user_id":user.id,"action":"cook_now"}
    session.commit.assert_called_once()


def test_schedule_later_records_eligibility_in_same_transaction():
    user, session, recipe_id = _review_user(), Mock(), uuid4()
    session.execute.side_effect = [_result(scalar_one_or_none=None),_result(scalar_one_or_none=1),_result(scalar_one_or_none=uuid4()),Mock(),Mock()]
    recipes.schedule_recipe(recipe_id,RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="dinner"),user,session)
    assert session.execute.call_args_list[-1].args[1]["action"] == "schedule_later"
    session.commit.assert_called_once()


def test_recipe_feedback_after_use_returns_one_review_and_normalizes_comment():
    user, session, recipe_id = _review_user(), Mock(), uuid4()
    feedback_id = uuid4()
    session.execute.side_effect = [
        _result(one_or_none=SimpleNamespace(user_id=uuid4())), _result(scalar_one_or_none=1), Mock(),
        _result(one_or_none=None), _result(one={"id":feedback_id,"user_id":user.id,"rating":5,"comment":"Very good","date_submitted":datetime.now(timezone.utc)})]
    review = recipes.review_recipe(recipe_id,RecipeReviewInput(rating=5,comment=" Very  good "),user,session)
    assert review.id == feedback_id and review.is_mine
    assert "eligibility_verified=true" in str(session.execute.call_args_list[-1].args[0])
    assert "ON CONFLICT (recipe_id, user_id)" in str(session.execute.call_args_list[-1].args[0])
    assert session.execute.call_args_list[-1].args[1]["comment"] == "Very good"


@pytest.mark.parametrize("removed,flag_id", [(datetime.now(timezone.utc),None),(None,uuid4())])
def test_moderated_recipe_feedback_cannot_be_overwritten(removed,flag_id):
    user, session = _review_user(), Mock()
    session.execute.side_effect = [_result(one_or_none=SimpleNamespace(user_id=uuid4())),_result(scalar_one_or_none=1),Mock(),_result(one_or_none=SimpleNamespace(removed_at=removed,flag_id=flag_id))]
    with pytest.raises(HTTPException) as error:
        recipes.review_recipe(uuid4(),RecipeReviewInput(rating=4),user,session)
    assert error.value.status_code == 409
    session.commit.assert_not_called()


def test_only_recipe_author_can_flag_feedback():
    user, session = _review_user(), Mock()
    session.execute.return_value = _result(one_or_none=SimpleNamespace(user_id=uuid4(),author_id=uuid4()))
    with pytest.raises(HTTPException) as error:
        recipes.flag_recipe_feedback(uuid4(),uuid4(),RecipeFeedbackFlagInput(description="This is factually incorrect."),user,session)
    assert error.value.status_code == 403
    session.commit.assert_not_called()


def test_author_flag_is_created_once_and_requires_explanation():
    with pytest.raises(ValidationError):
        RecipeFeedbackFlagInput(description="          ")
    user, session = _review_user(), Mock()
    session.execute.side_effect = [_result(one_or_none=SimpleNamespace(user_id=uuid4(),author_id=user.id)),Mock(),_result(one_or_none={"id":uuid4(),"status":"pending","created_at":datetime.now(timezone.utc)})]
    row = recipes.flag_recipe_feedback(uuid4(),uuid4(),RecipeFeedbackFlagInput(description="The ingredients do not contain the claimed allergen."),user,session)
    assert row["status"] == "pending"
    assert "ON CONFLICT(feedback_id) DO NOTHING" in str(session.execute.call_args_list[-1].args[0])
    session.commit.assert_called_once()


@pytest.mark.parametrize("verified,flag,removed,expected", [
    (False,None,None,"unverified"), (True,None,None,None),
    (True,"pending",None,"pending"), (False,"dismissed",None,"dismissed"),
    (True,"removed",datetime.now(timezone.utc),"removed"),
])
def test_recipe_feedback_visibility_preserves_moderation_and_legacy_status(verified,flag,removed,expected):
    feedback = SimpleNamespace(eligibility_verified=verified,status=flag,removed_at=removed)
    assert recipes._feedback_visibility_status(feedback) == expected


def test_no_previous_recipe_feedback_has_no_private_visibility_state():
    assert recipes._feedback_visibility_status(None) is None
