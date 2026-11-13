from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.modules.notifications.service import (
    ensure_preferences,
    record_sensor_alert,
    send_push_notification,
    sync_consumer_notifications,
)
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.notifications import (
    NotificationItem,
    NotificationList,
    NotificationPreferences,
    PushTokenInput,
    SensorAlertInput,
)

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


def _preferences(session: Session, user_id: UUID) -> NotificationPreferences:
    ensure_preferences(session, user_id)
    row = session.execute(
        text("""
        SELECT sensor_alerts, ingredient_expiry, meal_reminders,
               payment_updates, delivery_updates
        FROM notification_preferences WHERE user_id = :user_id
    """),
        {"user_id": user_id},
    ).one()
    return NotificationPreferences(**row._mapping)


@router.get("", response_model=NotificationList)
def list_notifications(
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> NotificationList:
    sync_consumer_notifications(session, current_user.id)
    rows = session.execute(
        text("""
        SELECT id, category, title, message, action_path, metadata, created_at, read_at
        FROM notifications
        WHERE user_id = :user_id AND dismissed_at IS NULL
        ORDER BY created_at DESC LIMIT 100
    """),
        {"user_id": current_user.id},
    ).all()
    session.commit()
    items = [NotificationItem(**row._mapping) for row in rows]
    return NotificationList(items=items, unread_count=sum(item.read_at is None for item in items))


@router.get("/preferences", response_model=NotificationPreferences)
def get_preferences(
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> NotificationPreferences:
    result = _preferences(session, current_user.id)
    session.commit()
    return result


@router.put("/preferences", response_model=NotificationPreferences)
def update_preferences(
    request: NotificationPreferences,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> NotificationPreferences:
    ensure_preferences(session, current_user.id)
    session.execute(
        text("""
        UPDATE notification_preferences
        SET sensor_alerts = :sensor_alerts,
            ingredient_expiry = :ingredient_expiry,
            meal_reminders = :meal_reminders,
            payment_updates = :payment_updates,
            delivery_updates = :delivery_updates,
            updated_at = now()
        WHERE user_id = :user_id
    """),
        {"user_id": current_user.id, **request.model_dump()},
    )
    session.commit()
    return request


@router.put("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notification_read(
    notification_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    result = session.execute(
        text("""
        UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE id = :notification_id AND user_id = :user_id AND dismissed_at IS NULL
    """),
        {"notification_id": notification_id, "user_id": current_user.id},
    )
    if result.rowcount != 1:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found.")
    session.commit()


@router.put("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_notifications_read(
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    session.execute(
        text("""
        UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE user_id = :user_id AND dismissed_at IS NULL
    """),
        {"user_id": current_user.id},
    )
    session.commit()


@router.post("/sensor-alerts", status_code=status.HTTP_202_ACCEPTED)
def create_sensor_alert(
    request: SensorAlertInput,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> dict[str, bool]:
    """Authenticated hand-off used by the consumer's paired sensor sync flow."""
    created = record_sensor_alert(session, user_id=current_user.id, **request.model_dump())
    session.commit()
    if created:
        send_push_notification(
            session,
            user_id=current_user.id,
            title=request.title,
            message=request.message,
            action_path=request.action_path or "/fridge-sensors",
        )
    return {"accepted": True}


@router.post("/push-token", status_code=status.HTTP_204_NO_CONTENT)
def register_push_token(
    request: PushTokenInput,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    session.execute(
        text("""
        DELETE FROM user_push_tokens
        WHERE expo_push_token = :expo_push_token
          AND (user_id <> :user_id OR device_id <> :device_id)
    """),
        {"user_id": current_user.id, **request.model_dump()},
    )
    session.execute(
        text("""
        INSERT INTO user_push_tokens
            (user_id, device_id, expo_push_token, platform)
        VALUES
            (:user_id, :device_id, :expo_push_token, :platform)
        ON CONFLICT (user_id, device_id) DO UPDATE SET
            expo_push_token = EXCLUDED.expo_push_token,
            platform = EXCLUDED.platform,
            updated_at = now()
    """),
        {"user_id": current_user.id, **request.model_dump()},
    )
    session.commit()
