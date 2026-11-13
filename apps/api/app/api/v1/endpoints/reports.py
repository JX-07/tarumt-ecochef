from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.v1.endpoints.admin import _record_administrator_action
from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.modules.notifications.service import create_notification
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.reports import ContentReportInput, ReportDecision, FeedbackFlagDecision

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))
CurrentModerator = Depends(require_roles(AccountRole.administrator))
CATEGORIES = [
    {
        "id": "misinformation",
        "label": "Misinformation",
        "description": "False or unsupported claims.",
    },
    {
        "id": "inappropriate_content",
        "label": "Inappropriate content",
        "description": "Offensive or inappropriate images or language.",
    },
    {"id": "other", "label": "Other", "description": "Another issue that needs moderator review."},
]


@router.get("/categories")
def report_categories(current_user: AuthenticatedUser = CurrentConsumer) -> dict:
    return {"categories": CATEGORIES}


@router.get("/stores/{store_id}/products")
def reportable_products(
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> dict:
    rows = (
        session.execute(
            text("""
        SELECT p.id,p.product_name AS name,p.category,p.subcategory FROM products p JOIN stores s ON s.id=p.store_id
        WHERE p.store_id=:id AND s.status='approved' AND p.status='active'
          AND p.stock_quantity>0 AND (p.expiry_date IS NULL OR p.expiry_date>now())
        ORDER BY p.product_name,p.id
    """),
            {"id": store_id},
        )
        .mappings()
        .all()
    )
    return {"products": [dict(row) for row in rows]}


@router.post("", status_code=201)
def submit_report(
    request: ContentReportInput,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> dict:
    # Reports deliberately have no purchase or cooking eligibility requirement.
    query = (
        "SELECT id FROM recipes WHERE id=:id AND (is_published OR user_id=:user_id)"
        if request.subject_type == "recipe"
        else "SELECT id FROM stores WHERE id=:id AND status IN ('approved','revoked')"
    )
    if (
        session.execute(
            text(query), {"id": request.subject_id, "user_id": current_user.id}
        ).scalar_one_or_none()
        is None
    ):
        raise HTTPException(404, "This recipe or shop is no longer available.")
    product_name = None
    if request.product_id is not None:
        if request.subject_type != "store":
            raise HTTPException(422, "Product listings can only be selected for shop reports.")
        product_name = session.execute(
            text("""
            SELECT product_name FROM products WHERE id=:id AND store_id=:store_id
              AND status='active' AND stock_quantity>0 AND (expiry_date IS NULL OR expiry_date>now())
        """),
            {"id": request.product_id, "store_id": request.subject_id},
        ).scalar_one_or_none()
        if product_name is None:
            raise HTTPException(
                422,
                "That listing is no longer active in this shop. Choose another item or report the shop without selecting one.",
            )
    issue = session.execute(
        text("""
        INSERT INTO content_report_issues(subject_type,subject_id,category)
        VALUES (:subject_type,:subject_id,:category)
        ON CONFLICT(subject_type,subject_id,category) DO UPDATE SET updated_at=now()
        RETURNING id
    """),
        request.model_dump(exclude={"description", "product_id"}),
    ).scalar_one()
    # The issue upsert holds a row lock. Concurrent reports/decisions serialize.
    report = session.execute(
        text("""
        INSERT INTO content_reports(issue_id,user_id,description,product_id,product_name)
        VALUES (:issue_id,:user_id,:description,:product_id,:product_name) ON CONFLICT(issue_id,user_id) DO NOTHING
        RETURNING id
    """),
        {
            "issue_id": issue,
            "user_id": current_user.id,
            "description": request.description,
            "product_id": request.product_id,
            "product_name": product_name,
        },
    ).scalar_one_or_none()
    if report is None:
        session.rollback()
        raise HTTPException(
            409,
            "You have already reported this category for this recipe or shop. You can follow its outcome in Your reports.",
        )
    session.execute(
        text("UPDATE content_report_issues SET status='pending',updated_at=now() WHERE id=:id"),
        {"id": issue},
    )
    session.commit()
    return {"id": report, "issue_id": issue, "status": "pending"}


@router.get("/mine")
def my_reports(
    current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)
) -> dict:
    rows = (
        session.execute(
            text("""
        SELECT r.id,r.product_id,r.product_name,r.description,r.created_at,r.status,r.resolution_note,r.resolved_at,
               i.subject_type,i.subject_id,i.category,
               COALESCE(recipe.title,store.store_name,'Removed content') AS subject_name
        FROM content_reports r JOIN content_report_issues i ON i.id=r.issue_id
        LEFT JOIN recipes recipe ON i.subject_type='recipe' AND recipe.id=i.subject_id
        LEFT JOIN stores store ON i.subject_type='store' AND store.id=i.subject_id
        WHERE r.user_id=:user_id ORDER BY r.created_at DESC LIMIT 200
    """),
            {"user_id": current_user.id},
        )
        .mappings()
        .all()
    )
    return {"reports": [dict(row) for row in rows]}


@router.get("/moderation")
def moderation_queue(
    state: str = Query(default="pending", pattern="^(pending|resolved|all)$"),
    current_user: AuthenticatedUser = CurrentModerator,
    session: Session = Depends(get_db_session),
    offset: int = 0,
    limit: int = 25,
    search: str = "",
) -> dict:
    if offset < 0 or not 1 <= limit <= 100 or len(search) > 200:
        raise HTTPException(422, "Choose a valid page size and search of up to 200 characters.")
    params = {
        "state": state,
        "offset": offset,
        "limit": limit,
        "search": search.strip().lower(),
        "term": f"%{search.strip().lower()}%",
    }
    issue_from = """
        FROM content_report_issues i
        LEFT JOIN recipes recipe ON i.subject_type='recipe' AND recipe.id=i.subject_id
        LEFT JOIN stores store ON i.subject_type='store' AND store.id=i.subject_id
        WHERE (:state='all' OR (:state='pending' AND i.status='pending')
              OR (:state='resolved' AND i.status<>'pending'))
          AND (:search='' OR lower(COALESCE(recipe.title,store.store_name,'Removed content')) LIKE :term
               OR i.category LIKE :term OR i.subject_type LIKE :term
               OR EXISTS (SELECT 1 FROM content_reports r JOIN users u ON u.id=r.user_id
                          WHERE r.issue_id=i.id AND (lower(r.description) LIKE :term OR lower(u.name) LIKE :term)))
    """
    issues = (
        session.execute(
            text(
                """
        SELECT i.*,COALESCE(recipe.title,store.store_name,'Removed content') AS subject_name,
               (SELECT COUNT(*) FROM content_reports r WHERE r.issue_id=i.id) AS report_count,
               (SELECT COUNT(*) FROM content_reports r WHERE r.issue_id=i.id AND r.status='pending') AS pending_count
    """
                + issue_from
                + " ORDER BY CASE WHEN :state='pending' THEN i.updated_at END ASC,i.updated_at DESC,i.id LIMIT :limit OFFSET :offset"
            ),
            params,
        )
        .mappings()
        .all()
    )
    issue_total = session.execute(text("SELECT COUNT(*) " + issue_from), params).scalar_one()
    threads = (
        session.execute(
            text("""
        SELECT r.id,r.issue_id,r.product_id,r.product_name,r.description,r.created_at,r.status,r.resolution_note,r.resolved_at,u.name AS reporter_name
        FROM content_reports r JOIN users u ON u.id=r.user_id
        WHERE r.issue_id=ANY(:ids) ORDER BY r.created_at,r.id
    """),
            {"ids": [issue["id"] for issue in issues]},
        )
        .mappings()
        .all()
        if issues
        else []
    )
    grouped = [
        {
            **dict(issue),
            "reports": [dict(report) for report in threads if report["issue_id"] == issue["id"]],
        }
        for issue in issues
    ]
    flag_from = """
        FROM recipe_feedback_flags flag JOIN recipe_feedback f ON f.id=flag.feedback_id
        JOIN recipes recipe ON recipe.id=f.recipe_id
        JOIN users author ON author.id=flag.author_id JOIN users reviewer ON reviewer.id=f.user_id
        WHERE (:state='all' OR (:state='pending' AND flag.status='pending')
              OR (:state='resolved' AND flag.status<>'pending'))
          AND (:search='' OR lower(recipe.title) LIKE :term OR lower(author.name) LIKE :term
               OR lower(reviewer.name) LIKE :term OR lower(flag.description) LIKE :term
               OR lower(COALESCE(f.comment,'')) LIKE :term)
    """
    flags = (
        session.execute(
            text(
                """
        SELECT flag.*,f.recipe_id,f.rating,f.comment,f.user_id AS reviewer_id,
               recipe.title AS recipe_title,author.name AS author_name,reviewer.name AS reviewer_name
    """
                + flag_from
                + " ORDER BY flag.created_at,flag.id LIMIT :limit OFFSET :offset"
            ),
            params,
        )
        .mappings()
        .all()
    )
    flag_total = session.execute(text("SELECT COUNT(*) " + flag_from), params).scalar_one()
    from app.api.v1.endpoints.vendor_feedback import product_flag_queue

    product_flags = product_flag_queue(session, state, offset, limit, search)
    return {
        **product_flags,
        "issues": grouped,
        "feedback_flags": [dict(row) for row in flags],
        "categories": CATEGORIES,
        "issue_total": issue_total,
        "flag_total": flag_total,
        "offset": offset,
        "limit": limit,
    }


@router.post("/moderation/issues/{issue_id}/decision")
def decide_report_issue(
    issue_id: UUID,
    request: ReportDecision,
    current_user: AuthenticatedUser = CurrentModerator,
    session: Session = Depends(get_db_session),
) -> dict:
    issue = (
        session.execute(
            text("SELECT * FROM content_report_issues WHERE id=:id FOR UPDATE"), {"id": issue_id}
        )
        .mappings()
        .one_or_none()
    )
    if issue is None:
        raise HTTPException(404, "Report issue not found.")
    if issue["status"] != "pending":
        raise HTTPException(409, "This issue has already been decided. Refresh the queue.")
    pending_count = session.execute(
        text("SELECT COUNT(*) FROM content_reports WHERE issue_id=:id AND status='pending'"),
        {"id": issue_id},
    ).scalar_one()
    if pending_count != request.expected_pending_count:
        raise HTTPException(
            409,
            "New reports arrived while you were reviewing this issue. Refresh the thread before deciding.",
        )
    reports = (
        session.execute(
            text("""
        UPDATE content_reports SET status=:decision,resolution_note=:note,resolved_at=now(),moderator_id=:moderator
        WHERE issue_id=:id AND status='pending' RETURNING id,user_id
    """),
            {
                "id": issue_id,
                "decision": request.decision,
                "note": request.note,
                "moderator": current_user.id,
            },
        )
        .mappings()
        .all()
    )
    if not reports:
        raise HTTPException(409, "There are no pending reports in this issue.")
    session.execute(
        text("UPDATE content_report_issues SET status=:decision,updated_at=now() WHERE id=:id"),
        {"id": issue_id, "decision": request.decision},
    )
    decision_id = session.execute(
        text("""
        INSERT INTO content_report_decisions(issue_id,moderator_id,decision,note,reports_resolved)
        VALUES (:id,:moderator,:decision,:note,:count) RETURNING id
    """),
        {
            "id": issue_id,
            "moderator": current_user.id,
            "decision": request.decision,
            "note": request.note,
            "count": len(reports),
        },
    ).scalar_one()
    for report in reports:
        create_notification(
            session,
            user_id=report["user_id"],
            category="moderation",
            title="Your report has been reviewed",
            message=f"Report {'confirmed' if request.decision == 'upheld' else 'dismissed'}: {request.note}"[
                :500
            ],
            source_key=f"report-decision:{decision_id}:{report['id']}",
            action_path="/reports",
        )
    if request.decision == "upheld" and issue["subject_type"] == "recipe":
        author = session.execute(
            text("SELECT user_id FROM recipes WHERE id=:id"), {"id": issue["subject_id"]}
        ).scalar_one_or_none()
        if author:
            create_notification(
                session,
                user_id=author,
                category="moderation",
                title="A report about your recipe was confirmed",
                message=request.note[:500],
                source_key=f"recipe-report-upheld:{decision_id}",
                action_path=f"/recipes/{issue['subject_id']}",
            )
    _record_administrator_action(
        session,
        administrator_id=current_user.id,
        area="moderation",
        action_type="moderation.report_decided",
        entity_type="content_report_issue",
        entity_id=issue_id,
        entity_label=issue["category"],
        summary=request.note,
        before_state={"status": "pending"},
        after_state={"status": request.decision},
        metadata={"reports_resolved": len(reports)},
    )
    session.commit()
    return {"id": issue_id, "status": request.decision, "reports_resolved": len(reports)}


@router.post("/moderation/feedback-flags/{flag_id}/decision")
def decide_feedback_flag(
    flag_id: UUID,
    request: FeedbackFlagDecision,
    current_user: AuthenticatedUser = CurrentModerator,
    session: Session = Depends(get_db_session),
) -> dict:
    flag = (
        session.execute(
            text("""
        SELECT flag.*,f.recipe_id,f.user_id AS reviewer_id FROM recipe_feedback_flags flag
        JOIN recipe_feedback f ON f.id=flag.feedback_id WHERE flag.id=:id FOR UPDATE OF flag,f
    """),
            {"id": flag_id},
        )
        .mappings()
        .one_or_none()
    )
    if flag is None:
        raise HTTPException(404, "Feedback flag not found.")
    if flag["status"] != "pending":
        raise HTTPException(409, "This flag has already been decided. Refresh the queue.")
    if request.decision == "removed":
        session.execute(
            text(
                "UPDATE recipe_feedback SET removed_at=now(),removed_by_administrator_id=:moderator WHERE id=:id"
            ),
            {"id": flag["feedback_id"], "moderator": current_user.id},
        )
    session.execute(
        text("""
        UPDATE recipe_feedback_flags SET status=:decision,resolution_note=:note,resolved_at=now(),moderator_id=:moderator WHERE id=:id
    """),
        {
            "id": flag_id,
            "decision": request.decision,
            "note": request.note,
            "moderator": current_user.id,
        },
    )
    for recipient in {flag["author_id"], flag["reviewer_id"]}:
        create_notification(
            session,
            user_id=recipient,
            category="moderation",
            title="Recipe feedback decision",
            message=f"{'Feedback removed' if request.decision == 'removed' else 'Flag dismissed; feedback remains visible'}: {request.note}"[
                :500
            ],
            source_key=f"feedback-flag-decision:{flag_id}",
            action_path=f"/recipes/{flag['recipe_id']}",
        )
    _record_administrator_action(
        session,
        administrator_id=current_user.id,
        area="moderation",
        action_type="moderation.feedback_decided",
        entity_type="recipe_feedback_flag",
        entity_id=flag_id,
        entity_label="Recipe feedback flag",
        summary=request.note,
        before_state={"status": "pending"},
        after_state={"status": request.decision},
    )
    session.commit()
    return {"id": flag_id, "status": request.decision}
