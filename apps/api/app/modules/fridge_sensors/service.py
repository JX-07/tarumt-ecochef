from __future__ import annotations

from datetime import datetime, timezone


SPOILAGE_ALERT_CONFIDENCE = 0.85


def connection_status(last_seen_at: datetime | None) -> str:
    if last_seen_at is None:
        return "waiting"
    seen = last_seen_at if last_seen_at.tzinfo else last_seen_at.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - seen.astimezone(timezone.utc)).total_seconds()
    return "online" if elapsed <= 5 * 60 else "offline"


def should_create_spoilage_alert(
    *, freshness_status: str, confidence: float | None, consecutive_high_risk_readings: int
) -> bool:
    """Require a repeated, high-confidence model result before notifying the user."""
    return (
        freshness_status == "spoiled"
        and confidence is not None
        and confidence >= SPOILAGE_ALERT_CONFIDENCE
        and consecutive_high_risk_readings >= 2
    )
