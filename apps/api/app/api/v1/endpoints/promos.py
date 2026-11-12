from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.promos import PromoCode, PromoList

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


@router.get("/me", response_model=PromoList)
def get_my_promos(current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> PromoList:
    rows = session.execute(text("""
        SELECT p.id, p.code, p.title, p.description, p.discount_percent,
               p.discount_amount, p.audience, p.end_date
        FROM promo_codes p
        JOIN users u ON u.id = :user_id
        LEFT JOIN user_promo_codes up ON up.promo_code_id = p.id AND up.user_id = u.id
        WHERE p.status = 'active' AND now() BETWEEN p.start_date AND p.end_date
          AND up.redeemed_at IS NULL
          AND (
            p.audience = 'available'
            OR (p.audience = 'new_account' AND u.date_joined >= now() - interval '30 days')
            OR (p.audience = 'gift' AND up.user_id IS NOT NULL)
          )
        ORDER BY CASE p.audience WHEN 'available' THEN 1 WHEN 'new_account' THEN 2 ELSE 3 END, p.end_date
    """), {"user_id": current_user.id}).mappings().all()
    return PromoList(promos=[PromoCode(**row) for row in rows])
