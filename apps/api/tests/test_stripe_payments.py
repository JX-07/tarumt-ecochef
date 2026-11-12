from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic import SecretStr

from app.services import order_cart

from app.services import stripe_payments
from app.api.v1.endpoints import stripe as stripe_endpoint


def test_order_refund_uses_payment_intent_and_stable_idempotency_key(monkeypatch):
    create=Mock(return_value=SimpleNamespace(id="re_test",status="succeeded"))
    monkeypatch.setattr(stripe_payments,"_client",lambda:SimpleNamespace(v1=SimpleNamespace(refunds=SimpleNamespace(create=create))))
    order_id=uuid4()
    stripe_payments.refund_order_payment(payment_intent_id="pi_test",order_id=order_id)
    request,options=create.call_args.args
    assert request["payment_intent"]=="pi_test"
    assert request["metadata"]["ecochef_order_id"]==str(order_id)
    assert options["idempotency_key"]==f"ecochef-order-cancel-{order_id}"


def test_successful_cancellation_refund_restocks_once(monkeypatch):
    order_id,payment_id,user_id=uuid4(),uuid4(),uuid4()
    payment=SimpleNamespace(id=payment_id,user_id=user_id,order_status="cancellation_pending",inventory_deducted_at=object(),inventory_released_at=None)
    session=Mock()
    session.execute.side_effect=[Mock(one_or_none=Mock(return_value=payment)),Mock(),Mock(),Mock(),Mock(),
        Mock(one_or_none=Mock(return_value=SimpleNamespace(order_status="cancelled")))]
    reverse=Mock()
    notify=Mock()
    monkeypatch.setattr(stripe_endpoint,"_reverse_allocations",reverse)
    monkeypatch.setattr(stripe_endpoint,"create_notification",notify)
    refund=SimpleNamespace(payment_intent="pi_test",status="succeeded",metadata={"ecochef_order_cancellation":"true","ecochef_order_id":str(order_id)})
    assert stripe_endpoint._handle_order_cancellation_refund(refund,session) is True
    assert stripe_endpoint._handle_order_cancellation_refund(refund,session) is False
    statements=[str(call.args[0]) for call in session.execute.call_args_list]
    assert sum("UPDATE products product" in statement for statement in statements)==1
    assert any("order_status='cancelled'" in statement for statement in statements)
    reverse.assert_called_once()
    notify.assert_called_once()


def test_refund_push_opens_cancelled_order(monkeypatch):
    send = Mock()
    monkeypatch.setattr(stripe_endpoint, "send_push_notification", send)
    session, customer_id, order_id = Mock(), uuid4(), uuid4()

    stripe_endpoint._push_order_cancellation(session, customer_id, order_id)

    assert send.call_args.kwargs["user_id"] == customer_id
    assert send.call_args.kwargs["action_path"] == f"/marketplace/order?orderId={order_id}"
    assert "refund" in send.call_args.kwargs["message"].lower()


def test_charge_refund_webhook_completes_pending_cancellation(monkeypatch):
    session=Mock()
    order_id,payment_id=uuid4(),uuid4()
    session.execute.side_effect=[Mock(one_or_none=Mock(return_value=SimpleNamespace(id=payment_id,order_id=order_id,order_status="cancellation_pending"))),Mock()]
    monkeypatch.setattr(stripe_endpoint,"_reverse_allocations",Mock())
    finish=Mock(return_value=True)
    monkeypatch.setattr(stripe_endpoint,"_handle_order_cancellation_refund",finish)
    stripe_endpoint._handle_charge_refund(SimpleNamespace(id="ch_test",payment_intent="pi_test",amount=1000,amount_refunded=1000),session)
    finish.assert_called_once()


def test_checkout_session_uses_embedded_form_and_platform_payment(monkeypatch) -> None:
    create = Mock(return_value=SimpleNamespace(id="cs_test_ecochef", client_secret="cs_test_secret"))
    client = SimpleNamespace(
        v1=SimpleNamespace(
            checkout=SimpleNamespace(sessions=SimpleNamespace(create=create))
        )
    )
    monkeypatch.setattr(stripe_payments, "_client", lambda _settings=None: client)
    order_id, payment_id = uuid4(), uuid4()
    settings = SimpleNamespace(
        stripe_mobile_return_url="ecochef://marketplace/cart",
        stripe_currency="myr",
    )

    result = stripe_payments.create_checkout_session(
        order_id=order_id,
        payment_id=payment_id,
        customer_email="buyer@example.com",
        line_items=[{"price_data": {"currency": "myr", "unit_amount": 1200}, "quantity": 1}],
        settings=settings,
    )

    params, options = create.call_args.args
    assert result.id == "cs_test_ecochef"
    assert result.client_secret == "cs_test_secret"
    assert params["ui_mode"] == "form"
    assert params["billing_address_collection"] == "auto"
    assert params["phone_number_collection"] == {"enabled": False}
    assert params["automatic_tax"] == {"enabled": False}
    assert params["submit_type"] == "pay"
    assert params["integration_identifier"] == "custom_embedded_web_0001"
    assert params["invoice_creation"]["enabled"] is True
    assert "transfer_group" not in params["payment_intent_data"]
    assert params["payment_intent_data"]["metadata"]["ecochef_order_id"] == str(order_id)
    assert "payment_method_types" not in params
    assert "payment_method_collection" not in params
    assert "success_url" not in params
    assert "cancel_url" not in params
    assert options["idempotency_key"] == f"ecochef-checkout-{payment_id}"


def test_nested_value_handles_stripe_objects_and_dicts() -> None:
    account = SimpleNamespace(
        configuration={"recipient": SimpleNamespace(capabilities={"transfers": {"status": "active"}})}
    )

    assert stripe_payments.nested_value(
        account, "configuration", "recipient", "capabilities", "transfers", "status"
    ) == "active"
    assert stripe_payments.nested_value(account, "missing", default="pending") == "pending"


def test_sandbox_payment_uses_stripe_test_payment_method(monkeypatch) -> None:
    create = Mock(return_value=SimpleNamespace(
        id="pi_test_ecochef", status="succeeded", latest_charge=SimpleNamespace(id="ch_test")
    ))
    client = SimpleNamespace(
        v1=SimpleNamespace(payment_intents=SimpleNamespace(create=create))
    )
    monkeypatch.setattr(stripe_payments, "_client", lambda _settings=None: client)
    settings = SimpleNamespace(
        stripe_api_key=SecretStr("rk_test_example"),
        stripe_api_version="2026-09-30.endive",
        stripe_currency="myr",
    )
    order_id, payment_id = uuid4(), uuid4()

    result = stripe_payments.create_sandbox_payment(
        order_id=order_id, payment_id=payment_id, amount=548, settings=settings,
    )

    params, options = create.call_args.args
    assert result.id == "pi_test_ecochef"
    assert params["amount"] == 548
    assert params["currency"] == "myr"
    assert params["payment_method"] == "pm_card_visa"
    assert params["confirm"] is True
    assert params["automatic_payment_methods"] == {
        "enabled": True, "allow_redirects": "never",
    }
    assert "payment_method_types" not in params
    assert options["idempotency_key"] == f"ecochef-sandbox-payment-{payment_id}"


def test_checkout_form_uses_only_supported_form_sdk_appearance_options() -> None:
    assert 'borderRadius: "12px"' in stripe_endpoint.CHECKOUT_FORM_HTML
    assert "rules:" not in stripe_endpoint.CHECKOUT_FORM_HTML


def test_completed_payment_decreases_stock_once(monkeypatch) -> None:
    session = Mock()
    payment_id, order_id, product_id = uuid4(), uuid4(), uuid4()
    payment_result, inventory_result = Mock(), Mock()
    payment_result.one_or_none.return_value = SimpleNamespace(
        id=payment_id,
        order_id=order_id,
        payment_status="pending",
        order_status="pending_payment",
        inventory_deducted_at=None,
    )
    inventory_result.all.return_value = [SimpleNamespace(
        id=product_id, product_name="Spinach", stock_quantity=4, quantity=2,
    )]
    session.execute.side_effect = [
        Mock(), payment_result, inventory_result, Mock(), Mock(), Mock(), Mock(),
    ]
    monkeypatch.setattr(
        stripe_endpoint.stripe_payments,
        "retrieve_payment_intent",
        lambda _payment_intent_id: SimpleNamespace(latest_charge="ch_test"),
    )

    cleanup = Mock()
    monkeypatch.setattr(stripe_endpoint, "consume_order_cart_snapshot", cleanup)
    stripe_endpoint._complete_checkout(
        SimpleNamespace(id="cs_test", payment_intent="pi_test", invoice=None),
        session,
    )

    statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert sum("UPDATE products product" in statement for statement in statements) == 1
    assert any("inventory_deducted_at" in statement for statement in statements)
    cleanup.assert_called_once_with(session, order_id)
    assert "pg_advisory_xact_lock" in statements[0]


@pytest.mark.parametrize("payment_status", ["paid", "refunded", "partially_refunded", "disputed"])
def test_late_success_preserves_captured_payment_state(payment_status, monkeypatch):
    session, payment_result = Mock(), Mock()
    payment_result.one_or_none.return_value = SimpleNamespace(payment_status=payment_status)
    session.execute.side_effect = [Mock(), payment_result]
    retrieve = Mock()
    monkeypatch.setattr(stripe_endpoint.stripe_payments, "retrieve_payment_intent", retrieve)
    stripe_endpoint._complete_checkout(SimpleNamespace(id="cs_test"), session)
    assert session.execute.call_count == 2
    retrieve.assert_not_called()


@pytest.mark.parametrize("payment_status", ["paid", "refunded", "partially_refunded", "disputed", "failed"])
def test_late_failure_cannot_overwrite_terminal_state(payment_status):
    session = Mock()
    session.execute.return_value.one_or_none.return_value = SimpleNamespace(payment_status=payment_status)
    stripe_endpoint._fail_checkout(SimpleNamespace(id="cs_test"), "late failure", session)
    assert session.execute.call_count == 1


def test_success_for_cancelled_order_requires_reconciliation(monkeypatch):
    session, payment_result = Mock(), Mock()
    payment_result.one_or_none.return_value = SimpleNamespace(payment_status="failed", order_status="cancelled")
    session.execute.side_effect = [Mock(), payment_result]
    retrieve = Mock()
    monkeypatch.setattr(stripe_endpoint.stripe_payments, "retrieve_payment_intent", retrieve)
    with pytest.raises(stripe_payments.StripeOperationError, match="reconciliation"):
        stripe_endpoint._complete_checkout(SimpleNamespace(id="cs_test"), session)
    retrieve.assert_not_called()
    assert session.execute.call_count == 2


def test_cart_snapshot_cleanup_keeps_additional_quantities_and_other_products():
    session, cart_id, extra, consumed, later_product = Mock(), uuid4(), uuid4(), uuid4(), uuid4()
    session.execute.return_value.all.return_value = [
        SimpleNamespace(cart_id=cart_id, product_id=extra, quantity=5, purchased_quantity=2),
        SimpleNamespace(cart_id=cart_id, product_id=consumed, quantity=2, purchased_quantity=2),
    ]
    order_cart.consume_order_cart_snapshot(session, uuid4())
    statements = [(str(call.args[0]), call.args[1]) for call in session.execute.call_args_list]
    assert "pg_advisory_xact_lock" in statements[0][0]
    assert "item.product_id = ci.product_id" in statements[1][0]
    assert "FOR UPDATE OF ci" in statements[1][0]
    assert statements[2][1] == {"cart_id":cart_id, "product_id":extra, "quantity":3}
    assert "UPDATE cart_items" in statements[2][0]
    assert statements[3][1] == {"cart_id":cart_id, "product_id":consumed}
    assert "DELETE FROM cart_items" in statements[3][0]
    assert all(params.get("product_id") != later_product for _,params in statements)
