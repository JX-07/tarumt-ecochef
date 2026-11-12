from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import social


def _session(me, them, *, blocked=False, relationships=()):
    session = Mock()
    targets, block, existing = Mock(), Mock(), Mock()
    targets.scalars.return_value.all.return_value = [me, them]
    block.scalar_one.return_value = blocked
    existing.all.return_value = list(relationships)
    session.execute.side_effect = [targets, block, existing, Mock()]
    return session


def test_block_prevents_friend_requests_in_either_direction():
    me, them = uuid4(), uuid4()
    session = _session(me, them, blocked=True)
    with pytest.raises(HTTPException) as error:
        social.send_request(them, SimpleNamespace(id=me), session)
    assert error.value.status_code == 403
    assert session.execute.call_count == 2
    session.commit.assert_not_called()
    block_query = str(session.execute.call_args.args[0])
    assert "blocker_user_id = :them" in block_query


def test_reverse_pending_request_requires_explicit_acceptance():
    me, them = uuid4(), uuid4()
    session = _session(me, them, relationships=[SimpleNamespace(user_id_1=them, status="pending")])
    with pytest.raises(HTTPException) as error:
        social.send_request(them, SimpleNamespace(id=me), session)
    assert error.value.status_code == 409
    assert session.execute.call_count == 3
    session.commit.assert_not_called()


def test_request_to_existing_friend_does_not_create_another_relationship():
    me, them = uuid4(), uuid4()
    session = _session(me, them, relationships=[SimpleNamespace(user_id_1=them, status="accepted")])
    social.send_request(them, SimpleNamespace(id=me), session)
    assert session.execute.call_count == 3


def test_request_to_unknown_user_returns_not_found_before_writing():
    me, them, session = uuid4(), uuid4(), Mock()
    session.execute.return_value.scalars.return_value.all.return_value = [me]
    with pytest.raises(HTTPException) as error:
        social.send_request(them, SimpleNamespace(id=me), session)
    assert error.value.status_code == 404
    assert session.execute.call_count == 1


def test_cannot_block_yourself():
    me, session = uuid4(), Mock()
    with pytest.raises(HTTPException) as error:
        social.block_user(me, SimpleNamespace(id=me), session)
    assert error.value.status_code == 400
    session.execute.assert_not_called()


def test_blocked_profile_does_not_expose_public_details():
    me, them, session = uuid4(), uuid4(), Mock()
    session.execute.return_value.scalar_one.return_value = True
    with pytest.raises(HTTPException) as error:
        social.get_social_profile(them, SimpleNamespace(id=me), session)
    assert error.value.status_code == 404
    assert session.execute.call_count == 1


def test_only_group_owner_can_rename_group():
    group_id, owner_id, session = uuid4(), uuid4(), Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None

    with pytest.raises(HTTPException) as error:
        social.rename_cooking_group(
            group_id, social.GroupNameUpdate(name="  Dinner friends  "),
            SimpleNamespace(id=owner_id), session,
        )

    assert error.value.status_code == 404
    assert session.execute.call_args.args[1] == {
        "name": "Dinner friends", "group": group_id, "owner": owner_id,
    }
    session.commit.assert_not_called()


def test_group_owner_can_rename_group():
    group_id, owner_id, session = uuid4(), uuid4(), Mock()
    session.execute.return_value.scalar_one_or_none.return_value = group_id

    social.rename_cooking_group(
        group_id, social.GroupNameUpdate(name="Saturday cooks"),
        SimpleNamespace(id=owner_id), session,
    )

    session.commit.assert_called_once()


def test_group_member_cannot_invite_to_another_hosts_group():
    me, host, friend, group_id = uuid4(), uuid4(), uuid4(), uuid4()
    session = Mock()
    targets, owner = Mock(), Mock()
    targets.scalars.return_value.all.return_value = [me, friend]
    owner.scalar_one_or_none.return_value = host
    session.execute.side_effect = [targets, owner]

    with pytest.raises(HTTPException) as error:
        social.invite_member_to_cooking_group(
            group_id, friend, SimpleNamespace(id=me), session,
        )

    assert error.value.status_code == 403
    assert session.execute.call_count == 2
    session.commit.assert_not_called()


def test_group_host_invites_only_an_accepted_friend():
    host, friend, group_id = uuid4(), uuid4(), uuid4()
    session = Mock()
    targets, owner, accepted, blocked, insertion = (Mock() for _ in range(5))
    targets.scalars.return_value.all.return_value = [host, friend]
    owner.scalar_one_or_none.return_value = host
    accepted.scalar_one.return_value = True
    blocked.scalar_one.return_value = False
    session.execute.side_effect = [targets, owner, accepted, blocked, insertion]

    social.invite_member_to_cooking_group(
        group_id, friend, SimpleNamespace(id=host), session,
    )

    assert session.execute.call_args.args[1] == {"group": group_id, "them": friend}
    session.commit.assert_called_once()
