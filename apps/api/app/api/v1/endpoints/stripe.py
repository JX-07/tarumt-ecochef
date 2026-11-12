from decimal import Decimal, ROUND_HALF_UP
import logging
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.services import stripe_payments
from app.services.order_cart import consume_order_cart_snapshot, lock_checkout_cart
from app.modules.notifications.service import create_notification, send_push_notification


router = APIRouter()
logger = logging.getLogger(__name__)
MONEY = Decimal("0.01")


def _push_order_cancellation(session: Session, user_id: UUID, order_id: UUID | str) -> None:
    try:
        send_push_notification(
            session, user_id=user_id, title="Order cancelled and refunded",
            message=f"Your order #{str(order_id)[:8].upper()} was cancelled by the shop. A full refund was issued to your original payment method.",
            action_path=f"/marketplace/order?orderId={order_id}",
        )
    except Exception:
        logger.exception("Refund push notification failed for order %s", order_id)


CHECKOUT_FORM_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <script src="https://js.stripe.com/dahlia/stripe.js"></script>
  <style>
    html, body { margin: 0; overflow: hidden; background: #fff; color: #173c39; font-family: Arial, Helvetica, sans-serif; }
    #message { display: none; margin: 12px 0; padding: 12px; border-radius: 12px; background: #fff0f1; color: #b42331; font-size: 14px; }
  </style>
</head>
<body>
  <div id="checkout-form"></div>
  <div id="message" role="alert"></div>
  <script>
    const send = (type, detail = {}) => window.ReactNativeWebView?.postMessage(
      JSON.stringify({ type, ...detail })
    );
    const showError = (error) => {
      const message = error?.message || "Stripe could not load the payment form.";
      const element = document.getElementById("message");
      element.textContent = message;
      element.style.display = "block";
      send("error", { message });
    };
    const reportHeight = () => {
      const form = document.getElementById("checkout-form");
      const message = document.getElementById("message");
      const formBottom = form?.getBoundingClientRect().bottom || 0;
      const messageBottom = message?.style.display === "block"
        ? message.getBoundingClientRect().bottom
        : 0;
      send("height", { height: Math.ceil(Math.max(formBottom, messageBottom, 1)) });
    };
    const readStripeConfig = () => {
      const injectedValue = window.ReactNativeWebView?.injectedObjectJson;
      const injectedJson = typeof injectedValue === "function"
        ? injectedValue.call(window.ReactNativeWebView)
        : injectedValue;
      if (injectedJson) {
        return Promise.resolve(typeof injectedJson === "string"
          ? JSON.parse(injectedJson)
          : injectedJson);
      }
      if (window.__ECOCHEF_STRIPE_CONFIG__) {
        return Promise.resolve(window.__ECOCHEF_STRIPE_CONFIG__);
      }
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Stripe payment configuration is missing.")),
          5000
        );
        window.addEventListener("ecochef-stripe-config", () => {
          window.clearTimeout(timeout);
          resolve(window.__ECOCHEF_STRIPE_CONFIG__);
        }, { once: true });
      });
    };
    const resizeObserver = new ResizeObserver(reportHeight);
    resizeObserver.observe(document.body);
    resizeObserver.observe(document.getElementById("checkout-form"));
    (async () => {
      try {
        const injected = await readStripeConfig();
        if (!injected?.publishableKey || !injected?.clientSecret) {
          throw new Error("Stripe payment configuration is missing.");
        }
        const stripe = Stripe(injected.publishableKey);
        const checkout = stripe.initCheckoutFormSdk({
          clientSecret: Promise.resolve(injected.clientSecret),
          appearance: {
            theme: "stripe", labels: "auto", inputs: "condensed",
            variables: {
              borderRadius: "12px", colorBackground: "#FFFFFF",
              colorDanger: "#B42331", colorPrimary: "#08B98F",
              colorSuccess: "#17684F", colorText: "#173C39",
              fontFamily: "Arial, Helvetica, sans-serif", fontSizeBase: "16px",
              spacingUnit: "4px"
            }
          }
        });
        const form = checkout.createForm({ layout: "expanded" });
        form.mount("#checkout-form");
        const loadActionsResult = await checkout.loadActions();
        if (loadActionsResult.type !== "success") {
          throw new Error("Stripe could not prepare payment confirmation.");
        }
        form.on("confirm", async (event) => {
          try {
            await loadActionsResult.actions.confirm({ formConfirmEvent: event });
            send("confirmed");
          } catch (error) {
            showError(error);
          }
        });
        send("ready");
        reportHeight();
      } catch (error) {
        showError(error);
      }
    })();
  </script>
</body>
</html>"""


@router.get("/checkout-form", response_class=HTMLResponse, include_in_schema=False)
def checkout_form() -> HTMLResponse:
    return HTMLResponse(
        CHECKOUT_FORM_HTML,
        headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": (
                "default-src 'none'; script-src 'unsafe-inline' https://js.stripe.com "
                "https://*.stripe.com; style-src 'unsafe-inline'; frame-src https://*.stripe.com; "
                "connect-src https://*.stripe.com; img-src data: https://*.stripe.com"
            ),
        },
    )


def _money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _identifier(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get("id")
    return getattr(value, "id", None)


def _complete_checkout(checkout: Any, session: Session) -> None:
    lock_checkout_cart(session, checkout.id)
    payment = session.execute(text("""
        SELECT p.id, p.order_id, p.payment_status, p.inventory_deducted_at, o.order_status
        FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.stripe_checkout_session_id = :checkout_session_id
        FOR UPDATE OF p, o
    """), {"checkout_session_id": checkout.id}).one_or_none()
    if payment is None or payment.payment_status in {"paid", "partially_refunded", "refunded", "disputed"}:
        return
    if payment.payment_status != "pending" or payment.order_status != "pending_payment":
        raise stripe_payments.StripeOperationError("A late successful payment needs manual reconciliation; its order is no longer awaiting payment.")
    payment_intent_id = _identifier(checkout.payment_intent)
    if not payment_intent_id:
        raise stripe_payments.StripeOperationError("The completed Checkout Session has no payment.")
    payment_intent = stripe_payments.retrieve_payment_intent(payment_intent_id)
    charge_id = _identifier(payment_intent.latest_charge)
    if not charge_id:
        raise stripe_payments.StripeOperationError("The completed payment has no charge.")

    if payment.inventory_deducted_at is None:
        inventory = session.execute(text("""
            SELECT product.id, product.product_name, product.stock_quantity, item.quantity
            FROM order_items item
            JOIN products product ON product.id = item.product_id
            WHERE item.order_id = :order_id
            ORDER BY product.id
            FOR UPDATE OF product
        """), {"order_id": payment.order_id}).all()
        unavailable = next(
            (item for item in inventory if item.stock_quantity < item.quantity),
            None,
        )
        if unavailable is not None:
            raise stripe_payments.StripeOperationError(
                f"{unavailable.product_name} no longer has enough stock for the paid order."
            )
        session.execute(text("""
            UPDATE products product
            SET stock_quantity = product.stock_quantity - item.quantity
            FROM order_items item
            WHERE item.order_id = :order_id AND item.product_id = product.id
        """), {"order_id": payment.order_id})

    invoice_id = _identifier(checkout.invoice)
    hosted_invoice_url = None
    invoice_pdf_url = None
    if invoice_id:
        invoice = stripe_payments.retrieve_invoice(invoice_id)
        hosted_invoice_url = getattr(invoice, "hosted_invoice_url", None)
        invoice_pdf_url = getattr(invoice, "invoice_pdf", None)

    session.execute(text("""
        UPDATE payment_vendor_allocations
        SET transfer_status = 'transferred', transferred_at = now(),
            settlement_method = 'simulated'
        WHERE payment_id = :payment_id AND transfer_status = 'pending'
    """), {"payment_id": payment.id})

    session.execute(text("""
        UPDATE payments
        SET payment_status = 'paid', stripe_payment_intent_id = :payment_intent_id,
            stripe_charge_id = :charge_id, stripe_invoice_id = :invoice_id,
            stripe_hosted_invoice_url = :hosted_invoice_url,
            stripe_invoice_pdf_url = :invoice_pdf_url, paid_at = now(),
            inventory_deducted_at = COALESCE(inventory_deducted_at, now()),
            failure_reason = NULL
        WHERE id = :payment_id
    """), {
        "payment_id": payment.id,
        "payment_intent_id": payment_intent_id,
        "charge_id": charge_id,
        "invoice_id": invoice_id,
        "hosted_invoice_url": hosted_invoice_url,
        "invoice_pdf_url": invoice_pdf_url,
    })
    session.execute(
        text("UPDATE orders SET order_status = 'placed' WHERE id = :order_id"),
        {"order_id": payment.order_id},
    )
    consume_order_cart_snapshot(session, payment.order_id)


def _fail_checkout(checkout: Any, failure_reason: str, session: Session) -> None:
    payment = session.execute(text("""
        SELECT p.id, p.order_id, p.payment_status, p.inventory_deducted_at,
               p.inventory_released_at
        FROM payments p
        WHERE p.stripe_checkout_session_id = :checkout_session_id
        FOR UPDATE
    """), {"checkout_session_id": checkout.id}).one_or_none()
    if payment is None or payment.payment_status != "pending":
        return
    if payment.inventory_deducted_at is not None and payment.inventory_released_at is None:
        session.execute(text("""
            UPDATE products product
            SET stock_quantity = product.stock_quantity + item.quantity
            FROM order_items item
            WHERE item.order_id = :order_id AND item.product_id = product.id
        """), {"order_id": payment.order_id})
    session.execute(text("""
        UPDATE payments
        SET payment_status = 'failed', failure_reason = :failure_reason,
            inventory_released_at = COALESCE(inventory_released_at, now())
        WHERE id = :payment_id
    """), {"payment_id": payment.id, "failure_reason": failure_reason[:500]})
    session.execute(
        text("UPDATE orders SET order_status = 'cancelled' WHERE id = :order_id"),
        {"order_id": payment.order_id},
    )


def _reverse_allocations(
    *, payment_id: UUID, refunded_fraction: Decimal, reason: str, session: Session
) -> None:
    allocations = session.execute(text("""
        SELECT id, stripe_transfer_id, transfer_amount, reversed_amount
        FROM payment_vendor_allocations
        WHERE payment_id = :payment_id
        ORDER BY id
        FOR UPDATE
    """), {"payment_id": payment_id}).all()
    for allocation in allocations:
        target = min(
            _money(allocation.transfer_amount),
            _money(Decimal(allocation.transfer_amount) * refunded_fraction),
        )
        delta = _money(target - Decimal(allocation.reversed_amount))
        if delta <= 0:
            continue
        reversal_id = None
        if allocation.stripe_transfer_id:
            reversal = stripe_payments.reverse_transfer(
                allocation.stripe_transfer_id,
                allocation.id,
                int(delta * 100),
            )
            reversal_id = reversal.id
        total_reversed = _money(Decimal(allocation.reversed_amount) + delta)
        transfer_status = (
            "reversed" if total_reversed >= _money(allocation.transfer_amount)
            else "partially_reversed"
        )
        session.execute(text("""
            UPDATE payment_vendor_allocations
            SET stripe_transfer_reversal_id = :reversal_id,
                reversed_amount = :reversed_amount, transfer_status = :transfer_status,
                reversed_at = now()
            WHERE id = :allocation_id
        """), {
            "reversal_id": reversal_id,
            "reversed_amount": total_reversed,
            "transfer_status": transfer_status,
            "allocation_id": allocation.id,
        })


def _handle_order_cancellation_refund(refund: Any, session: Session) -> bool:
    metadata = getattr(refund, "metadata", None) or {}
    if metadata.get("ecochef_order_cancellation") != "true":
        return False
    order_id = metadata.get("ecochef_order_id")
    if not order_id:
        return False
    payment = session.execute(text("""
        SELECT p.id, p.inventory_deducted_at, p.inventory_released_at, o.order_status, cart.user_id
        FROM payments p JOIN orders o ON o.id = p.order_id JOIN carts cart ON cart.id=o.cart_id
        WHERE o.id = :order_id AND p.stripe_payment_intent_id = :payment_intent_id
        FOR UPDATE OF p, o
    """), {"order_id": order_id, "payment_intent_id": _identifier(refund.payment_intent)}).one_or_none()
    if payment is None or payment.order_status != "cancellation_pending":
        return False
    if refund.status in {"failed", "canceled"}:
        session.execute(text("UPDATE orders SET order_status='cancellation_failed' WHERE id=:order_id"), {"order_id": order_id})
        session.execute(text("UPDATE payments SET payment_status='paid' WHERE id=:payment_id"), {"payment_id": payment.id})
        return False
    if refund.status != "succeeded":
        return False
    _reverse_allocations(payment_id=payment.id, refunded_fraction=Decimal("1"), reason="refund", session=session)
    if payment.inventory_deducted_at is not None and payment.inventory_released_at is None:
        session.execute(text("""
            UPDATE products product SET stock_quantity = product.stock_quantity + item.quantity,
                status = CASE WHEN product.status='sold_out' THEN 'active' ELSE product.status END
            FROM order_items item WHERE item.order_id = :order_id AND item.product_id = product.id
        """), {"order_id": order_id})
    session.execute(text("""
        UPDATE payments SET payment_status='refunded', inventory_released_at=COALESCE(inventory_released_at, now())
        WHERE id=:payment_id
    """), {"payment_id": payment.id})
    session.execute(text("""
        UPDATE orders SET order_status='cancelled', cancelled_at=now() WHERE id=:order_id
    """), {"order_id": order_id})
    create_notification(session, user_id=payment.user_id, category="order", title="Order cancelled and refunded",
        message=f"Your order #{str(order_id)[:8].upper()} was cancelled by the shop. A full refund was issued to your original payment method.",
        source_key=f"vendor-order-cancelled:{order_id}", action_path=f"/marketplace/order?orderId={order_id}")
    return True


def _handle_charge_refund(charge: Any, session: Session) -> None:
    payment = session.execute(text("""
        SELECT p.id, p.order_id, o.order_status FROM payments p
        JOIN orders o ON o.id=p.order_id
        WHERE p.stripe_charge_id = :charge_id OR p.stripe_payment_intent_id = :payment_intent_id
        FOR UPDATE OF p, o
    """), {
        "charge_id": charge.id,
        "payment_intent_id": _identifier(charge.payment_intent),
    }).one_or_none()
    if payment is None or not charge.amount:
        return
    fraction = min(Decimal("1"), Decimal(charge.amount_refunded) / Decimal(charge.amount))
    _reverse_allocations(
        payment_id=payment.id, refunded_fraction=fraction, reason="refund", session=session
    )
    session.execute(text("""
        UPDATE payments SET payment_status = :payment_status WHERE id = :payment_id
    """), {
        "payment_status": "refunded" if fraction == 1 else "partially_refunded",
        "payment_id": payment.id,
    })
    if fraction == 1 and getattr(payment, "order_status", None) == "cancellation_pending":
        _handle_order_cancellation_refund(SimpleNamespace(
            payment_intent=charge.payment_intent, status="succeeded",
            metadata={"ecochef_order_cancellation": "true", "ecochef_order_id": str(payment.order_id)},
        ), session)


def _handle_dispute(dispute: Any, session: Session) -> None:
    payment = session.execute(text("""
        SELECT id FROM payments WHERE stripe_charge_id = :charge_id FOR UPDATE
    """), {"charge_id": _identifier(dispute.charge)}).one_or_none()
    if payment is None:
        return
    _reverse_allocations(
        payment_id=payment.id,
        refunded_fraction=Decimal("1"),
        reason="dispute",
        session=session,
    )
    session.execute(
        text("UPDATE payments SET payment_status = 'disputed' WHERE id = :payment_id"),
        {"payment_id": payment.id},
    )


@router.post("/webhook")
async def stripe_webhook(
    request: Request, session: Session = Depends(get_db_session)
) -> dict[str, bool]:
    payload = await request.body()
    try:
        event = stripe_payments.construct_webhook_event(
            payload, request.headers.get("stripe-signature")
        )
    except (ValueError, stripe.SignatureVerificationError) as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Stripe webhook signature.") from error
    except stripe_payments.StripeConfigurationError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(error)) from error

    if session.execute(
        text("SELECT 1 FROM stripe_webhook_events WHERE event_id = :event_id"),
        {"event_id": event.id},
    ).first():
        return {"received": True}

    refund_completed_order_id = None
    try:
        stripe_object = event.data.object
        if event.type in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
            if stripe_object.payment_status != "unpaid":
                _complete_checkout(stripe_object, session)
        elif event.type in {"checkout.session.expired", "checkout.session.async_payment_failed"}:
            _fail_checkout(stripe_object, "Stripe Checkout expired or payment failed.", session)
        elif event.type == "charge.refunded":
            _handle_charge_refund(stripe_object, session)
        elif event.type in {"refund.created", "refund.updated", "refund.failed"}:
            if _handle_order_cancellation_refund(stripe_object, session):
                refund_completed_order_id = (getattr(stripe_object, "metadata", None) or {}).get("ecochef_order_id")
        elif event.type == "charge.dispute.created":
            _handle_dispute(stripe_object, session)
        session.execute(text("""
            INSERT INTO stripe_webhook_events (event_id, event_type)
            VALUES (:event_id, :event_type)
        """), {"event_id": event.id, "event_type": event.type})
        session.commit()
    except Exception:
        session.rollback()
        raise
    if refund_completed_order_id:
        try:
            customer_id = session.execute(text("""
                SELECT cart.user_id FROM orders o JOIN carts cart ON cart.id=o.cart_id WHERE o.id=:order_id
            """), {"order_id": refund_completed_order_id}).scalar_one_or_none()
            if customer_id:
                _push_order_cancellation(session, customer_id, refund_completed_order_id)
        except Exception:
            logger.exception("Could not send refund push for order %s", refund_completed_order_id)
    return {"received": True}
