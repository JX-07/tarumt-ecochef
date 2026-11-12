from unittest.mock import Mock
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import admin


def _result(row: dict | None) -> Mock:
    result = Mock()
    result.mappings.return_value.one_or_none.return_value = row
    return result


def _scalar(value: object) -> Mock:
    result = Mock()
    result.scalar_one.return_value = value
    return result


def test_pending_store_can_be_approved_by_administrator() -> None:
    session = Mock()
    store_id = uuid4()
    session.execute.return_value = _result({
        "id": store_id,
        "store_name": "Green Harvest",
        "status": "approved",
    })

    response = admin.approve_store(store_id, Mock(), session)

    assert response["status"] == "approved"
    assert response["store_name"] == "Green Harvest"
    statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert any("status = 'pending_approval'" in statement for statement in statements)
    assert any("INSERT INTO administrator_action_logs" in statement for statement in statements)
    session.commit.assert_called_once()


def test_store_that_is_not_pending_cannot_be_approved() -> None:
    session = Mock()
    session.execute.side_effect = [_result(None), _result({"status": "approved"})]

    with pytest.raises(HTTPException) as error:
        admin.approve_store(uuid4(), Mock(), session)

    assert error.value.status_code == 409
    assert "pending approval" in error.value.detail
    session.commit.assert_not_called()


def test_administrator_can_only_undo_own_action_but_super_admin_can_undo_any() -> None:
    owner_id, other_id = uuid4(), uuid4()
    action = {
        "administrator_id": owner_id,
        "action_type": "store.approved",
        "undone_at": None,
    }

    assert admin._can_undo(action, owner_id, "moderator") is True
    assert admin._can_undo(action, other_id, "moderator") is False
    assert admin._can_undo(action, other_id, "super_admin") is True


def test_undo_transactions_cannot_be_undone_again() -> None:
    administrator_id = uuid4()
    action = {
        "administrator_id": administrator_id,
        "action_type": "action.undo",
        "undone_at": None,
    }

    assert admin._can_undo(action, administrator_id, "super_admin") is False


@pytest.mark.parametrize("action_type", [
    "administrator.invite_permission_updated",
    "administrator.undo_permission_updated",
])
def test_retired_permission_actions_cannot_be_undone(action_type: str) -> None:
    administrator_id = uuid4()
    action = {
        "administrator_id": administrator_id,
        "action_type": action_type,
        "undone_at": None,
    }

    assert admin._can_undo(action, administrator_id, "super_admin") is False


def test_super_administrator_can_invite() -> None:
    result = Mock()
    result.mappings.return_value.one.return_value = {
        "access_level": "super_admin",
    }
    session = Mock()
    session.execute.return_value = result

    permissions = admin._require_administrator_invite_permission(session, uuid4())

    assert permissions["access_level"] == "super_admin"


@pytest.mark.parametrize("access_level", ["administrator", "moderator", "support_agent"])
def test_non_super_administrator_cannot_invite(access_level: str) -> None:
    result = Mock()
    result.mappings.return_value.one.return_value = {
        "access_level": access_level,
    }
    session = Mock()
    session.execute.return_value = result

    with pytest.raises(HTTPException) as error:
        admin._require_administrator_invite_permission(session, uuid4())

    assert error.value.status_code == 403


def test_administrator_profile_update_is_persisted_and_recorded() -> None:
    administrator_id = uuid4()
    current_result = Mock()
    current_result.mappings.return_value.one.return_value = {
        "id": administrator_id,
        "name": "Previous Name",
        "email": "admin@example.com",
    }
    updated_result = Mock()
    updated_result.mappings.return_value.one.return_value = {
        "id": administrator_id,
        "name": "Updated Name",
        "email": "admin@example.com",
        "access_level": "administrator",
        "date_assigned": "2026-10-21T00:00:00Z",
    }
    session = Mock()
    session.execute.side_effect = [current_result, updated_result, _scalar(uuid4())]

    response = admin.update_administrator_profile(
        admin.AdministratorProfileUpdateRequest(name="  Updated Name  "),
        SimpleNamespace(id=administrator_id), session,
    )

    assert response["name"] == "Updated Name"
    statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert any("UPDATE administrators SET name" in statement for statement in statements)
    assert any("INSERT INTO administrator_action_logs" in statement for statement in statements)
    session.commit.assert_called_once()


def test_unchanged_administrator_profile_is_not_recorded_as_an_action() -> None:
    administrator_id = uuid4()
    current_result = Mock()
    current_result.mappings.return_value.one.return_value = {
        "id": administrator_id,
        "name": "Existing Name",
        "email": "admin@example.com",
    }
    updated_result = Mock()
    updated_result.mappings.return_value.one.return_value = {
        "id": administrator_id,
        "name": "Existing Name",
        "email": "admin@example.com",
        "access_level": "administrator",
        "date_assigned": "2026-10-21T00:00:00Z",
    }
    session = Mock()
    session.execute.side_effect = [current_result, updated_result]

    response = admin.update_administrator_profile(
        admin.AdministratorProfileUpdateRequest(name=" Existing Name "),
        SimpleNamespace(id=administrator_id), session,
    )

    assert response["name"] == "Existing Name"
    statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert not any("INSERT INTO administrator_action_logs" in statement for statement in statements)
    session.commit.assert_called_once()


def test_first_store_strike_keeps_store_approved() -> None:
    session = Mock()
    store_id, administrator_id, strike_id = uuid4(), uuid4(), uuid4()
    session.execute.side_effect = [
        _result({"id": store_id, "store_name": "Green Harvest", "status": "approved"}),
        _scalar(0), _scalar(strike_id), _scalar(uuid4()),
    ]

    response = admin.issue_store_strike(
        store_id, admin.StoreStrikeRequest(reason="Repeated misleading product listing"),
        SimpleNamespace(id=administrator_id), session,
    )

    assert response["status"] == "approved"
    assert response["strike_count"] == 1
    assert response["strikes_remaining"] == 2
    session.commit.assert_called_once()


def test_third_store_strike_keeps_store_approved_but_makes_it_revoke_eligible() -> None:
    session = Mock()
    store_id, administrator_id, strike_id = uuid4(), uuid4(), uuid4()
    session.execute.side_effect = [
        _result({"id": store_id, "store_name": "Green Harvest", "status": "approved"}),
        _scalar(2), _scalar(strike_id), _scalar(uuid4()),
    ]

    response = admin.issue_store_strike(
        store_id, admin.StoreStrikeRequest(reason="Third confirmed marketplace policy violation"),
        SimpleNamespace(id=administrator_id), session,
    )

    assert response["status"] == "approved"
    assert response["strike_count"] == 3
    statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert not any("SET status = 'revoked'" in statement for statement in statements)
    session.commit.assert_called_once()


def test_store_approval_can_be_revoked_only_after_three_strikes() -> None:
    session = Mock()
    store_id, administrator_id = uuid4(), uuid4()
    session.execute.side_effect = [
        _result({"id": store_id, "store_name": "Green Harvest", "status": "approved", "strike_count": 3}),
        Mock(), _scalar(uuid4()),
    ]

    response = admin.revoke_store(store_id, SimpleNamespace(id=administrator_id), session)

    assert response["status"] == "revoked"
    assert response["strike_count"] == 3
    statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert any("SET status = 'revoked'" in statement for statement in statements)
    session.commit.assert_called_once()
