from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.inventory import (
    InventoryBulkCreateRequest,
    InventoryBulkCreateResult,
    InventoryItem,
    InventoryItemInput,
    InventoryList,
)

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


def _inventory_id(session: Session, user_id: UUID) -> UUID:
    # Two first-time saves must share one kitchen inventory rather than create
    # separate containers and make later updates ambiguous.
    session.execute(text("SELECT id FROM users WHERE id = :user_id FOR UPDATE"), {"user_id": user_id})
    inventory_id = session.execute(
        text("SELECT id FROM ingredient_inventories WHERE user_id = :user_id ORDER BY id LIMIT 1"),
        {"user_id": user_id},
    ).scalar_one_or_none()
    if inventory_id is not None:
        return inventory_id
    return session.execute(
        text("INSERT INTO ingredient_inventories (user_id) VALUES (:user_id) RETURNING id"),
        {"user_id": user_id},
    ).scalar_one()


def _item_from_row(row: object) -> InventoryItem:
    return InventoryItem(
        id=row.id,
        name=row.ingredient_name,
        quantity=row.quantity,
        expiry_date=row.expiry_date,
        category=row.category,
        source=row.ingredient_type,
        icon=row.icon,
        date_recorded=row.date_recorded,
    )


def _insert_inventory_item(
    session: Session,
    inventory_id: UUID,
    request: InventoryItemInput,
) -> InventoryItem:
    ingredient = session.execute(
        text("""
            INSERT INTO ingredients (ingredient_name, category, default_unit, ingredient_type, icon)
            VALUES (:name, :category, NULL, :source, :icon)
            RETURNING id, ingredient_name, category, ingredient_type, icon
        """),
        request.model_dump(include={"name", "category", "source", "icon"}),
    ).one()
    row = session.execute(
        text("""
            INSERT INTO ingredient_inventory_items
                (ingredient_inventory_id, ingredient_id, quantity, expiry_date)
            VALUES (:inventory_id, :ingredient_id, :quantity, :expiry_date)
            RETURNING quantity, expiry_date, date_recorded
        """),
        {
            "inventory_id": inventory_id,
            "ingredient_id": ingredient.id,
            "quantity": request.quantity,
            "expiry_date": request.expiry_date,
        },
    ).one()
    return InventoryItem(
        id=ingredient.id,
        name=ingredient.ingredient_name,
        category=ingredient.category,
        source=ingredient.ingredient_type,
        icon=ingredient.icon,
        quantity=row.quantity,
        expiry_date=row.expiry_date,
        date_recorded=row.date_recorded,
    )


@router.get("/me", response_model=InventoryList)
def get_my_inventory(
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> InventoryList:
    rows = session.execute(
        text("""
            SELECT i.id, i.ingredient_name, i.category, i.ingredient_type, i.icon,
                   item.quantity, item.expiry_date, item.date_recorded
            FROM ingredient_inventories inventory
            JOIN ingredient_inventory_items item ON item.ingredient_inventory_id = inventory.id
            JOIN ingredients i ON i.id = item.ingredient_id
            WHERE inventory.user_id = :user_id
            ORDER BY item.expiry_date, lower(i.ingredient_name)
        """),
        {"user_id": current_user.id},
    ).all()
    items = [_item_from_row(row) for row in rows]
    today = datetime.now(timezone.utc).date()
    expiring_soon = sum(1 for item in items if 0 <= (item.expiry_date.date() - today).days <= 3)
    return InventoryList(items=items, total=len(items), expiring_soon=expiring_soon)


@router.post("/me/items", response_model=InventoryItem, status_code=status.HTTP_201_CREATED)
def add_inventory_item(
    request: InventoryItemInput,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> InventoryItem:
    inventory_id = _inventory_id(session, current_user.id)
    item = _insert_inventory_item(session, inventory_id, request)
    session.commit()
    return item


@router.post("/me/items/bulk", response_model=InventoryBulkCreateResult, status_code=status.HTTP_201_CREATED)
def add_inventory_items(
    request: InventoryBulkCreateRequest,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> InventoryBulkCreateResult:
    """Add a reviewed shopping batch in one database transaction."""
    try:
        inventory_id = _inventory_id(session, current_user.id)
        items = [
            _insert_inventory_item(session, inventory_id, item)
            for item in request.items
        ]
        session.commit()
    except Exception:
        session.rollback()
        raise
    return InventoryBulkCreateResult(items=items, created_count=len(items))


@router.put("/me/items/{item_id}", response_model=InventoryItem)
def update_inventory_item(
    item_id: UUID,
    request: InventoryItemInput,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> InventoryItem:
    row = session.execute(
        text("""
            UPDATE ingredient_inventory_items item
            SET quantity = :quantity, expiry_date = :expiry_date
            FROM ingredient_inventories inventory, ingredients ingredient
            WHERE item.ingredient_inventory_id = inventory.id
              AND item.ingredient_id = ingredient.id
              AND inventory.user_id = :user_id AND ingredient.id = :item_id
            RETURNING item.date_recorded
        """),
        {"user_id": current_user.id, "item_id": item_id, "quantity": request.quantity, "expiry_date": request.expiry_date},
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")
    ingredient = session.execute(
        text("""
            SELECT ingredient_name, category, ingredient_type, icon
            FROM ingredients WHERE id = :item_id
        """),
        {"item_id": item_id},
    ).one()
    saved_item_id = item_id
    if (ingredient.ingredient_name, ingredient.category, ingredient.ingredient_type, ingredient.icon) != (request.name, request.category, request.source, request.icon):
        # Recipes and other inventories can reference this ingredient. Personal
        # edits must never rewrite their ingredient names or metadata.
        saved_item_id = session.execute(text("""
            INSERT INTO ingredients (ingredient_name, category, ingredient_type, icon)
            VALUES (:name, :category, :source, :icon) RETURNING id
        """), {"name": request.name, "category": request.category, "source": request.source, "icon": request.icon}).scalar_one()
        session.execute(text("""
            UPDATE ingredient_inventory_items item SET ingredient_id = :new_id
            FROM ingredient_inventories inventory
            WHERE inventory.id = item.ingredient_inventory_id
              AND inventory.user_id = :user_id AND item.ingredient_id = :old_id
        """), {"new_id": saved_item_id, "old_id": item_id, "user_id": current_user.id})
    session.commit()
    return InventoryItem(
        id=saved_item_id,
        name=request.name,
        category=request.category,
        source=request.source,
        icon=request.icon,
        quantity=request.quantity,
        expiry_date=request.expiry_date,
        date_recorded=row.date_recorded,
    )


@router.delete("/me/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_inventory_item(
    item_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    result = session.execute(
        text("""
            DELETE FROM ingredient_inventory_items item
            USING ingredient_inventories inventory
            WHERE item.ingredient_inventory_id = inventory.id
              AND inventory.user_id = :user_id AND item.ingredient_id = :item_id
        """),
        {"user_id": current_user.id, "item_id": item_id},
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")
    # Ingredient rows are also reused by recipes. Remove the shared row only
    # when no inventory or recipe still references it; the inventory deletion
    # itself must not fail just because the ingredient is in a recipe.
    session.execute(
        text("""
            DELETE FROM ingredients ingredient
            WHERE ingredient.id = :item_id
              AND NOT EXISTS (
                  SELECT 1 FROM ingredient_inventory_items item
                  WHERE item.ingredient_id = ingredient.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM recipe_ingredients recipe_item
                  WHERE recipe_item.ingredient_id = ingredient.id
              )
        """),
        {"item_id": item_id},
    )
    session.commit()
