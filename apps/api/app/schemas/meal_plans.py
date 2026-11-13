from datetime import date, time
from uuid import UUID

from pydantic import BaseModel, Field


class MealPlanEntryUpdate(BaseModel):
    scheduled_date: date
    meal_slot: str = Field(
        pattern=r"^(breakfast|brunch|lunch|dinner|snacks|dessert|drink|teatime)$"
    )
    scheduled_time: time | None = None


class MealPlanEntry(BaseModel):
    shared_group_id: UUID | None = None
    shared_group_name: str | None = None
    added_by_name: str | None = None
    can_edit: bool = True
    id: UUID
    recipe_id: UUID
    title: str
    image_url: str | None = None
    scheduled_date: date
    meal_slot: str
    scheduled_time: time | None = None
    total_time: int
    nutrition: dict[str, float] = Field(default_factory=dict)


class MealPlanCalendar(BaseModel):
    start_date: date
    end_date: date
    items: list[MealPlanEntry]


class ShoppingListItem(BaseModel):
    ingredient_id: UUID
    name: str
    quantity: str
    recipe_title: str
    in_kitchen: bool


class PlannedShoppingList(BaseModel):
    start_date: date
    end_date: date
    items: list[ShoppingListItem]
    available_count: int
    missing_count: int
