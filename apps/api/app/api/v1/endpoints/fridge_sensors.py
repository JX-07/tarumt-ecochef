from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.modules.fridge_sensors.service import connection_status, should_create_spoilage_alert
from app.modules.notifications.service import record_sensor_alert, send_push_notification
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.fridge_sensors import (
    FridgeSensorDetail,
    FridgeSensorList,
    FridgeSensorReading,
    FridgeSensorReadingAccepted,
    FridgeSensorReadingInput,
    FridgeSensorSummary,
    ClaimFridgeSensorRequest,
    ClaimFridgeSensorResponse,
    PairFridgeSensorRequest,
    PairFridgeSensorResponse,
    ResolveFridgeSensorSetupRequest,
    ResolveFridgeSensorSetupResponse,
)

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


def _hash_ingest_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _reading(row) -> FridgeSensorReading | None:
    if row is None or row.reading_id is None:
        return None
    return FridgeSensorReading(
        id=row.reading_id,
        captured_at=row.captured_at,
        mq3=row.mq3,
        mq135=row.mq135,
        mq136=row.mq136,
        mq137=row.mq137,
        temperature_c=row.temperature_c,
        humidity_percent=row.humidity_percent,
        freshness_status=row.freshness_status,
        confidence=row.confidence,
        model_version=row.model_version,
    )


def _summary(row) -> FridgeSensorSummary:
    return FridgeSensorSummary(
        id=row.id,
        device_code=row.device_code,
        sensor_name=row.sensor_name,
        fridge_name=row.fridge_name,
        connection_status=connection_status(row.last_seen_at),
        created_at=row.created_at,
        last_seen_at=row.last_seen_at,
        latest_reading=_reading(row),
    )


LATEST_READING_SELECT = """
    SELECT sensor.id, sensor.device_code, sensor.sensor_name, sensor.fridge_name,
           sensor.created_at, sensor.last_seen_at,
           latest.id AS reading_id, latest.captured_at,
           latest.mq3, latest.mq135, latest.mq136, latest.mq137,
           latest.temperature_c, latest.humidity_percent,
           latest.freshness_status, latest.confidence, latest.model_version
    FROM fridge_sensors sensor
    LEFT JOIN LATERAL (
        SELECT reading.* FROM fridge_sensor_readings reading
        WHERE reading.sensor_id = sensor.id
        ORDER BY reading.captured_at DESC LIMIT 1
    ) latest ON true
"""


@router.get("", response_model=FridgeSensorList)
def list_fridge_sensors(
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> FridgeSensorList:
    rows = session.execute(
        text(
            LATEST_READING_SELECT
            + """
        WHERE sensor.user_id = :user_id
        ORDER BY sensor.created_at
    """
        ),
        {"user_id": current_user.id},
    ).all()
    return FridgeSensorList(items=[_summary(row) for row in rows])


@router.post("", response_model=PairFridgeSensorResponse, status_code=status.HTTP_201_CREATED)
def pair_fridge_sensor(
    request: PairFridgeSensorRequest,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> PairFridgeSensorResponse:
    ingest_key = secrets.token_urlsafe(32)
    try:
        sensor_id = session.execute(
            text("""
            INSERT INTO fridge_sensors
                (user_id, device_code, sensor_name, fridge_name, ingest_token_hash)
            VALUES
                (:user_id, :device_code, :sensor_name, :fridge_name, :ingest_token_hash)
            RETURNING id
        """),
            {
                "user_id": current_user.id,
                "device_code": request.device_code,
                "sensor_name": request.sensor_name,
                "fridge_name": request.fridge_name,
                "ingest_token_hash": _hash_ingest_key(ingest_key),
            },
        ).scalar_one()
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That device code is already linked."
        ) from exc

    row = session.execute(
        text(
            LATEST_READING_SELECT
            + """
        WHERE sensor.id = :sensor_id AND sensor.user_id = :user_id
    """
        ),
        {"sensor_id": sensor_id, "user_id": current_user.id},
    ).one()
    summary = _summary(row)
    return PairFridgeSensorResponse(**summary.model_dump(), ingest_key=ingest_key)


@router.post(
    "/claim", response_model=ClaimFridgeSensorResponse, status_code=status.HTTP_201_CREATED
)
def claim_fridge_sensor(
    request: ClaimFridgeSensorRequest,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> ClaimFridgeSensorResponse:
    """Claim a factory-provisioned sensor using the one-time secret in its QR label."""
    setup_code_hash = _hash_ingest_key(request.setup_code) if request.setup_code else None
    device = session.execute(
        text("""
        SELECT device_code, claim_secret_hash, setup_code_hash, ble_name, claimed_at
        FROM sensor_provisioning_devices
        WHERE (:device_code IS NOT NULL AND device_code = :device_code)
           OR (:setup_code_hash IS NOT NULL AND setup_code_hash = :setup_code_hash)
        FOR UPDATE
    """),
        {"device_code": request.device_code, "setup_code_hash": setup_code_hash},
    ).one_or_none()
    supplied_hash = (
        _hash_ingest_key(request.claim_secret) if request.claim_secret else setup_code_hash
    )
    expected_hash = (
        device.claim_secret_hash
        if device is not None and request.claim_secret
        else device.setup_code_hash
        if device is not None
        else ""
    )
    if (
        device is None
        or supplied_hash is None
        or not secrets.compare_digest(expected_hash, supplied_hash)
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "That EcoChef sensor setup code is invalid."
        )
    if device.claimed_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That EcoChef sensor is already connected to an account."
        )

    ingest_key = secrets.token_urlsafe(32)
    try:
        sensor_id = session.execute(
            text("""
            INSERT INTO fridge_sensors
                (user_id, device_code, sensor_name, fridge_name, ingest_token_hash)
            VALUES
                (:user_id, :device_code, :sensor_name, :fridge_name, :ingest_token_hash)
            RETURNING id
        """),
            {
                "user_id": current_user.id,
                "device_code": device.device_code,
                "sensor_name": request.sensor_name,
                "fridge_name": request.fridge_name,
                "ingest_token_hash": _hash_ingest_key(ingest_key),
            },
        ).scalar_one()
        session.execute(
            text("""
            UPDATE sensor_provisioning_devices
            SET claimed_at = now(), claimed_user_id = :user_id, claimed_sensor_id = :sensor_id
            WHERE device_code = :device_code
        """),
            {"user_id": current_user.id, "sensor_id": sensor_id, "device_code": device.device_code},
        )
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That EcoChef sensor is already connected."
        ) from exc

    row = session.execute(
        text(
            LATEST_READING_SELECT
            + """
        WHERE sensor.id = :sensor_id AND sensor.user_id = :user_id
    """
        ),
        {"sensor_id": sensor_id, "user_id": current_user.id},
    ).one()
    summary = _summary(row)
    return ClaimFridgeSensorResponse(
        **summary.model_dump(), ingest_key=ingest_key, ble_name=device.ble_name
    )


@router.post("/resolve", response_model=ResolveFridgeSensorSetupResponse)
def resolve_fridge_sensor_setup(
    request: ResolveFridgeSensorSetupRequest,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> ResolveFridgeSensorSetupResponse:
    """Resolve the printed fallback code to non-secret BLE discovery information."""
    device = session.execute(
        text("""
        SELECT device_code, ble_name
        FROM sensor_provisioning_devices
        WHERE setup_code_hash = :setup_code_hash AND claimed_at IS NULL
    """),
        {"setup_code_hash": _hash_ingest_key(request.setup_code)},
    ).one_or_none()
    if device is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "That EcoChef sensor setup code was not found."
        )
    return ResolveFridgeSensorSetupResponse(
        device_code=device.device_code, ble_name=device.ble_name
    )


@router.post("/readings", response_model=FridgeSensorReadingAccepted)
def ingest_fridge_sensor_reading(
    request: FridgeSensorReadingInput,
    x_sensor_key: str = Header(min_length=20, max_length=200),
    session: Session = Depends(get_db_session),
) -> FridgeSensorReadingAccepted:
    sensor = session.execute(
        text("""
        SELECT id, user_id, sensor_name, fridge_name
        FROM fridge_sensors WHERE ingest_token_hash = :token_hash FOR UPDATE
    """),
        {"token_hash": _hash_ingest_key(x_sensor_key)},
    ).one_or_none()
    if sensor is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "The sensor key is invalid.")

    received_at = datetime.now(timezone.utc)
    captured_at = request.captured_at or received_at
    reading_id = session.execute(
        text("""
        INSERT INTO fridge_sensor_readings
            (sensor_id, captured_at, mq3, mq135, mq136, mq137,
             temperature_c, humidity_percent, freshness_status, confidence, model_version)
        VALUES
            (:sensor_id, :captured_at, :mq3, :mq135, :mq136, :mq137,
             :temperature_c, :humidity_percent, :freshness_status, :confidence, :model_version)
        RETURNING id
    """),
        {
            "sensor_id": sensor.id,
            "captured_at": captured_at,
            **request.model_dump(exclude={"captured_at"}),
        },
    ).scalar_one()
    session.execute(
        text("""
        UPDATE fridge_sensors SET last_seen_at = :received_at, updated_at = now()
        WHERE id = :sensor_id
    """),
        {"received_at": received_at, "sensor_id": sensor.id},
    )

    recent_high_risk = session.execute(
        text("""
        SELECT COUNT(DISTINCT captured_at) FROM (
            SELECT captured_at, freshness_status, confidence
            FROM fridge_sensor_readings
            WHERE sensor_id = :sensor_id AND captured_at BETWEEN :cutoff AND :latest
            ORDER BY captured_at DESC, id DESC LIMIT 2
        ) recent
        WHERE freshness_status = 'spoiled' AND confidence >= 0.85
    """),
        {
            "sensor_id": sensor.id,
            "cutoff": received_at - timedelta(minutes=30),
            "latest": received_at + timedelta(minutes=5),
        },
    ).scalar_one()

    alert_created = False
    if captured_at >= received_at - timedelta(minutes=5) and should_create_spoilage_alert(
        freshness_status=request.freshness_status,
        confidence=request.confidence,
        consecutive_high_risk_readings=int(recent_high_risk),
    ):
        title = f"Check {sensor.fridge_name}"
        message = (
            "Repeated odour readings strongly suggest a spoilage pattern. "
            "Inspect the food and follow normal food-safety guidance."
        )
        alert_created = record_sensor_alert(
            session,
            user_id=sensor.user_id,
            sensor_id=str(sensor.id),
            alert_code="spoilage-pattern-high",
            title=title,
            message=message,
            reading=request.confidence,
            unit="confidence",
            action_path=f"/fridge-sensors/{sensor.id}",
        )
    session.commit()

    if alert_created:
        send_push_notification(
            session,
            user_id=sensor.user_id,
            title=title,
            message=message,
            action_path=f"/fridge-sensors/{sensor.id}",
        )
    return FridgeSensorReadingAccepted(reading_id=reading_id, alert_created=alert_created)


@router.get("/{sensor_id}", response_model=FridgeSensorDetail)
def get_fridge_sensor(
    sensor_id: UUID,
    hours: int = Query(default=24, ge=1, le=168),
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> FridgeSensorDetail:
    row = session.execute(
        text(
            LATEST_READING_SELECT
            + """
        WHERE sensor.id = :sensor_id AND sensor.user_id = :user_id
    """
        ),
        {"sensor_id": sensor_id, "user_id": current_user.id},
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fridge Sensor not found.")
    readings = session.execute(
        text("""
        SELECT recent.* FROM (
            SELECT id, captured_at, mq3, mq135, mq136, mq137,
                   temperature_c, humidity_percent, freshness_status, confidence, model_version
            FROM fridge_sensor_readings
            WHERE sensor_id = :sensor_id AND captured_at >= now() - (:hours * interval '1 hour')
            ORDER BY captured_at DESC, id DESC
            LIMIT 500
        ) recent ORDER BY captured_at, id
    """),
        {"sensor_id": sensor_id, "hours": hours},
    ).all()
    summary = _summary(row)
    return FridgeSensorDetail(
        **summary.model_dump(),
        readings=[FridgeSensorReading(**reading._mapping) for reading in readings],
    )


@router.delete("/{sensor_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_fridge_sensor(
    sensor_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    session.execute(
        text("""
        UPDATE sensor_provisioning_devices
        SET claimed_at = NULL, claimed_user_id = NULL, claimed_sensor_id = NULL
        WHERE claimed_sensor_id = :sensor_id AND claimed_user_id = :user_id
    """),
        {"sensor_id": sensor_id, "user_id": current_user.id},
    )
    result = session.execute(
        text("""
        DELETE FROM fridge_sensors WHERE id = :sensor_id AND user_id = :user_id
    """),
        {"sensor_id": sensor_id, "user_id": current_user.id},
    )
    if result.rowcount != 1:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fridge Sensor not found.")
    session.commit()
