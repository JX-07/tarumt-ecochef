import pytest
from pydantic import ValidationError

from app.schemas.profiles import ConsumerProfileUpdate, UnitPreference

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from fastapi import HTTPException
from app.api.v1.endpoints import profiles
from app.schemas.profiles import AddressInput


def _address_row(address_id, *, is_default):
    return {"id": address_id, "address_line_1": "12 Green Street", "is_default": is_default}


def test_selecting_another_default_address_updates_it_atomically():
    session, user, address_id = Mock(), SimpleNamespace(id=uuid4()), uuid4()
    existing = Mock()
    existing.one_or_none.return_value = SimpleNamespace(is_default=False)
    updated = Mock()
    updated.mappings.return_value.one_or_none.return_value = _address_row(address_id, is_default=True)
    session.execute.side_effect = [Mock(), existing, Mock(), updated]

    result = profiles.update_my_address(address_id, AddressInput(address_line_1="12 Green Street", is_default=True), user, session)

    assert result.is_default
    calls = session.execute.call_args_list
    assert "FOR UPDATE" in str(calls[0].args[0])
    assert "is_default = false" in str(calls[2].args[0])
    assert calls[3].args[1]["is_default"] is True
    session.commit.assert_called_once()


def test_editing_default_address_without_reselecting_keeps_it_default():
    session, user, address_id = Mock(), SimpleNamespace(id=uuid4()), uuid4()
    existing = Mock()
    existing.one_or_none.return_value = SimpleNamespace(is_default=True)
    updated = Mock()
    updated.mappings.return_value.one_or_none.return_value = _address_row(address_id, is_default=True)
    session.execute.side_effect = [Mock(), existing, updated]

    result = profiles.update_my_address(address_id, AddressInput(address_line_1="12 Green Street"), user, session)

    assert result.is_default
    assert session.execute.call_args.args[1]["is_default"] is True


def test_missing_address_cannot_clear_another_default():
    session, user = Mock(), SimpleNamespace(id=uuid4())
    existing = Mock()
    existing.one_or_none.return_value = None
    session.execute.side_effect = [Mock(), existing]
    with pytest.raises(HTTPException) as error:
        profiles.update_my_address(uuid4(), AddressInput(address_line_1="12 Green Street", is_default=True), user, session)
    assert error.value.status_code == 404
    assert session.execute.call_count == 2
    session.commit.assert_not_called()


def test_deleting_default_promotes_a_remaining_owned_address():
    session, user = Mock(), SimpleNamespace(id=uuid4())
    removed = Mock()
    removed.one_or_none.return_value = SimpleNamespace(is_default=True)
    session.execute.side_effect = [Mock(), removed, Mock()]
    profiles.remove_my_address(uuid4(), user, session)
    assert "is_default = true" in str(session.execute.call_args.args[0])
    assert session.execute.call_args.args[1]["user_id"] == user.id
    session.commit.assert_called_once()


def test_profile_terms_are_normalized_and_deduplicated() -> None:
    profile = ConsumerProfileUpdate(name="Eco Chef", cuisine_preferences=[" Malaysian ", "malaysian", "Italian"], dietary_restrictions=[" vegetarian "], allergies=["Peanuts", " peanuts "], preferred_units=UnitPreference.metric)
    assert profile.cuisine_preferences == ["malaysian", "italian"]
    assert profile.allergies == ["peanuts"]


def test_profile_rejects_overlong_allergy() -> None:
    with pytest.raises(ValidationError):
        ConsumerProfileUpdate(name="Eco Chef", allergies=["x" * 51])
