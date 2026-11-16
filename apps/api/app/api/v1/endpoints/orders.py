from decimal import Decimal

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.orders import PurchaseHistory, PurchaseItem, PurchaseOrder
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


@router.get("/history", response_model=PurchaseHistory)
def purchase_history(
    current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)
) -> PurchaseHistory:
    rows = (
        session.execute(
            text("""
        SELECT o.id, o.order_date, o.order_status AS status, o.total_amount,
               o.cancellation_reason,
               COALESCE((
                   SELECT payment.payment_status FROM payments payment
                   WHERE payment.order_id = o.id
                   ORDER BY payment.paid_at DESC NULLS LAST, payment.id DESC LIMIT 1
               ), 'pending') AS payment_status,
               CASE WHEN o.delivery_address = 'Customer pickup directly from store'
                    THEN 'pickup' ELSE 'delivery' END AS fulfillment_method,
               GREATEST(30, COALESCE((
                   SELECT MAX(COALESCE(store.estimated_delivery_minutes, 30))
                   FROM order_items ordered_item
                   JOIN stores store ON store.id = ordered_item.store_id
                   WHERE ordered_item.order_id = o.id
               ), 30)) AS estimated_delivery_minutes,
               COALESCE(MIN(s.store_name), 'EcoChef Marketplace') AS shop
        FROM orders o JOIN carts c ON c.id = o.cart_id
        LEFT JOIN order_items item ON item.order_id = o.id
        LEFT JOIN stores s ON s.id = item.store_id
        WHERE c.user_id = :user_id
        GROUP BY o.id ORDER BY o.order_date DESC
    """),
            {"user_id": current_user.id},
        )
        .mappings()
        .all()
    )
    orders = []
    for row in rows:
        items = (
            session.execute(
                text("""
            SELECT item.product_name AS name, item.quantity, item.unit_price
            FROM order_items item WHERE item.order_id = :order_id
            ORDER BY item.product_name
        """),
                {"order_id": row["id"]},
            )
            .mappings()
            .all()
        )
        orders.append(PurchaseOrder(**row, items=[PurchaseItem(**item) for item in items]))
    return PurchaseHistory(
        total_spend=sum(
            (
                order.total_amount
                for order in orders
                if order.status not in {"cancelled", "failed", "refunded"}
            ),
            Decimal(0),
        ),
        transaction_count=len(orders),
        orders=orders,
    )
