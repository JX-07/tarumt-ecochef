import pytest
from pydantic import ValidationError
from app.schemas.recipes import RecipeCreate, RecipeIngredient
from app.services.recipe_ingredient_validation import ingredient_quantity_issues


def item(name, quantity):
    return RecipeIngredient(name=name, quantity=quantity)


def test_extreme_apple_quantity_is_blocked_for_small_recipe():
    assert ingredient_quantity_issues([item("Apples", "100 pcs")], 2)
    with pytest.raises(ValidationError, match="unusually high"):
        RecipeCreate(title="Apple salad", ingredients=[item("Apples", "100 pcs")], instructions=["Slice."], servings=2)


def test_bulk_recipe_is_scaled_by_servings():
    assert not ingredient_quantity_issues([item("Apples", "100 pcs")], 100)


def test_duplicate_ingredients_cannot_bypass_limit():
    assert ingredient_quantity_issues([item("Apple", "15 pcs"), item("Apples", "15 pcs")], 2)


def test_mass_units_are_combined():
    assert ingredient_quantity_issues([item("Flour", "3 kg"), item("Flour", "1500 g")], 2)


@pytest.mark.parametrize("quantity", ["0 g", "-1 pcs", "abc g", "1/0 cup"])
def test_invalid_amounts_are_rejected(quantity):
    assert ingredient_quantity_issues([item("Apple", quantity)], 2)


def test_normal_amounts_and_fractional_measures_are_allowed():
    assert not ingredient_quantity_issues([item("Apples", "2 pcs"), item("Flour", "1 1/2 cup"), item("Salt", "to taste")], 2)


def test_non_name_is_rejected():
    assert ingredient_quantity_issues([item("123", "1 g")], 2)


def test_extreme_seasoning_and_whole_bird_amounts_are_rejected():
    assert ingredient_quantity_issues([item("Salt", "1 kg")], 2)
    assert ingredient_quantity_issues([item("Chicken", "100 pcs")], 2)
