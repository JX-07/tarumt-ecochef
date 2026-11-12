from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.meal_plans import MealPlanCalendar, MealPlanEntry, MealPlanEntryUpdate, PlannedShoppingList, ShoppingListItem

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


def _entry(row: object) -> MealPlanEntry:
    return MealPlanEntry(shared_group_id=getattr(row,"shared_group_id",None), shared_group_name=getattr(row,"shared_group_name",None), added_by_name=getattr(row,"added_by_name",None), can_edit=getattr(row,"can_edit",True), id=row.id, recipe_id=row.recipe_id, title=row.title,
        image_url=row.image_url, scheduled_date=row.scheduled_date,
        meal_slot=row.meal_slot, scheduled_time=row.scheduled_time,
        total_time=(row.prep_time or 0) + (row.cook_time or 0), nutrition=dict(row.nutrition or {}))


@router.get("/me", response_model=MealPlanCalendar)
def get_my_meal_plan(start_date: date = Query(default_factory=date.today),
    days: int = Query(default=7, ge=1, le=31),
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session)) -> MealPlanCalendar:
    end_date = start_date + timedelta(days=days - 1)
    rows = session.execute(text("""
        SELECT entry.id, entry.recipe_id, entry.scheduled_date, entry.meal_slot,
               entry.scheduled_time, recipe.title, recipe.image_url,
               recipe.prep_time, recipe.cook_time, recipe.nutrition, entry.shared_group_id,
               (SELECT CASE WHEN grp.group_name = 'Cooking group' THEN host.name || '''s Cooking Group' ELSE grp.group_name END
                FROM user_groups grp JOIN users host ON host.id=grp.created_by_user_id WHERE grp.id=entry.shared_group_id) AS shared_group_name,
               (SELECT name FROM users WHERE id=plan.user_id) AS added_by_name,
               (plan.user_id=:user_id) AS can_edit
        FROM meal_plan_recipes entry
        JOIN meal_plans plan ON plan.id = entry.meal_plan_id
        JOIN recipes recipe ON recipe.id = entry.recipe_id
        WHERE (plan.user_id = :user_id OR (entry.shared_group_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM group_members viewer WHERE viewer.group_id=entry.shared_group_id AND viewer.user_id=:user_id AND viewer.status='active')
          AND EXISTS (SELECT 1 FROM group_members author WHERE author.group_id=entry.shared_group_id AND author.user_id=plan.user_id AND author.status='active')))
          AND entry.scheduled_date BETWEEN :start_date AND :end_date
        ORDER BY entry.scheduled_date,
          CASE WHEN entry.scheduled_time IS NULL THEN 1 ELSE 0 END,
          entry.scheduled_time,
          CASE entry.meal_slot
            WHEN 'drink' THEN 1 WHEN 'breakfast' THEN 2 WHEN 'brunch' THEN 3
            WHEN 'lunch' THEN 4 WHEN 'teatime' THEN 5 WHEN 'dinner' THEN 6
            WHEN 'dessert' THEN 7 WHEN 'snacks' THEN 8 ELSE 9 END,
          lower(recipe.title)
    """), {"user_id": current_user.id, "start_date": start_date, "end_date": end_date}).all()
    return MealPlanCalendar(start_date=start_date, end_date=end_date, items=[_entry(row) for row in rows])


@router.get("/me/shopping-list", response_model=PlannedShoppingList)
def get_my_shopping_list(start_date: date, end_date: date,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session)) -> PlannedShoppingList:
    if end_date < start_date or (end_date - start_date).days >= 31:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose a range of up to 31 days.")
    rows = session.execute(text("""
        SELECT ingredient.id AS ingredient_id, ingredient.ingredient_name AS name,
               recipe_ingredient.quantity, recipe.title AS recipe_title,
               EXISTS (
                   SELECT 1 FROM ingredient_inventories inventory
                   JOIN ingredient_inventory_items inventory_item
                     ON inventory_item.ingredient_inventory_id = inventory.id
                   JOIN ingredients stocked ON stocked.id = inventory_item.ingredient_id
                   WHERE inventory.user_id = :user_id
                     AND lower(stocked.ingredient_name) = lower(ingredient.ingredient_name)
                     AND (inventory_item.expiry_date AT TIME ZONE 'Asia/Kuala_Lumpur')::date >= entry.scheduled_date
               ) AS in_kitchen
        FROM meal_plan_recipes entry
        JOIN meal_plans plan ON plan.id = entry.meal_plan_id
        JOIN recipes recipe ON recipe.id = entry.recipe_id
        JOIN recipe_ingredients recipe_ingredient ON recipe_ingredient.recipe_id = recipe.id
        JOIN ingredients ingredient ON ingredient.id = recipe_ingredient.ingredient_id
        WHERE (plan.user_id = :user_id OR (entry.shared_group_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM group_members viewer WHERE viewer.group_id=entry.shared_group_id AND viewer.user_id=:user_id AND viewer.status='active')
          AND EXISTS (SELECT 1 FROM group_members author WHERE author.group_id=entry.shared_group_id AND author.user_id=plan.user_id AND author.status='active')))
          AND entry.scheduled_date BETWEEN :start_date AND :end_date
        ORDER BY in_kitchen DESC, lower(ingredient.ingredient_name), lower(recipe.title)
    """), {"user_id": current_user.id, "start_date": start_date, "end_date": end_date}).all()
    items = [ShoppingListItem(**row._mapping) for row in rows]
    available_count = sum(item.in_kitchen for item in items)
    return PlannedShoppingList(start_date=start_date, end_date=end_date, items=items,
        available_count=available_count, missing_count=len(items) - available_count)


@router.put("/me/entries/{entry_id}", response_model=MealPlanEntry)
def update_meal_plan_entry(entry_id: UUID, request: MealPlanEntryUpdate,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session)) -> MealPlanEntry:
    row = session.execute(text("""
        UPDATE meal_plan_recipes entry
        SET scheduled_date = :scheduled_date, meal_slot = :meal_slot,
            scheduled_time = :scheduled_time
        FROM meal_plans plan, recipes recipe
        WHERE entry.id = :entry_id AND plan.id = entry.meal_plan_id
          AND plan.user_id = :user_id AND recipe.id = entry.recipe_id
        RETURNING entry.id, entry.recipe_id, entry.scheduled_date, entry.meal_slot,
                  entry.scheduled_time, recipe.title, recipe.image_url,
                  recipe.prep_time, recipe.cook_time, recipe.nutrition, entry.shared_group_id,
                  (SELECT CASE WHEN grp.group_name = 'Cooking group' THEN host.name || '''s Cooking Group' ELSE grp.group_name END
                   FROM user_groups grp JOIN users host ON host.id=grp.created_by_user_id WHERE grp.id=entry.shared_group_id) AS shared_group_name,
                  (SELECT name FROM users WHERE id=plan.user_id) AS added_by_name
    """), {"entry_id": entry_id, "user_id": current_user.id, **request.model_dump()}).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal-plan entry not found.")
    session.commit()
    return _entry(row)


@router.delete("/me/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal_plan_entry(entry_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session)) -> None:
    removed = session.execute(text("""
        DELETE FROM meal_plan_recipes entry USING meal_plans plan
        WHERE entry.id = :entry_id AND plan.id = entry.meal_plan_id
          AND plan.user_id = :user_id RETURNING entry.id
    """), {"entry_id": entry_id, "user_id": current_user.id}).scalar_one_or_none()
    if removed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal-plan entry not found.")
    session.commit()
