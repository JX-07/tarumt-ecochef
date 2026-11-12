from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.orders import PurchaseHistory, PurchaseItem, PurchaseOrder

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


@router.get("/history", response_model=PurchaseHistory)
def purchase_history(current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> PurchaseHistory:
    rows = session.execute(text("""
        SELECT o.id, o.order_date, o.order_status AS status, o.total_amount,
               COALESCE(MIN(s.store_name), 'EcoChef Marketplace') AS shop
        FROM orders o JOIN carts c ON c.id = o.cart_id
        LEFT JOIN order_items item ON item.order_id = o.id
        LEFT JOIN stores s ON s.id = item.store_id
        WHERE c.user_id = :user_id
        GROUP BY o.id ORDER BY o.order_date DESC
    """), {"user_id": current_user.id}).mappings().all()
    orders = []
    for row in rows:
        items = session.execute(text("""
            SELECT item.product_name AS name, item.quantity, item.unit_price
            FROM order_items item WHERE item.order_id = :order_id
            ORDER BY item.product_name
        """), {"order_id": row["id"]}).mappings().all()
        orders.append(PurchaseOrder(**row, items=[PurchaseItem(**item) for item in items]))
    return PurchaseHistory(total_spend=sum((order.total_amount for order in orders if order.status not in {"cancelled", "failed", "refunded"}), Decimal("0")), transaction_count=len(orders), orders=orders)
