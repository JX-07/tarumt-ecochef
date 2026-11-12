from datetime import date, datetime, time, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from app.modules.notifications import service


class _Result:
    def __init__(self, *, rows=None, one=None, scalar=None):
        self._rows = rows or []
        self._one = one
        self._scalar = scalar

    def all(self):
        return self._rows

    def one(self):
        return self._one

    def scalar_one(self):
        return self._scalar


class _NotificationSession:
    def execute(self, statement, _params=None):
        sql = str(statement)
        if "INSERT INTO notification_preferences" in sql:
            return _Result()
        if "FROM notification_preferences WHERE user_id" in sql:
            return _Result(one=SimpleNamespace(
                sensor_alerts=True,
                ingredient_expiry=True,
                meal_reminders=True,
                payment_updates=True,
                delivery_updates=True,
            ))
        if "FROM ingredient_inventories inventory" in sql:
            return _Result(rows=[SimpleNamespace(
                id=uuid4(), ingredient_name="Spinach",
                expiry_date=datetime(2026, 10, 26, tzinfo=timezone.utc), days_left=1,
            )])
        if "FROM meal_plan_recipes entry" in sql:
            return _Result(rows=[SimpleNamespace(
                id=uuid4(), scheduled_date=date(2026, 10, 25), scheduled_time=time(19, 30),
                recipe_id=uuid4(), title="Vegetable soup",
            )])
        if "FROM payments payment" in sql:
            return _Result(rows=[SimpleNamespace(
                id=uuid4(), order_id=uuid4(), amount=Decimal("12.50"),
                paid_at=datetime.now(timezone.utc),
            )])
        if "FROM orders" in sql:
            return _Result(rows=[SimpleNamespace(
                id=uuid4(), delivery_address="12 Jalan Ampang", order_status="ready",
            )])
        raise AssertionError(f"Unexpected SQL: {sql}")


def test_sync_creates_each_data_backed_consumer_notification(monkeypatch) -> None:
    created = []
    monkeypatch.setattr(service, "create_notification", lambda _session, **notification: created.append(notification))

    service.sync_consumer_notifications(_NotificationSession(), uuid4())

    assert {item["category"] for item in created} == {
        "ingredient_expiry", "meal_reminder", "payment", "delivery",
    }
    assert next(item for item in created if item["category"] == "ingredient_expiry")["action_path"] == "/(tabs)/inventory"
    assert "RM 12.50" in next(item for item in created if item["category"] == "payment")["message"]
    assert "driver" in next(item for item in created if item["category"] == "delivery")["title"].lower()


def test_sensor_alerts_are_grouped_by_sensor_code_and_hour(monkeypatch) -> None:
    session = Mock()
    session.execute.side_effect = [_Result(), _Result(scalar=True)]
    created = []
    monkeypatch.setattr(service, "create_notification", lambda _session, **notification: created.append(notification))

    service.record_sensor_alert(
        session,
        user_id=uuid4(),
        sensor_id="fridge-1",
        alert_code="temperature-high",
        title="Fridge temperature is high",
        message="Check the fridge door.",
        reading=9.2,
        unit="°C",
    )

    assert len(created) == 1
    assert created[0]["category"] == "sensor_alert"
    assert created[0]["source_key"].startswith("sensor:fridge-1:temperature-high:")
    assert created[0]["metadata"]["reading"] == 9.2


def test_disabled_sensor_alerts_are_not_created(monkeypatch) -> None:
    session = Mock()
    session.execute.side_effect = [_Result(), _Result(scalar=False)]
    create = Mock()
    monkeypatch.setattr(service, "create_notification", create)

    service.record_sensor_alert(
        session,
        user_id=uuid4(),
        sensor_id="fridge-1",
        alert_code="door-open",
        title="Fridge door is open",
        message="Close the fridge door.",
        reading=None,
        unit=None,
    )

    create.assert_not_called()



def test_moderation_outcomes_can_be_serialized_in_the_notification_inbox():
    from datetime import datetime, timezone
    from uuid import uuid4
    from app.schemas.notifications import NotificationItem
    notification = NotificationItem(id=uuid4(),category="moderation",title="Recipe feedback decision",message="The feedback flag has been dismissed.",created_at=datetime.now(timezone.utc),action_path="/reports")
    assert notification.category == "moderation"
