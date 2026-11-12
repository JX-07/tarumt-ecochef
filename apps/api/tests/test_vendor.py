from unittest.mock import Mock
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import vendor
from app.schemas.vendor import VendorProductInput, VendorStoreInput


def test_vendor_inputs_reject_invalid_stock_and_delivery_values() -> None:
    with pytest.raises(ValidationError):
        VendorProductInput(name="Spinach", price=1.5, stock_quantity=-1)
    with pytest.raises(ValidationError):
        VendorStoreInput(name="Green Farm", address="123 Market Road", delivery_fee=-1)


def test_vendor_product_validates_pricing_and_addons() -> None:
    product = VendorProductInput(
        name="Honeycrisp Apple", price="4.50", original_price="5.00", stock_quantity=12,
        brand="Orchard Select", size="500 g",
        addons=[{
            "name": "Packaging", "required": False,
            "options": [{"name": "Eco gift box", "price": "1.00"}],
        }],
    )

    assert product.addons[0].name == "Packaging"
    assert product.addons[0].options[0].price == 1
    assert product.brand == "Orchard Select"
    assert product.size == "500 g"

    with pytest.raises(ValidationError):
        VendorProductInput(
            name="Honeycrisp Apple", price="5.00", original_price="4.50", stock_quantity=12,
        )

    with pytest.raises(ValidationError):
        VendorProductInput(
            name="Honeycrisp Apple", price="4.50", stock_quantity=12,
            addons=[{"name": "Packaging", "required": True, "options": []}],
        )

    with pytest.raises(ValidationError):
        VendorProductInput(
            name="Honeycrisp Apple", price="4.50", stock_quantity=12,
            addons=[{
                "name": "Packaging", "required": False, "selection_mode": "multiple",
                "max_selections": 3,
                "options": [{"name": "Box", "price": "1.00"}, {"name": "Bag", "price": "0.50"}],
            }],
        )

    discounted = VendorProductInput(
        name="Honeycrisp Apple", price="4.50", stock_quantity=12,
        discount={"type": "percentage", "value": "15", "starts_at": "2026-10-21T00:00:00Z", "ends_at": "2026-10-31T23:59:00Z"},
    )
    assert discounted.discount is not None
    assert discounted.discount.value == 15

    with pytest.raises(ValidationError):
        VendorProductInput(
            name="Honeycrisp Apple", price="4.50", stock_quantity=12,
            discount={"type": "fixed_amount", "value": "5.00", "starts_at": "2026-10-21T00:00:00Z", "ends_at": "2026-10-31T23:59:00Z"},
        )


def test_owned_store_is_always_scoped_to_authenticated_owner() -> None:
    session, store, owner = Mock(), uuid4(), uuid4()
    result = Mock()
    result.one_or_none.return_value = None
    session.execute.return_value = result

    with pytest.raises(HTTPException) as error:
        vendor._owned_store(session, owner, store)

    assert error.value.status_code == 404
    assert session.execute.call_args.args[1] == {"id": store, "owner_id": owner}


def test_postcode_location_uses_malaysian_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(vendor, "_malaysia_postcodes", lambda: {
        "11900": {"city": "Bayan Lepas", "state": "Pulau Pinang"},
    })

    assert vendor.postcode_location("11900", Mock()) == {
        "postcode": "11900", "city": "Bayan Lepas", "state": "Pulau Pinang", "country": "Malaysia",
    }
    with pytest.raises(HTTPException) as error:
        vendor.postcode_location("999", Mock())
    assert error.value.status_code == 422


def test_locations_group_every_city_under_its_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(vendor, "_malaysia_postcodes", lambda: {
        "11900": {"city": "Bayan Lepas", "state": "Pulau Pinang"},
        "10450": {"city": "George Town", "state": "Pulau Pinang"},
        "50000": {"city": "Kuala Lumpur", "state": "Kuala Lumpur"},
    })
    assert vendor.malaysia_locations(Mock()) == {
        "country": "Malaysia",
        "states": {
            "Kuala Lumpur": ["Kuala Lumpur"],
            "Pulau Pinang": ["Bayan Lepas", "George Town"],
        },
    }


def test_pending_store_cannot_use_approval_gated_features() -> None:
    session = Mock()
    session.execute.return_value.one_or_none.return_value = SimpleNamespace(
        store_id=uuid4(), status="pending_approval",
    )

    with pytest.raises(HTTPException) as error:
        vendor._account_store_id(session, uuid4(), require_approved=True)

    assert error.value.status_code == 403
    assert "administrator approval" in error.value.detail


def test_view_only_staff_cannot_edit_store_profile() -> None:
    session = Mock()
    session.execute.return_value.one_or_none.return_value = SimpleNamespace(
        can_edit_store=False, status="approved",
    )

    with pytest.raises(HTTPException) as error:
        vendor._accessible_store(session, uuid4(), uuid4(), require_profile_edit=True)

    assert error.value.status_code == 403
    assert "view-only" in error.value.detail



def test_viewing_ready_orders_does_not_complete_them(monkeypatch: pytest.MonkeyPatch) -> None:
    """A shop opening its dashboard is not evidence of pickup or delivery."""
    session, store_id = Mock(), uuid4()
    ready_order = {"id": uuid4(), "status": "ready", "items": "Apples x2"}
    monkeypatch.setattr(vendor, "_account_store_id", lambda *_args, **_kwargs: store_id)
    session.execute.return_value.mappings.return_value.all.return_value = [ready_order]

    assert vendor.vendor_orders(SimpleNamespace(id=uuid4()), session) == {"orders": [ready_order]}
    assert session.execute.call_count == 1
    assert str(session.execute.call_args.args[0]).lstrip().startswith("SELECT")
    session.commit.assert_not_called()


def test_ready_order_requires_explicit_handover_to_complete(monkeypatch: pytest.MonkeyPatch) -> None:
    session, order_id, store_id = Mock(), uuid4(), uuid4()
    user = SimpleNamespace(id=uuid4(), name="Shop owner")
    row = SimpleNamespace(order_status="ready", user_id=uuid4(), store_name="Green Farm", store_count=1, fully_owned=True, payment_captured=True)
    monkeypatch.setattr(vendor, "_account_store_id", lambda *_args, **_kwargs: store_id)
    session.execute.return_value.one_or_none.return_value = row
    session.execute.return_value.scalar_one.return_value = uuid4()
    notify, push = Mock(), Mock()
    monkeypatch.setattr(vendor, "create_notification", notify)
    monkeypatch.setattr(vendor, "send_push_notification", push)

    assert vendor.update_order_status(order_id, {"status":"completed"}, user, session) == {"id":order_id,"status":"completed"}
    statements = [(str(call.args[0]), call.args[1]) for call in session.execute.call_args_list]
    assert "FOR UPDATE" in statements[0][0]
    updates = [params for sql, params in statements if "UPDATE orders" in sql]
    assert updates == [{"status":"completed", "mark_ready":False, "id":order_id}]
    assert "handed over" in notify.call_args.kwargs["message"]
    session.commit.assert_called_once()
    push.assert_called_once()


def test_saved_order_status_succeeds_when_push_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    session, order_id, store_id = Mock(), uuid4(), uuid4()
    row = SimpleNamespace(order_status="preparing", user_id=uuid4(), store_name="Green Farm", store_count=1, fully_owned=True, payment_captured=True)
    monkeypatch.setattr(vendor, "_account_store_id", lambda *_args, **_kwargs: store_id)
    monkeypatch.setattr(vendor, "create_notification", Mock())
    monkeypatch.setattr(vendor, "send_push_notification", Mock(side_effect=RuntimeError("Push unavailable")))
    session.execute.return_value.one_or_none.return_value = row
    session.execute.return_value.scalar_one.return_value = uuid4()

    assert vendor.update_order_status(order_id, {"status": "ready"}, SimpleNamespace(id=uuid4(), name="Shop owner"), session) == {"id": order_id, "status": "ready"}
    session.commit.assert_called_once()


def test_preparing_order_cannot_skip_ready_and_complete(monkeypatch: pytest.MonkeyPatch) -> None:
    session = Mock()
    monkeypatch.setattr(vendor, "_account_store_id", lambda *_args, **_kwargs: uuid4())
    session.execute.return_value.one_or_none.return_value = SimpleNamespace(
        order_status="preparing", store_count=1, fully_owned=True,
    )
    with pytest.raises(HTTPException) as error:
        vendor.update_order_status(uuid4(), {"status":"completed"}, SimpleNamespace(id=uuid4()), session)
    assert error.value.status_code == 409
    session.commit.assert_not_called()
    assert session.execute.call_count == 1


def test_paid_order_cancellation_refunds_before_preparation(monkeypatch: pytest.MonkeyPatch) -> None:
    session, order_id, payment_intent = Mock(), uuid4(), "pi_test_order"
    customer_id = uuid4()
    monkeypatch.setattr(vendor, "_account_store_id", lambda *_args, **_kwargs: uuid4())
    session.execute.side_effect = [
        Mock(one_or_none=Mock(return_value=SimpleNamespace(order_status="placed",store_count=1,fully_owned=True,user_id=customer_id))),
        Mock(one_or_none=Mock(return_value=SimpleNamespace(payment_status="paid",stripe_payment_intent_id=payment_intent))),
        Mock(),
    ]
    refund = Mock(return_value=SimpleNamespace(status="succeeded"))
    monkeypatch.setattr(vendor.stripe_payments,"refund_order_payment",refund)
    from app.api.v1.endpoints import stripe as stripe_endpoint
    finalize = Mock(return_value=True)
    monkeypatch.setattr(stripe_endpoint,"_handle_order_cancellation_refund",finalize)
    push = Mock()
    monkeypatch.setattr(stripe_endpoint,"_push_order_cancellation",push)

    assert vendor.update_order_status(order_id,{"status":"cancelled"},SimpleNamespace(id=uuid4()),session)=={"id":order_id,"status":"cancelled"}
    refund.assert_called_once_with(payment_intent_id=payment_intent,order_id=order_id)
    finalize.assert_called_once()
    push.assert_called_once_with(session, customer_id, order_id)
    assert session.commit.call_count==2


def test_refund_finalisation_failure_keeps_order_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    session, order_id = Mock(), uuid4()
    monkeypatch.setattr(vendor, "_account_store_id", lambda *_args, **_kwargs: uuid4())
    session.execute.side_effect = [
        Mock(one_or_none=Mock(return_value=SimpleNamespace(order_status="placed", store_count=1, fully_owned=True))),
        Mock(one_or_none=Mock(return_value=SimpleNamespace(payment_status="paid", stripe_payment_intent_id="pi_test_order"))),
        Mock(),
    ]
    monkeypatch.setattr(vendor.stripe_payments, "refund_order_payment", Mock(return_value=SimpleNamespace(status="succeeded")))
    from app.api.v1.endpoints import stripe as stripe_endpoint
    monkeypatch.setattr(stripe_endpoint, "_handle_order_cancellation_refund", Mock(side_effect=RuntimeError("Finalisation unavailable")))

    assert vendor.update_order_status(order_id, {"status": "cancelled"}, SimpleNamespace(id=uuid4()), session) == {"id": order_id, "status": "cancellation_pending"}
    session.rollback.assert_called_once()
    session.commit.assert_called_once()


def test_preparing_order_cannot_be_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    session=Mock()
    monkeypatch.setattr(vendor,"_account_store_id",lambda *_args,**_kwargs:uuid4())
    session.execute.return_value.one_or_none.return_value=SimpleNamespace(order_status="preparing",store_count=1,fully_owned=True)
    with pytest.raises(HTTPException) as error:
        vendor.update_order_status(uuid4(),{"status":"cancelled"},SimpleNamespace(id=uuid4()),session)
    assert error.value.status_code==409
    session.commit.assert_not_called()
