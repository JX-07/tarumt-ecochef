import json
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from firebase_admin import auth as firebase_auth
from firebase_admin.exceptions import FirebaseError
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.core.firebase import get_firebase_app
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser

router = APIRouter()
CurrentAdministrator = Depends(require_roles(AccountRole.administrator))
ADMIN_AREAS = {
    "moderation",
    "recipes",
    "users",
    "vendors",
    "products",
    "orders",
    "promotions",
    "administrators",
}


class UndoAdministratorActionRequest(BaseModel):
    strategy: Literal["preserve_newer", "cascade"] = "preserve_newer"


class StoreStrikeRequest(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


class AdministratorInviteRequest(BaseModel):
    email: EmailStr


class AdministratorProfileUpdateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)


def _administrator_permissions(session: Session, administrator_id: UUID) -> dict:
    return dict(
        session.execute(
            text("""
        SELECT access_level FROM administrators WHERE id = :id
    """),
            {"id": administrator_id},
        )
        .mappings()
        .one()
    )


def _require_administrator_invite_permission(session: Session, administrator_id: UUID) -> dict:
    permissions = _administrator_permissions(session, administrator_id)
    if permissions["access_level"] != "super_admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only a super administrator can invite administrators."
        )
    return permissions


def _rows(session: Session, query: str, parameters: dict | None = None) -> list[dict]:
    return [dict(row) for row in session.execute(text(query), parameters or {}).mappings().all()]


def _record_administrator_action(
    session: Session,
    *,
    administrator_id: UUID,
    area: str,
    action_type: str,
    entity_type: str,
    entity_id: UUID,
    entity_label: str,
    summary: str,
    before_state: dict,
    after_state: dict,
    metadata: dict | None = None,
    reverses_action_id: UUID | None = None,
) -> UUID:
    return session.execute(
        text("""
        INSERT INTO administrator_action_logs (
          administrator_id, area, action_type, entity_type, entity_id, entity_label,
          summary, before_state, after_state, metadata, reverses_action_id
        ) VALUES (
          :administrator_id, :area, :action_type, :entity_type, :entity_id, :entity_label,
          :summary, CAST(:before_state AS jsonb), CAST(:after_state AS jsonb),
          CAST(:metadata AS jsonb), :reverses_action_id
        ) RETURNING id
    """),
        {
            "administrator_id": administrator_id,
            "area": area,
            "action_type": action_type,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "entity_label": entity_label,
            "summary": summary,
            "before_state": json.dumps(before_state),
            "after_state": json.dumps(after_state),
            "metadata": json.dumps(metadata or {}),
            "reverses_action_id": reverses_action_id,
        },
    ).scalar_one()


def _can_undo(action: dict, administrator_id: UUID, access_level: str) -> bool:
    return (
        action["undone_at"] is None
        and not action["action_type"].startswith("moderation.")
        and action["action_type"] != "action.undo"
        and action["action_type"] != "administrator.invited"
        and action["action_type"] != "administrator.invite_permission_updated"
        and action["action_type"] != "administrator.undo_permission_updated"
        and (access_level == "super_admin" or action["administrator_id"] == administrator_id)
    )


def _newer_entity_actions(session: Session, action: dict) -> list[dict]:
    return _rows(
        session,
        """
        SELECT l.*, a.email AS administrator_email
        FROM administrator_action_logs l
        JOIN administrators a ON a.id = l.administrator_id
        WHERE l.entity_type = :entity_type AND l.entity_id = :entity_id
          AND l.created_at > :created_at AND l.undone_at IS NULL
          AND l.action_type <> 'action.undo'
        ORDER BY l.created_at DESC
    """,
        {
            "entity_type": action["entity_type"],
            "entity_id": action["entity_id"],
            "created_at": action["created_at"],
        },
    )


def _restore_administrator_action(session: Session, action: dict, administrator_id: UUID) -> None:
    before_state = action["before_state"]
    if action["entity_type"] == "store" and "status" in before_state:
        if action["action_type"] == "store.strike_issued" and action["metadata"].get("strike_id"):
            session.execute(
                text("""
                UPDATE store_strikes
                SET voided_at = now(), voided_by_administrator_id = :administrator_id
                WHERE id = :strike_id AND voided_at IS NULL
            """),
                {
                    "administrator_id": administrator_id,
                    "strike_id": UUID(action["metadata"]["strike_id"]),
                },
            )
        updated = session.execute(
            text("""
            UPDATE stores SET status = :status WHERE id = :entity_id RETURNING id
        """),
            {"status": before_state["status"], "entity_id": action["entity_id"]},
        ).first()
        if updated is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "The store no longer exists, so this action cannot be undone.",
            )
        return
    if action["entity_type"] == "administrator" and "name" in before_state:
        updated = session.execute(
            text("""
            UPDATE administrators SET name = :name
            WHERE id = :entity_id RETURNING id
        """),
            {"name": before_state["name"], "entity_id": action["entity_id"]},
        ).first()
        if updated is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "The administrator no longer exists, so this action cannot be undone.",
            )
        return
    raise HTTPException(
        status.HTTP_409_CONFLICT, "This action type does not have a supported undo operation."
    )


@router.get("/me")
def administrator_account(
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    return dict(
        session.execute(
            text(
                "SELECT id, name, email, access_level, date_assigned FROM administrators WHERE id = :id"
            ),
            {"id": current_user.id},
        )
        .mappings()
        .one()
    )


@router.put("/me")
def update_administrator_profile(
    request: AdministratorProfileUpdateRequest,
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    name = request.name.strip()
    if len(name) < 2:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Display name must contain at least 2 characters.",
        )
    current = (
        session.execute(
            text("""
        SELECT id, name, email FROM administrators WHERE id = :id FOR UPDATE
    """),
            {"id": current_user.id},
        )
        .mappings()
        .one()
    )
    updated = (
        session.execute(
            text("""
        UPDATE administrators SET name = :name WHERE id = :id
        RETURNING id, name, email, access_level, date_assigned
    """),
            {"name": name, "id": current_user.id},
        )
        .mappings()
        .one()
    )
    if current["name"] != name:
        _record_administrator_action(
            session,
            administrator_id=current_user.id,
            area="administrators",
            action_type="administrator.profile_updated",
            entity_type="administrator",
            entity_id=current_user.id,
            entity_label=current["email"],
            summary=f"Updated administrator profile for {current['email']}",
            before_state={"name": current["name"]},
            after_state={"name": name},
        )
    session.commit()
    return dict(updated)


@router.get("/action-logs")
def administrator_action_logs(
    area: str = Query(...),
    query: str = "",
    action_type: str = "",
    actor: str = "",
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    if area not in ADMIN_AREAS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown administrator page.")
    permissions = _administrator_permissions(session, current_user.id)
    access_level = permissions["access_level"]
    rows = _rows(
        session,
        """
        SELECT l.*, actor.email AS administrator_email,
          undoer.email AS undone_by_email, COUNT(*) OVER() AS total_count
        FROM administrator_action_logs l
        JOIN administrators actor ON actor.id = l.administrator_id
        LEFT JOIN administrators undoer ON undoer.id = l.undone_by_administrator_id
        WHERE l.area = :area
          AND (:query = '' OR l.summary ILIKE '%' || :query || '%'
            OR l.entity_label ILIKE '%' || :query || '%'
            OR actor.email ILIKE '%' || :query || '%')
          AND (:action_type = '' OR l.action_type = :action_type)
          AND (:actor = '' OR actor.email ILIKE '%' || :actor || '%')
          AND (CAST(:date_from AS timestamptz) IS NULL OR l.created_at >= :date_from)
          AND (CAST(:date_to AS timestamptz) IS NULL OR l.created_at <= :date_to)
        ORDER BY l.created_at DESC LIMIT :limit OFFSET :offset
    """,
        {
            "area": area,
            "query": query.strip(),
            "action_type": action_type,
            "actor": actor.strip(),
            "date_from": date_from,
            "date_to": date_to,
            "limit": limit,
            "offset": offset,
        },
    )
    total = int(rows[0].pop("total_count")) if rows else 0
    for row in rows:
        row["can_undo"] = _can_undo(row, current_user.id, access_level)
    return {
        "items": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "current_administrator_id": current_user.id,
        "access_level": access_level,
    }


def _action_for_undo(session: Session, action_id: UUID) -> dict:
    action = (
        session.execute(
            text("""
        SELECT l.*, a.email AS administrator_email
        FROM administrator_action_logs l JOIN administrators a ON a.id = l.administrator_id
        WHERE l.id = :id
    """),
            {"id": action_id},
        )
        .mappings()
        .one_or_none()
    )
    if action is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Administrator action not found.")
    return dict(action)


@router.get("/action-logs/{action_id}/undo-preview")
def administrator_action_undo_preview(
    action_id: UUID,
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    action = _action_for_undo(session, action_id)
    permissions = _administrator_permissions(session, current_user.id)
    access_level = permissions["access_level"]
    if not _can_undo(action, current_user.id, access_level):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not allowed to undo this action.")
    newer = _newer_entity_actions(session, action)
    cascade_allowed = all(_can_undo(item, current_user.id, access_level) for item in newer)
    strategies = [
        {
            "value": "preserve_newer",
            "label": "Restore the earlier value",
            "description": "Restore this action's previous value while keeping newer records and activity.",
        }
    ]
    if newer and cascade_allowed:
        strategies.append(
            {
                "value": "cascade",
                "label": "Undo this and newer actions",
                "description": "Reverse the newer administrator actions first, then restore this action's previous value.",
            }
        )
    return {
        "action": action,
        "newer_actions": newer,
        "requires_choice": bool(newer),
        "cascade_allowed": cascade_allowed,
        "strategies": strategies,
    }


@router.post("/action-logs/{action_id}/undo")
def undo_administrator_action(
    action_id: UUID,
    request: UndoAdministratorActionRequest,
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    action = _action_for_undo(session, action_id)
    permissions = _administrator_permissions(session, current_user.id)
    access_level = permissions["access_level"]
    if not _can_undo(action, current_user.id, access_level):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not allowed to undo this action.")
    newer = _newer_entity_actions(session, action)
    targets = [action]
    if request.strategy == "cascade":
        if any(not _can_undo(item, current_user.id, access_level) for item in newer):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "One or more newer actions cannot be undone by this administrator.",
            )
        targets = [*newer, action]
    before_undo = (
        dict(
            session.execute(
                text("""
        SELECT s.status,
          (SELECT COUNT(*) FROM store_strikes ss
           WHERE ss.store_id = s.id AND ss.voided_at IS NULL) AS strike_count
        FROM stores s WHERE s.id = :id
    """),
                {"id": action["entity_id"]},
            )
            .mappings()
            .one_or_none()
            or {}
        )
        if action["entity_type"] == "store"
        else {}
    )
    for target in targets:
        _restore_administrator_action(session, target, current_user.id)
        session.execute(
            text("""
            UPDATE administrator_action_logs
            SET undone_at = now(), undone_by_administrator_id = :administrator_id
            WHERE id = :id
        """),
            {"administrator_id": current_user.id, "id": target["id"]},
        )
    after_undo = (
        {
            "status": action["before_state"].get("status"),
            "strike_count": action["before_state"].get(
                "strike_count", before_undo.get("strike_count")
            ),
        }
        if action["entity_type"] == "store"
        else {}
    )
    undo_id = _record_administrator_action(
        session,
        administrator_id=current_user.id,
        area=action["area"],
        action_type="action.undo",
        entity_type=action["entity_type"],
        entity_id=action["entity_id"],
        entity_label=action["entity_label"],
        summary=f"Undid: {action['summary']}",
        before_state=before_undo,
        after_state=after_undo,
        metadata={
            "strategy": request.strategy,
            "undone_action_ids": [str(item["id"]) for item in targets],
        },
        reverses_action_id=action["id"],
    )
    session.commit()
    return {
        "id": undo_id,
        "status": "undone",
        "strategy": request.strategy,
        "undone_action_ids": [item["id"] for item in targets],
    }


@router.post("/stores/{store_id}/approve")
def approve_store(
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    store = (
        session.execute(
            text("""
        UPDATE stores SET status = 'approved'
        WHERE id = :store_id AND status = 'pending_approval'
        RETURNING id, store_name, status
    """),
            {"store_id": store_id},
        )
        .mappings()
        .one_or_none()
    )
    if store is None:
        existing = (
            session.execute(
                text("SELECT status FROM stores WHERE id = :store_id"),
                {"store_id": store_id},
            )
            .mappings()
            .one_or_none()
        )
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found.")
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Only stores pending approval can be approved. This store is {existing['status'].replace('_', ' ')}.",
        )
    approval_action_id = _record_administrator_action(
        session,
        administrator_id=current_user.id,
        area="vendors",
        action_type="store.approved",
        entity_type="store",
        entity_id=store["id"],
        entity_label=store["store_name"],
        summary=f"Approved store {store['store_name']}",
        before_state={"status": "pending_approval"},
        after_state={"status": "approved"},
    )
    approved_at = session.execute(
        text("SELECT created_at FROM administrator_action_logs WHERE id = :id"),
        {"id": approval_action_id},
    ).scalar_one()
    session.commit()
    return {**dict(store), "approved_at": approved_at}


@router.post("/stores/{store_id}/strikes")
def issue_store_strike(
    store_id: UUID,
    request: StoreStrikeRequest,
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    store = (
        session.execute(
            text("""
        SELECT id, store_name, status FROM stores WHERE id = :store_id FOR UPDATE
    """),
            {"store_id": store_id},
        )
        .mappings()
        .one_or_none()
    )
    if store is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found.")
    if store["status"] != "approved":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only an approved store can receive a strike."
        )
    active_strikes = session.execute(
        text("""
        SELECT COUNT(*) FROM store_strikes WHERE store_id = :store_id AND voided_at IS NULL
    """),
        {"store_id": store_id},
    ).scalar_one()
    if active_strikes >= 3:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This store has already reached the three-strike limit."
        )
    strike_number = int(active_strikes) + 1
    strike_id = session.execute(
        text("""
        INSERT INTO store_strikes (store_id, issued_by_administrator_id, reason)
        VALUES (:store_id, :administrator_id, :reason) RETURNING id
    """),
        {
            "store_id": store_id,
            "administrator_id": current_user.id,
            "reason": request.reason.strip(),
        },
    ).scalar_one()
    resulting_status = "approved"
    summary = f"Issued strike {strike_number} of 3 to {store['store_name']}"
    _record_administrator_action(
        session,
        administrator_id=current_user.id,
        area="vendors",
        action_type="store.strike_issued",
        entity_type="store",
        entity_id=store_id,
        entity_label=store["store_name"],
        summary=summary,
        before_state={"status": store["status"], "strike_count": int(active_strikes)},
        after_state={"status": resulting_status, "strike_count": strike_number},
        metadata={"strike_id": str(strike_id), "reason": request.reason.strip()},
    )
    session.commit()
    return {
        "id": store_id,
        "store_name": store["store_name"],
        "status": resulting_status,
        "strike_count": strike_number,
        "strikes_remaining": max(0, 3 - strike_number),
    }


@router.post("/stores/{store_id}/revoke")
def revoke_store(
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    store = (
        session.execute(
            text("""
        SELECT s.id, s.store_name, s.status,
          (SELECT COUNT(*) FROM store_strikes ss
           WHERE ss.store_id = s.id AND ss.voided_at IS NULL) AS strike_count
        FROM stores s WHERE s.id = :store_id FOR UPDATE
    """),
            {"store_id": store_id},
        )
        .mappings()
        .one_or_none()
    )
    if store is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found.")
    if store["status"] != "approved":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only an approved store can have its approval revoked."
        )
    if int(store["strike_count"]) < 3:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A store must have three active strikes before approval can be revoked.",
        )
    session.execute(
        text("UPDATE stores SET status = 'revoked' WHERE id = :store_id"), {"store_id": store_id}
    )
    _record_administrator_action(
        session,
        administrator_id=current_user.id,
        area="vendors",
        action_type="store.revoked",
        entity_type="store",
        entity_id=store_id,
        entity_label=store["store_name"],
        summary=f"Revoked approval for {store['store_name']} after 3 strikes",
        before_state={"status": "approved", "strike_count": int(store["strike_count"])},
        after_state={"status": "revoked", "strike_count": int(store["strike_count"])},
        metadata={"reason": "Three active store strikes"},
    )
    session.commit()
    return {
        "id": store_id,
        "store_name": store["store_name"],
        "status": "revoked",
        "strike_count": int(store["strike_count"]),
    }


@router.post("/administrators/invitations", status_code=status.HTTP_201_CREATED)
def invite_administrator(
    request: AdministratorInviteRequest,
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    _require_administrator_invite_permission(session, current_user.id)
    email = str(request.email).strip().lower()
    collision = session.execute(
        text("""
        SELECT 1 FROM users WHERE lower(email) = :email
        UNION ALL SELECT 1 FROM business_owners WHERE lower(email) = :email
        UNION ALL SELECT 1 FROM administrators WHERE lower(email) = :email
    """),
        {"email": email},
    ).first()
    if collision:
        raise HTTPException(status.HTTP_409_CONFLICT, "This email already has an EcoChef account.")
    try:
        firebase_user = firebase_auth.create_user(email=email, app=get_firebase_app())
    except FirebaseError as exc:
        if getattr(exc, "code", "") in {"EMAIL_ALREADY_EXISTS", "email-already-exists"}:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "This email already has a Firebase account."
            ) from exc
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The administrator invitation account could not be created.",
        ) from exc
    try:
        invited = (
            session.execute(
                text("""
            INSERT INTO administrators (
              firebase_uid, name, email, access_level, invited_by, invitation_sent_at
            ) VALUES (:uid, :name, :email, 'administrator', :invited_by, now())
            RETURNING id, name, email, access_level, date_assigned, invitation_sent_at
        """),
                {
                    "uid": firebase_user.uid,
                    "name": email.split("@", 1)[0],
                    "email": email,
                    "invited_by": current_user.id,
                },
            )
            .mappings()
            .one()
        )
        _record_administrator_action(
            session,
            administrator_id=current_user.id,
            area="administrators",
            action_type="administrator.invited",
            entity_type="administrator",
            entity_id=invited["id"],
            entity_label=email,
            summary=f"Invited administrator {email}",
            before_state={},
            after_state={"access_level": "administrator"},
        )
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        try:
            firebase_auth.delete_user(firebase_user.uid, app=get_firebase_app())
        except FirebaseError:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "The invitation could not be saved or safely rolled back.",
            ) from exc
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The administrator invitation could not be saved."
        ) from exc
    return dict(invited)


@router.get("/workspace")
def administrator_workspace(
    current_user: AuthenticatedUser = CurrentAdministrator,
    session: Session = Depends(get_db_session),
) -> dict:
    account = (
        session.execute(
            text(
                "SELECT id, name, email, access_level, date_assigned FROM administrators WHERE id = :id"
            ),
            {"id": current_user.id},
        )
        .mappings()
        .one()
    )

    overview = dict(
        session.execute(
            text("""
        SELECT
          (SELECT COUNT(*) FROM users) AS household_users,
          (SELECT COUNT(*) FROM business_owners) AS business_accounts,
          (SELECT COUNT(*) FROM administrators) AS administrators,
          (SELECT COUNT(*) FROM stores) AS stores,
          (SELECT COUNT(*) FROM stores WHERE status = 'pending_approval') AS pending_stores,
          ((SELECT COUNT(*) FROM content_report_issues WHERE status='pending') + (SELECT COUNT(*) FROM recipe_feedback_flags WHERE status='pending') + (SELECT COUNT(*) FROM product_feedback_flags WHERE status='pending')) AS pending_reports,
          (SELECT COUNT(*) FROM orders) AS orders,
          (SELECT COUNT(*) FROM orders WHERE order_date::date = current_date) AS orders_today,
          (SELECT COALESCE(SUM(total_amount), 0) FROM orders) AS gross_order_value,
          (SELECT COUNT(*) FROM products) AS products,
          (SELECT COUNT(*) FROM products WHERE status = 'active') AS active_products,
          (SELECT COUNT(*) FROM recipes WHERE is_published) AS published_recipes,
          (SELECT COUNT(*) FROM promo_codes WHERE status = 'active' AND now() BETWEEN start_date AND end_date) AS live_promotions
    """)
        )
        .mappings()
        .one()
    )

    weekly_activity = _rows(
        session,
        """
        SELECT week::date AS week,
          (SELECT COUNT(*) FROM users
           WHERE date_joined >= week AND date_joined < week + interval '1 week') AS household_signups,
          (SELECT COUNT(*) FROM business_owners
           WHERE date_joined >= week AND date_joined < week + interval '1 week') AS business_signups,
          (SELECT COUNT(*) FROM recipes
           WHERE date_created >= week AND date_created < week + interval '1 week') AS recipes_created
        FROM generate_series(
          date_trunc('week', current_date) - interval '3 weeks',
          date_trunc('week', current_date), interval '1 week'
        ) AS week ORDER BY week
    """,
    )

    recent_activity = _rows(
        session,
        """
        SELECT category, title, detail, occurred_at FROM (
          SELECT 'report' AS category, 'Recipe report submitted' AS title,
            r.title AS detail, rr.date_reported AS occurred_at
          FROM recipe_reports rr JOIN recipes r ON r.id = rr.recipe_id
          UNION ALL
          SELECT 'order', 'Order placed', 'Order ' || left(o.id::text, 8), o.order_date
          FROM orders o
          UNION ALL
          SELECT 'recipe', 'Recipe made public', r.title, r.date_created
          FROM recipes r WHERE r.is_published
          UNION ALL
          SELECT 'administrator', 'Administrator assigned', a.email, a.date_assigned
          FROM administrators a
        ) activity ORDER BY occurred_at DESC LIMIT 8
    """,
    )

    reports = _rows(
        session,
        """
        SELECT report.id,issue.category AS reason,report.created_at AS date_reported,
          recipe.id AS recipe_id,recipe.title AS recipe_title,
          reporter.name AS reporter_name,reporter.email AS reporter_email,
          author.name AS author_name,author.email AS author_email
        FROM content_reports report JOIN content_report_issues issue ON issue.id=report.issue_id
        JOIN recipes recipe ON issue.subject_type='recipe' AND recipe.id=issue.subject_id
        JOIN users reporter ON reporter.id=report.user_id JOIN users author ON author.id=recipe.user_id
        ORDER BY report.created_at DESC
    """,
    )

    recipes = _rows(
        session,
        """
        SELECT r.id, r.title, r.image_url, r.cuisine, r.difficulty, r.is_published, r.date_created,
          u.id AS author_id, u.name AS author_name, u.email AS author_email,
          COUNT(DISTINCT rf.user_id) AS feedback_count,
          COUNT(DISTINCT rr.id) AS report_count
        FROM recipes r JOIN users u ON u.id = r.user_id
        LEFT JOIN recipe_feedback rf ON rf.recipe_id = r.id AND rf.removed_at IS NULL AND rf.eligibility_verified
        LEFT JOIN recipe_reports rr ON rr.recipe_id = r.id
        GROUP BY r.id, u.id ORDER BY r.date_created DESC
    """,
    )

    recipe_feedback = _rows(
        session,
        """
        SELECT rf.recipe_id, rf.rating, rf.comment, rf.date_submitted,
          u.id AS reviewer_id, u.name AS reviewer_name, u.email AS reviewer_email
        FROM recipe_feedback rf JOIN users u ON u.id = rf.user_id
        ORDER BY rf.date_submitted DESC
    """,
    )

    users = _rows(
        session,
        """
        SELECT u.id, u.name, u.email, u.phone_number, u.date_joined,
          COUNT(DISTINCT o.id) AS order_count,
          COUNT(DISTINCT r.id) AS recipe_count
        FROM users u
        LEFT JOIN carts c ON c.user_id = u.id
        LEFT JOIN orders o ON o.cart_id = c.id
        LEFT JOIN recipes r ON r.user_id = u.id
        GROUP BY u.id ORDER BY u.date_joined DESC
    """,
    )

    vendors = _rows(
        session,
        """
        SELECT bo.id AS owner_id, bo.name AS owner_name, bo.email, bo.business_name, bo.date_joined,
          s.id AS store_id, s.store_name, s.description, s.icon_url, s.category, s.city, s.state, s.status,
          (SELECT MAX(al.created_at) FROM administrator_action_logs al
           WHERE al.entity_type = 'store' AND al.entity_id = s.id
             AND al.action_type = 'store.approved' AND al.undone_at IS NULL) AS approved_at,
          COALESCE((SELECT COUNT(*) FROM store_strikes ss
                    WHERE ss.store_id = s.id AND ss.voided_at IS NULL), 0) AS strike_count
        FROM business_owners bo LEFT JOIN stores s ON s.business_owner_id = bo.id
        ORDER BY bo.date_joined DESC
    """,
    )

    products = _rows(
        session,
        """
        SELECT p.id, p.product_name, p.category, p.price, p.original_price, p.stock_quantity,
          p.expiry_date, p.status, s.id AS store_id, s.store_name
        FROM products p JOIN stores s ON s.id = p.store_id
        ORDER BY p.product_name
    """,
    )

    orders = _rows(
        session,
        """
        SELECT o.id, o.order_date, o.order_status, o.total_amount, o.delivery_address,
          u.name AS customer_name, u.email AS customer_email,
          pay.payment_status, pay.payment_method,
          COUNT(DISTINCT item.product_id) AS product_count,
          string_agg(DISTINCT s.store_name, ', ' ORDER BY s.store_name) AS store_names
        FROM orders o JOIN carts c ON c.id = o.cart_id JOIN users u ON u.id = c.user_id
        LEFT JOIN payments pay ON pay.order_id = o.id
        LEFT JOIN order_items item ON item.order_id = o.id
        LEFT JOIN stores s ON s.id = item.store_id
        GROUP BY o.id, u.id, pay.id ORDER BY o.order_date DESC
    """,
    )

    promotions = _rows(
        session,
        """
        SELECT pc.id, pc.code, pc.title, pc.description, pc.audience, pc.status,
          pc.discount_percent, pc.discount_amount, pc.free_delivery, pc.start_date, pc.end_date,
          pc.usage_limit, s.store_name,
          COUNT(up.user_id) FILTER (WHERE up.redeemed_at IS NOT NULL) AS redemptions
        FROM promo_codes pc LEFT JOIN stores s ON s.id = pc.store_id
        LEFT JOIN user_promo_codes up ON up.promo_code_id = pc.id
        GROUP BY pc.id, s.id ORDER BY pc.created_date DESC
    """,
    )

    administrators = _rows(
        session,
        """
        SELECT id, name, email, access_level, date_assigned, invitation_sent_at
        FROM administrators ORDER BY date_assigned DESC
    """,
    )

    return {
        "account": dict(account),
        "overview": overview,
        "weekly_activity": weekly_activity,
        "recent_activity": recent_activity,
        "reports": reports,
        "recipes": recipes,
        "recipe_feedback": recipe_feedback,
        "users": users,
        "vendors": vendors,
        "products": products,
        "orders": orders,
        "promotions": promotions,
        "administrators": administrators,
    }
