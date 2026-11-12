from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.inventory import InventoryBulkCreateRequest, InventoryItem, InventoryItemInput
from app.api.v1.endpoints import inventory as inventory_endpoint
from app.schemas.auth import AccountRole, AuthenticatedUser


def test_inventory_item_normalizes_text() -> None:
    item = InventoryItemInput(
        name="  Baby   spinach ",
        quantity=" 1   bunch ",
        expiry_date=datetime(2026, 10, 15, tzinfo=timezone.utc),
    )
    assert item.name == "Baby spinach"
    assert item.quantity == "1 bunch"
    assert item.source == "manual"
    assert item.icon is None


def test_inventory_item_rejects_naive_expiry_date() -> None:
    with pytest.raises(ValidationError):
        InventoryItemInput(name="Eggs", quantity="6 pcs", expiry_date=datetime(2026, 10, 15))


def test_inventory_bulk_request_requires_at_least_one_item() -> None:
    with pytest.raises(ValidationError):
        InventoryBulkCreateRequest(items=[])


def test_inventory_bulk_request_normalizes_each_item() -> None:
    request = InventoryBulkCreateRequest(items=[{
        "name": "  Brown   rice ",
        "quantity": " 2   kg ",
        "expiry_date": datetime(2027, 1, 1, tzinfo=timezone.utc),
        "source": "shopping",
    }])
    assert request.items[0].name == "Brown rice"
    assert request.items[0].quantity == "2 kg"


def _consumer() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(),
        firebase_uid="firebase-user",
        name="Test Chef",
        email="chef@example.com",
        role=AccountRole.consumer,
    )


def _bulk_request() -> InventoryBulkCreateRequest:
    return InventoryBulkCreateRequest(items=[{
        "name": "Brown rice",
        "quantity": "2 kg",
        "expiry_date": datetime(2027, 1, 1, tzinfo=timezone.utc),
        "source": "shopping",
    }])


def test_bulk_inventory_completion_commits_once(monkeypatch: pytest.MonkeyPatch) -> None:
    session = Mock()
    inventory_id = uuid4()
    created = InventoryItem(
        id=uuid4(),
        name="Brown rice",
        quantity="2 kg",
        expiry_date=datetime(2027, 1, 1, tzinfo=timezone.utc),
        source="shopping",
        date_recorded=datetime(2026, 10, 17, tzinfo=timezone.utc),
    )
    monkeypatch.setattr(inventory_endpoint, "_inventory_id", lambda *_: inventory_id)
    monkeypatch.setattr(inventory_endpoint, "_insert_inventory_item", lambda *_: created)

    result = inventory_endpoint.add_inventory_items(_bulk_request(), _consumer(), session)

    assert result.items == [created]
    assert result.created_count == 1
    session.commit.assert_called_once_with()
    session.rollback.assert_not_called()


def test_bulk_inventory_completion_rolls_back_on_any_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    session = Mock()
    request = InventoryBulkCreateRequest(items=[
        _bulk_request().items[0],
        {
            "name": "Milk",
            "quantity": "1 carton",
            "expiry_date": datetime(2026, 10, 24, tzinfo=timezone.utc),
            "source": "shopping",
        },
    ])
    monkeypatch.setattr(inventory_endpoint, "_inventory_id", lambda *_: uuid4())
    monkeypatch.setattr(
        inventory_endpoint,
        "_insert_inventory_item",
        Mock(side_effect=[object(), RuntimeError("insert failed")]),
    )

    with pytest.raises(RuntimeError, match="insert failed"):
        inventory_endpoint.add_inventory_items(request, _consumer(), session)

    session.rollback.assert_called_once_with()
    session.commit.assert_not_called()


def test_remove_inventory_item_keeps_ingredient_referenced_elsewhere() -> None:
    session = Mock()
    inventory_delete = Mock(rowcount=1)
    shared_ingredient_delete = Mock(rowcount=0)
    session.execute.side_effect = [inventory_delete, shared_ingredient_delete]
    item_id = uuid4()

    inventory_endpoint.remove_inventory_item(item_id, _consumer(), session)

    assert session.execute.call_count == 2
    cleanup_sql = str(session.execute.call_args_list[1].args[0])
    assert "NOT EXISTS" in cleanup_sql
    assert "recipe_ingredients" in cleanup_sql
    session.commit.assert_called_once_with()


def test_personal_metadata_edit_copies_ingredient_instead_of_rewriting_recipe_data():
    session, old_id, new_id = Mock(), uuid4(), uuid4()
    updated, original, inserted = Mock(), Mock(), Mock()
    recorded = datetime(2026, 11, 1, tzinfo=timezone.utc)
    updated.one_or_none.return_value = SimpleNamespace(date_recorded=recorded)
    original.one.return_value = SimpleNamespace(ingredient_name="Spinach", category="Vegetables", ingredient_type="manual", icon=None)
    inserted.scalar_one.return_value = new_id
    session.execute.side_effect = [updated, original, inserted, Mock()]

    saved = inventory_endpoint.update_inventory_item(old_id, InventoryItemInput(name="Milk", quantity="1 carton", expiry_date=datetime(2026, 11, 10, tzinfo=timezone.utc)), _consumer(), session)

    assert saved.id == new_id
    assert saved.name == "Milk"
    assert saved.date_recorded == recorded
    original_ingredient = original.one.return_value
    assert original_ingredient.ingredient_name == "Spinach"
    assert all("UPDATE ingredients" not in str(call.args[0]) for call in session.execute.call_args_list)
    relink = session.execute.call_args.args[1]
    assert (relink["old_id"], relink["new_id"]) == (old_id, new_id)
    session.commit.assert_called_once()


def test_quantity_only_edit_retains_inventory_identity():
    session, item_id = Mock(), uuid4()
    updated, original = Mock(), Mock()
    updated.one_or_none.return_value = SimpleNamespace(date_recorded=datetime(2026, 11, 1, tzinfo=timezone.utc))
    original.one.return_value = SimpleNamespace(ingredient_name="Spinach", category=None, ingredient_type="manual", icon=None)
    session.execute.side_effect = [updated, original]
    saved = inventory_endpoint.update_inventory_item(item_id, InventoryItemInput(name="Spinach", quantity="2 bunches", expiry_date=datetime(2026, 11, 10, tzinfo=timezone.utc)), _consumer(), session)
    assert saved.id == item_id
    assert saved.quantity == "2 bunches"
    assert session.execute.call_count == 2
