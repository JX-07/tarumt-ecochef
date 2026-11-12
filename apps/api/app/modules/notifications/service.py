import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from urllib.error import URLError
from urllib.request import Request, urlopen
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings


logger = logging.getLogger(__name__)
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


PICKUP_ADDRESS = "Customer pickup directly from store"


def ensure_preferences(session: Session, user_id: UUID) -> None:
    session.execute(
        text("INSERT INTO notification_preferences (user_id) VALUES (:user_id) ON CONFLICT (user_id) DO NOTHING"),
        {"user_id": user_id},
    )


def create_notification(
    session: Session,
    *,
    user_id: UUID,
    category: str,
    title: str,
    message: str,
    source_key: str,
    action_path: str | None = None,
    metadata: dict | None = None,
) -> bool:
    result = session.execute(text("""
        INSERT INTO notifications
            (user_id, category, title, message, source_key, action_path, metadata)
        VALUES
            (:user_id, :category, :title, :message, :source_key, :action_path,
             CAST(:metadata AS jsonb))
        ON CONFLICT (user_id, source_key) DO NOTHING
        RETURNING id
    """), {
        "user_id": user_id,
        "category": category,
        "title": title,
        "message": message,
        "source_key": source_key,
        "action_path": action_path,
        "metadata": json.dumps(metadata or {}),
    })
    return result.scalar_one_or_none() is not None


def send_push_notification(
    session: Session,
    *,
    user_id: UUID,
    title: str,
    message: str,
    action_path: str | None = None,
) -> None:
    """Best-effort delivery; the saved in-app notification remains authoritative."""
    tokens = session.execute(text("""
        SELECT expo_push_token FROM user_push_tokens
        WHERE user_id = :user_id ORDER BY updated_at DESC LIMIT 100
    """), {"user_id": user_id}).scalars().all()
    if not tokens:
        return
    payload = [{
        "to": token,
        "title": title,
        "body": message,
        "sound": "default",
        "priority": "high",
        "data": {"action_path": action_path} if action_path else {},
    } for token in tokens]
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    access_token = get_settings().expo_push_access_token
    if access_token:
        headers["Authorization"] = f"Bearer {access_token.get_secret_value()}"
    request = Request(
        EXPO_PUSH_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            response.read()
    except (OSError, URLError, TimeoutError):
        logger.warning("Expo push delivery failed for user_id=%s", user_id, exc_info=True)


def sync_consumer_notifications(session: Session, user_id: UUID) -> None:
    """Create idempotent alerts from current EcoChef domain data."""
    ensure_preferences(session, user_id)
    preferences = session.execute(text("""
        SELECT sensor_alerts, ingredient_expiry, meal_reminders,
               payment_updates, delivery_updates
        FROM notification_preferences WHERE user_id = :user_id
    """), {"user_id": user_id}).one()

    if preferences.ingredient_expiry:
        rows = session.execute(text("""
            SELECT ingredient.id, ingredient.ingredient_name, item.expiry_date,
                   (item.expiry_date::date - CURRENT_DATE) AS days_left
            FROM ingredient_inventories inventory
            JOIN ingredient_inventory_items item
              ON item.ingredient_inventory_id = inventory.id
            JOIN ingredients ingredient ON ingredient.id = item.ingredient_id
            WHERE inventory.user_id = :user_id
              AND item.expiry_date::date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 3
        """), {"user_id": user_id}).all()
        for row in rows:
            days = int(row.days_left)
            if days < 0:
                title = f"{row.ingredient_name} may have gone bad"
                message = "Check it before using it and remove it from your Ingredient List if needed."
            elif days == 0:
                title = f"{row.ingredient_name} expires today"
                message = "Use it today to reduce food waste."
            elif days == 1:
                title = f"{row.ingredient_name} expires tomorrow"
                message = "Plan to use it soon while it is still fresh."
            else:
                title = f"{row.ingredient_name} expires in {days} days"
                message = "Add it to an upcoming meal before it goes bad."
            create_notification(
                session,
                user_id=user_id,
                category="ingredient_expiry",
                title=title,
                message=message,
                source_key=f"ingredient:{row.id}:{row.expiry_date.date().isoformat()}",
                action_path="/(tabs)/inventory",
                metadata={"ingredient_id": str(row.id), "days_left": days},
            )

    if preferences.meal_reminders:
        rows = session.execute(text("""
            SELECT entry.id, entry.scheduled_date, entry.scheduled_time,
                   recipe.id AS recipe_id, recipe.title
            FROM meal_plan_recipes entry
            JOIN meal_plans plan ON plan.id = entry.meal_plan_id
            JOIN recipes recipe ON recipe.id = entry.recipe_id
            WHERE plan.user_id = :user_id
              AND entry.scheduled_time IS NOT NULL
              AND (entry.scheduled_date + entry.scheduled_time)
                  BETWEEN (now() AT TIME ZONE 'Asia/Kuala_Lumpur')
                  AND (now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '60 minutes'
        """), {"user_id": user_id}).all()
        for row in rows:
            display_time = row.scheduled_time.strftime("%I:%M %p").lstrip("0")
            create_notification(
                session,
                user_id=user_id,
                category="meal_reminder",
                title="Your scheduled meal is coming up",
                message=f"{row.title} is planned for {display_time}.",
                source_key=f"meal:{row.id}:{row.scheduled_date}:{row.scheduled_time}",
                action_path=f"/recipes/{row.recipe_id}",
                metadata={"meal_plan_entry_id": str(row.id), "recipe_id": str(row.recipe_id)},
            )

    if preferences.payment_updates:
        rows = session.execute(text("""
            SELECT payment.id, payment.order_id, payment.amount,
                   COALESCE(payment.paid_at, payment.payment_date) AS paid_at
            FROM payments payment
            JOIN orders orders ON orders.id = payment.order_id
            JOIN carts cart ON cart.id = orders.cart_id
            WHERE cart.user_id = :user_id AND payment.payment_status = 'paid'
              AND COALESCE(payment.paid_at, payment.payment_date) >= now() - interval '7 days'
        """), {"user_id": user_id}).all()
        for row in rows:
            amount = Decimal(row.amount).quantize(Decimal("0.01"))
            create_notification(
                session,
                user_id=user_id,
                category="payment",
                title="Payment successful",
                message=f"Your RM {amount} payment was successful.",
                source_key=f"payment:{row.id}:paid",
                action_path=f"/marketplace/order?orderId={row.order_id}",
                metadata={"payment_id": str(row.id), "order_id": str(row.order_id)},
            )

    if preferences.delivery_updates:
        rows = session.execute(text("""
            SELECT orders.id, orders.delivery_address, orders.order_status
            FROM orders
            JOIN carts cart ON cart.id = orders.cart_id
            JOIN payments payment ON payment.order_id = orders.id
            WHERE cart.user_id = :user_id
              AND payment.payment_status = 'paid'
              AND orders.order_status = 'ready'
              AND orders.order_date >= now() - interval '2 days'
        """), {"user_id": user_id}).all()
        for row in rows:
            pickup = row.delivery_address == PICKUP_ADDRESS
            create_notification(
                session,
                user_id=user_id,
                category="delivery",
                title="Your order is ready for pickup" if pickup else "Your delivery driver is arriving soon",
                message=(
                    "Your order is ready. Head to the store when you are ready to collect it."
                    if pickup else
                    "Your order is on its final step. Please be ready to receive it."
                ),
                source_key=f"order:{row.id}:ready",
                action_path=f"/marketplace/order?orderId={row.id}&fulfillment={'pickup' if pickup else 'delivery'}",
                metadata={"order_id": str(row.id), "fulfillment_method": "pickup" if pickup else "delivery"},
            )


def record_sensor_alert(
    session: Session,
    *,
    user_id: UUID,
    sensor_id: str,
    alert_code: str,
    title: str,
    message: str,
    reading: float | None,
    unit: str | None,
    action_path: str | None = None,
) -> bool:
    ensure_preferences(session, user_id)
    enabled = session.execute(
        text("SELECT sensor_alerts FROM notification_preferences WHERE user_id = :user_id"),
        {"user_id": user_id},
    ).scalar_one()
    if not enabled:
        return False
    # One alert per sensor/code/hour prevents noisy repeated readings from flooding the user.
    hour = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
    return create_notification(
        session,
        user_id=user_id,
        category="sensor_alert",
        title=title,
        message=message,
        source_key=f"sensor:{sensor_id}:{alert_code}:{hour}",
        action_path=action_path or "/fridge-sensors",
        metadata={"sensor_id": sensor_id, "alert_code": alert_code, "reading": reading, "unit": unit},
    )
