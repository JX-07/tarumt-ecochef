from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.v1.endpoints.vendor import _account_store_id
from app.api.v1.endpoints.admin import _record_administrator_action
from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.modules.notifications.service import create_notification
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.reports import FeedbackFlagDecision

router = APIRouter()
moderator_router = APIRouter()
Owner = Depends(require_roles(AccountRole.business_owner))
Moderator = Depends(require_roles(AccountRole.administrator))


class ProductFeedbackFlagInput(BaseModel):
    description: str = Field(min_length=10,max_length=2000)

    @field_validator('description')
    @classmethod
    def meaningful(cls,value: str) -> str:
        if len(value.strip()) < 10:
            raise ValueError('Explain the reason in at least 10 characters.')
        return value.strip()


@router.get('/feedback')
def vendor_feedback(search: str = '', offset: int = 0, limit: int = 25,
                    current_user: AuthenticatedUser = Owner, session: Session = Depends(get_db_session),
                    sort: str = "submitted", direction: str = "desc") -> dict:
    if offset < 0 or not 1 <= limit <= 100 or len(search) > 200:
        raise HTTPException(422,'Invalid feedback page or search.')
    columns = {
        "product": "lower(product.product_name)",
        "rating": "review.rating",
        "feedback": "lower(COALESCE(NULLIF(review.comment,''),'Rating only; no description.'))",
        "submitted": "review.date_submitted",
        "moderator": "CASE flag.status WHEN 'pending' THEN 'Awaiting moderator' WHEN 'dismissed' THEN 'Flag dismissed' WHEN 'removed' THEN 'Feedback removed' ELSE 'Not flagged' END",
    }
    if sort not in columns or direction not in ("asc", "desc"):
        raise HTTPException(422, 'Invalid feedback sort column or direction.')
    order_by = f"{columns[sort]} {direction.upper()}, review.id ASC"
    store = _account_store_id(session,current_user.id)
    base = """ FROM product_reviews review JOIN products product ON product.id=review.product_id
        JOIN users customer ON customer.id=review.user_id JOIN stores shop ON shop.id=review.store_id
        LEFT JOIN product_feedback_flags flag ON flag.feedback_id=review.id
        WHERE review.store_id=:store AND (:search='' OR lower(product.product_name) LIKE :term
          OR lower(customer.name) LIKE :term OR lower(COALESCE(review.comment,'')) LIKE :term) """
    params={'store':store,'owner':current_user.id,'search':search.strip(),'term':f'%{search.strip().lower()}%','offset':offset,'limit':limit}
    rows=session.execute(text("""SELECT review.id,review.rating,review.comment,review.date_submitted,
        review.removed_at,product.product_name,customer.name AS customer_name,
        flag.status AS flag_status,flag.description AS flag_reason,flag.resolution_note,
        (shop.business_owner_id=:owner AND flag.id IS NULL AND review.removed_at IS NULL) AS can_flag
    """+base+' ORDER BY '+order_by+' LIMIT :limit OFFSET :offset'),params).mappings().all()
    total=session.execute(text('SELECT COUNT(*) '+base),params).scalar_one()
    summary=session.execute(text('SELECT COALESCE(AVG(rating) FILTER (WHERE removed_at IS NULL),0) AS rating,COUNT(*) FILTER (WHERE removed_at IS NULL) AS count,COUNT(*) AS total_count FROM product_reviews WHERE store_id=:store'),params).mappings().one()
    return {'feedback':[dict(row) for row in rows],'total':total,'summary':dict(summary)}


@router.post('/feedback/{feedback_id}/flag',status_code=201)
def flag_product_feedback(feedback_id: UUID, request: ProductFeedbackFlagInput,
                          current_user: AuthenticatedUser = Owner, session: Session = Depends(get_db_session)) -> dict:
    store=_account_store_id(session,current_user.id)
    feedback=session.execute(text("""SELECT review.id FROM product_reviews review JOIN stores shop ON shop.id=review.store_id
        WHERE review.id=:id AND review.store_id=:store AND shop.business_owner_id=:owner
          AND review.removed_at IS NULL FOR UPDATE OF review"""),{'id':feedback_id,'store':store,'owner':current_user.id}).first()
    if feedback is None:
        raise HTTPException(404,'Feedback is not available for this shop owner to flag.')
    row=session.execute(text("""INSERT INTO product_feedback_flags(feedback_id,store_id,author_id,description)
        VALUES (:id,:store,:owner,:description) ON CONFLICT(feedback_id) DO NOTHING RETURNING id,status"""),
        {'id':feedback_id,'store':store,'owner':current_user.id,'description':request.description}).mappings().one_or_none()
    if row is None:
        raise HTTPException(409,'This feedback has already been flagged. Follow its moderator outcome on this page.')
    session.commit()
    return dict(row)


def product_flag_queue(session: Session,state: str,offset: int,limit: int,search: str) -> dict:
    base=""" FROM product_feedback_flags flag JOIN product_reviews review ON review.id=flag.feedback_id
        JOIN products product ON product.id=review.product_id JOIN stores shop ON shop.id=flag.store_id
        JOIN business_owners owner ON owner.id=flag.author_id JOIN users customer ON customer.id=review.user_id
        WHERE (:state='all' OR (:state='pending' AND flag.status='pending') OR (:state='resolved' AND flag.status<>'pending'))
        AND (:search='' OR lower(shop.store_name) LIKE :term OR lower(product.product_name) LIKE :term
          OR lower(flag.description) LIKE :term OR lower(COALESCE(review.comment,'')) LIKE :term) """
    params={'state':state,'offset':offset,'limit':limit,'search':search.strip(),'term':f'%{search.strip().lower()}%'}
    rows=session.execute(text('SELECT flag.*,review.rating,review.comment,customer.name AS reviewer_name,shop.store_name,product.product_name,owner.name AS author_name '+base+' ORDER BY flag.created_at,flag.id LIMIT :limit OFFSET :offset'),params).mappings().all()
    total=session.execute(text('SELECT COUNT(*) '+base),params).scalar_one()
    return {'product_feedback_flags':[dict(row) for row in rows],'product_flag_total':total}


@moderator_router.post('/moderation/product-feedback-flags/{flag_id}/decision')
def decide_product_feedback_flag(flag_id: UUID,request: FeedbackFlagDecision,
                                 current_user: AuthenticatedUser = Moderator,session: Session = Depends(get_db_session)) -> dict:
    flag=session.execute(text("""SELECT flag.*,review.user_id FROM product_feedback_flags flag
        JOIN product_reviews review ON review.id=flag.feedback_id WHERE flag.id=:id FOR UPDATE OF flag,review"""),{'id':flag_id}).mappings().one_or_none()
    if flag is None: raise HTTPException(404,'Feedback flag not found.')
    if flag['status']!='pending': raise HTTPException(409,'This feedback flag has already been decided.')
    if request.decision=='removed':
        session.execute(text('UPDATE product_reviews SET removed_at=now(),removed_by_administrator_id=:moderator WHERE id=:id'),{'id':flag['feedback_id'],'moderator':current_user.id})
    session.execute(text('UPDATE product_feedback_flags SET status=:decision,resolution_note=:note,resolved_at=now(),moderator_id=:moderator WHERE id=:id'),{'id':flag_id,'decision':request.decision,'note':request.note,'moderator':current_user.id})
    create_notification(session,user_id=flag['user_id'],category='moderation',title='Product feedback decision',
        message=f"{'Your product feedback was removed' if request.decision=='removed' else 'The shop’s flag was dismissed; your feedback remains visible'}: {request.note}"[:500],
        source_key=f'product-feedback-decision:{flag_id}',action_path='/marketplace/reviews')
    _record_administrator_action(session,administrator_id=current_user.id,area='moderation',action_type='moderation.product_feedback_decided',entity_type='product_feedback_flag',entity_id=flag_id,entity_label='Product feedback flag',summary=request.note,before_state={'status':'pending'},after_state={'status':request.decision})
    session.commit()
    return {'id':flag_id,'status':request.decision}
