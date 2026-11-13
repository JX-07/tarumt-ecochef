from __future__ import annotations

from dataclasses import dataclass
from time import time
from typing import Any
from uuid import UUID

import stripe

from app.core.config import Settings, get_settings


INTEGRATION_IDENTIFIER = "custom_embedded_web_0001"


class StripeConfigurationError(RuntimeError):
    pass


class StripeOperationError(RuntimeError):
    pass


def expire_unpaid_checkout(checkout_session_id: str) -> None:
    try:
        sessions = _client().v1.checkout.sessions
        checkout = sessions.retrieve(checkout_session_id)
        if checkout.status == "expired":
            return
        if checkout.status != "open":
            raise StripeOperationError(
                "Your previous payment is being confirmed. Refresh your orders before paying again."
            )
        sessions.expire(checkout_session_id)
    except stripe.StripeError as error:
        raise StripeOperationError(
            "The previous checkout could not be closed. Please try again shortly."
        ) from error


@dataclass(frozen=True)
class CheckoutSessionResult:
    id: str
    client_secret: str


def _client(settings: Settings | None = None) -> stripe.StripeClient:
    resolved = settings or get_settings()
    if resolved.stripe_api_key is None:
        raise StripeConfigurationError(
            "Stripe sandbox is not configured. Add a fresh restricted test key to STRIPE_API_KEY."
        )
    return stripe.StripeClient(
        resolved.stripe_api_key.get_secret_value(),
        stripe_version=resolved.stripe_api_version,
        max_network_retries=2,
    )


def create_checkout_session(
    *,
    order_id: UUID,
    payment_id: UUID,
    customer_email: str,
    line_items: list[dict[str, Any]],
    settings: Settings | None = None,
) -> CheckoutSessionResult:
    resolved = settings or get_settings()
    try:
        checkout = _client(resolved).v1.checkout.sessions.create(
            {
                "ui_mode": "form",
                "mode": "payment",
                "billing_address_collection": "auto",
                "phone_number_collection": {"enabled": False},
                "automatic_tax": {"enabled": False},
                "submit_type": "pay",
                "client_reference_id": str(order_id),
                "customer_creation": "always",
                "customer_email": customer_email,
                "line_items": line_items,
                "expires_at": int(time()) + 30 * 60,
                "integration_identifier": INTEGRATION_IDENTIFIER,
                "invoice_creation": {
                    "enabled": True,
                    "invoice_data": {
                        "description": f"EcoChef marketplace order {order_id}",
                        "footer": "Thank you for reducing food waste with EcoChef.",
                        "metadata": {"ecochef_order_id": str(order_id)},
                    },
                },
                "metadata": {
                    "ecochef_order_id": str(order_id),
                    "ecochef_payment_id": str(payment_id),
                },
                "payment_intent_data": {
                    "metadata": {
                        "ecochef_order_id": str(order_id),
                        "ecochef_payment_id": str(payment_id),
                    },
                },
            },
            {"idempotency_key": f"ecochef-checkout-{payment_id}"},
        )
    except stripe.StripeError as error:
        raise StripeOperationError(
            error.user_message or "Stripe could not create the checkout."
        ) from error
    if not checkout.client_secret:
        raise StripeOperationError("Stripe did not return a Checkout Form client secret.")
    return CheckoutSessionResult(id=checkout.id, client_secret=checkout.client_secret)


def construct_webhook_event(payload: bytes, signature: str | None) -> stripe.Event:
    settings = get_settings()
    if settings.stripe_webhook_secret is None:
        raise StripeConfigurationError("STRIPE_WEBHOOK_SECRET is not configured.")
    return stripe.Webhook.construct_event(
        payload,
        signature,
        settings.stripe_webhook_secret.get_secret_value(),
    )


def retrieve_payment_intent(payment_intent_id: str) -> Any:
    try:
        return _client().v1.payment_intents.retrieve(
            payment_intent_id, {"expand": ["latest_charge"]}
        )
    except stripe.StripeError as error:
        raise StripeOperationError("Stripe payment details could not be retrieved.") from error


def refund_order_payment(*, payment_intent_id: str, order_id: UUID) -> Any:
    try:
        return _client().v1.refunds.create(
            {
                "payment_intent": payment_intent_id,
                "metadata": {
                    "ecochef_order_id": str(order_id),
                    "ecochef_order_cancellation": "true",
                },
            },
            {"idempotency_key": f"ecochef-order-cancel-{order_id}"},
        )
    except stripe.StripeError as error:
        raise StripeOperationError("Stripe could not refund this order.") from error


def create_sandbox_payment(
    *, order_id: UUID, payment_id: UUID, amount: int, settings: Settings | None = None
) -> Any:
    """Create a real Stripe sandbox transaction using Stripe's documented test PaymentMethod."""
    resolved = settings or get_settings()
    if resolved.stripe_api_key is None or not resolved.stripe_api_key.get_secret_value().startswith(
        ("sk_test_", "rk_test_")
    ):
        raise StripeConfigurationError("One-tap test payments require a Stripe sandbox key.")
    try:
        payment_intent = _client(resolved).v1.payment_intents.create(
            {
                "amount": amount,
                "currency": resolved.stripe_currency.lower(),
                "payment_method": "pm_card_visa",
                "confirm": True,
                "automatic_payment_methods": {
                    "enabled": True,
                    "allow_redirects": "never",
                },
                "expand": ["latest_charge"],
                "description": f"EcoChef marketplace test order {order_id}",
                "metadata": {
                    "ecochef_order_id": str(order_id),
                    "ecochef_payment_id": str(payment_id),
                    "ecochef_test_payment": "true",
                },
            },
            {"idempotency_key": f"ecochef-sandbox-payment-{payment_id}"},
        )
    except stripe.StripeError as error:
        stripe_message = error.user_message or getattr(error, "message", None) or str(error)
        raise StripeOperationError(
            f"Stripe could not complete the sandbox payment: {stripe_message}"
        ) from error
    if payment_intent.status != "succeeded":
        raise StripeOperationError(
            f"Stripe sandbox payment was not completed ({payment_intent.status})."
        )
    return payment_intent


def retrieve_invoice(invoice_id: str) -> Any:
    try:
        return _client().v1.invoices.retrieve(invoice_id)
    except stripe.StripeError as error:
        raise StripeOperationError("Stripe invoice details could not be retrieved.") from error


def create_transfer(
    *, destination: str, amount: int, charge_id: str, order_id: UUID, allocation_id: UUID
) -> Any:
    try:
        return _client().v1.transfers.create(
            {
                "amount": amount,
                "currency": get_settings().stripe_currency.lower(),
                "destination": destination,
                "source_transaction": charge_id,
                "transfer_group": f"ORDER_{order_id}",
                "metadata": {
                    "ecochef_order_id": str(order_id),
                    "ecochef_allocation_id": str(allocation_id),
                },
            },
            {"idempotency_key": f"ecochef-transfer-{allocation_id}"},
        )
    except stripe.StripeError as error:
        raise StripeOperationError("Stripe could not create a vendor transfer.") from error


def reverse_transfer(transfer_id: str, allocation_id: UUID, amount: int) -> Any:
    try:
        return _client().v1.transfers.reversals.create(
            transfer_id,
            {"amount": amount},
            {"idempotency_key": f"ecochef-reversal-{allocation_id}-{amount}"},
        )
    except stripe.StripeError as error:
        raise StripeOperationError("Stripe could not reverse a vendor transfer.") from error


def create_recipient_account(*, store_id: UUID, name: str, email: str) -> Any:
    try:
        return _client().v2.core.accounts.create(
            {
                "display_name": name,
                "contact_email": email,
                "dashboard": "express",
                "identity": {"country": "MY"},
                "configuration": {
                    "recipient": {
                        "capabilities": {
                            "stripe_balance": {"stripe_transfers": {"requested": True}}
                        }
                    }
                },
                "defaults": {
                    "responsibilities": {
                        "fees_collector": "application",
                        "losses_collector": "application",
                    }
                },
                "metadata": {"ecochef_store_id": str(store_id)},
                "include": ["configuration.recipient", "requirements", "defaults"],
            },
            {"idempotency_key": f"ecochef-recipient-{store_id}"},
        )
    except stripe.StripeError as error:
        if getattr(error, "code", None) == "non_connect_platform_accounts_v2_access_blocked":
            raise StripeConfigurationError(
                "Stripe Connect is not enabled for this sandbox. Complete the Connect "
                "platform setup in Stripe Dashboard, then try again."
            ) from error
        if "losses collector" in str(error).lower():
            raise StripeConfigurationError(
                "EcoChef's Stripe Platform profile is incomplete. Complete the negative-balance "
                "liability acknowledgement in Stripe Dashboard, then try vendor setup again."
            ) from error
        if "platforms in my cannot create accounts" in str(error).lower():
            raise StripeConfigurationError(
                "Stripe does not allow Malaysia-based platforms to create vendor accounts with "
                "EcoChef's current multi-shop payout configuration. Choose a Malaysia-compatible "
                "payment and payout model before onboarding vendors."
            ) from error
        raise StripeOperationError(
            "Stripe could not create the vendor recipient account."
        ) from error


def retrieve_recipient_account(account_id: str) -> Any:
    try:
        return _client().v2.core.accounts.retrieve(
            account_id,
            {"include": ["configuration.recipient", "requirements", "future_requirements"]},
        )
    except stripe.StripeError as error:
        raise StripeOperationError("Stripe could not retrieve the vendor account.") from error


def create_embedded_account_session(account_id: str) -> str:
    try:
        session = _client().v1.account_sessions.create(
            {
                "account": account_id,
                "components": {
                    "account_onboarding": {"enabled": True},
                    "notification_banner": {"enabled": True},
                    "account_management": {"enabled": True},
                    "payouts": {"enabled": True},
                },
            }
        )
    except stripe.StripeError as error:
        raise StripeOperationError("Stripe could not start embedded vendor onboarding.") from error
    return session.client_secret


def create_express_login_link(account_id: str) -> str:
    try:
        link = _client().v1.accounts.login_links.create(account_id)
    except stripe.StripeError as error:
        raise StripeOperationError("Stripe could not create an Express Dashboard link.") from error
    return link.url


def nested_value(value: Any, *path: str, default: Any = None) -> Any:
    current = value
    for key in path:
        if current is None:
            return default
        if isinstance(current, dict):
            current = current.get(key)
        else:
            current = getattr(current, key, None)
    return default if current is None else current
