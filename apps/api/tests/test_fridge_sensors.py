from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.modules.fridge_sensors.service import connection_status, should_create_spoilage_alert
from app.schemas.fridge_sensors import ClaimFridgeSensorRequest, PairFridgeSensorRequest, FridgeSensorReadingInput, ResolveFridgeSensorSetupRequest
from app.api.v1.endpoints import fridge_sensors


def _reading(**overrides):
    return FridgeSensorReadingInput(mq3=10, mq135=20, mq136=30, mq137=40, temperature_c=4, humidity_percent=50, **overrides)


@pytest.mark.parametrize("captured_at", [datetime(2026, 1, 1), datetime.now(timezone.utc) + timedelta(hours=1)])
def test_sensor_rejects_ambiguous_or_impossible_capture_times(captured_at):
    with pytest.raises(ValidationError):
        _reading(captured_at=captured_at)


@pytest.mark.parametrize("field,value", [("sensor_name", "   "), ("fridge_name", "   "), ("device_code", "  a ")])
def test_sensor_pairing_rejects_blank_normalized_names(field, value):
    fields = dict(device_code="ENOSE-123", sensor_name="Sensor", fridge_name="Fridge")
    fields[field] = value
    with pytest.raises(ValidationError):
        PairFridgeSensorRequest(**fields)


def test_buffered_old_sensor_reading_does_not_send_a_current_spoilage_alert(monkeypatch):
    session = Mock()
    sensor = SimpleNamespace(id=uuid4(), user_id=uuid4(), sensor_name="Nose", fridge_name="Kitchen")
    sensor_result, insert_result, risk_result = Mock(), Mock(), Mock()
    sensor_result.one_or_none.return_value = sensor
    insert_result.scalar_one.return_value = 1
    risk_result.scalar_one.return_value = 2
    session.execute.side_effect = [sensor_result, insert_result, Mock(), risk_result]
    create = Mock()
    monkeypatch.setattr(fridge_sensors, "record_sensor_alert", create)
    capture = datetime.now(timezone.utc) - timedelta(hours=2)
    result = fridge_sensors.ingest_fridge_sensor_reading(_reading(captured_at=capture, freshness_status="spoiled", confidence=.95), "sensor-key-with-twenty-characters", session)
    assert not result.alert_created
    create.assert_not_called()
    # Connectivity reflects the receipt of the buffered data, not its old sample date.
    heartbeat = session.execute.call_args_list[2].args[1]["received_at"]
    assert heartbeat > capture + timedelta(hours=1)


def test_pair_request_normalizes_device_code_and_names() -> None:
    request = PairFridgeSensorRequest(
        device_code="  enose-a1b2  ",
        sensor_name="  EcoChef nose  ",
        fridge_name="  Kitchen fridge  ",
    )

    assert request.device_code == "ENOSE-A1B2"
    assert request.sensor_name == "EcoChef nose"
    assert request.fridge_name == "Kitchen fridge"


def test_claim_request_normalizes_factory_identity() -> None:
    request = ClaimFridgeSensorRequest(
        device_code="  enose-a1b2c3 ", claim_secret="x" * 24,
        sensor_name=" EcoChef Sensor Set ", fridge_name=" Kitchen fridge ",
    )
    assert request.device_code == "ENOSE-A1B2C3"
    assert request.sensor_name == "EcoChef Sensor Set"
    assert request.fridge_name == "Kitchen fridge"


def test_manual_claim_normalizes_printed_setup_code() -> None:
    request = ClaimFridgeSensorRequest(
        setup_code=" ab12-cd34-ef56 ", sensor_name="Sensor", fridge_name="Fridge"
    )
    assert request.setup_code == "AB12CD34EF56"
    assert request.device_code is None


def test_resolve_request_normalizes_printed_setup_code() -> None:
    assert ResolveFridgeSensorSetupRequest(setup_code=" ab12-cd34-ef56 ").setup_code == "AB12CD34EF56"


def test_spoilage_alert_requires_repeated_high_confidence_result() -> None:
    assert not should_create_spoilage_alert(
        freshness_status="spoiled", confidence=0.95, consecutive_high_risk_readings=1
    )
    assert not should_create_spoilage_alert(
        freshness_status="spoiled", confidence=0.70, consecutive_high_risk_readings=2
    )
    assert should_create_spoilage_alert(
        freshness_status="spoiled", confidence=0.91, consecutive_high_risk_readings=2
    )


def test_connection_status_distinguishes_waiting_live_and_offline() -> None:
    now = datetime.now(timezone.utc)
    assert connection_status(None) == "waiting"
    assert connection_status(now - timedelta(minutes=2)) == "online"
    assert connection_status(now - timedelta(minutes=8)) == "offline"
