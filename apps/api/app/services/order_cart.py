"""Consume a paid order's immutable snapshot without clearing later cart edits."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


def lock_order_cart(session: Session, order_id: UUID) -> None:
    # Cart mutations use this same user-scoped lock in _active_cart_id.
    session.execute(
        text("""
        SELECT pg_advisory_xact_lock(hashtextextended(CAST(c.user_id AS text), 0))
        FROM carts c JOIN orders o ON o.cart_id = c.id WHERE o.id = :order_id
    """),
        {"order_id": order_id},
    )


def lock_checkout_cart(session: Session, checkout_session_id: str) -> None:
    # Acquire before payment/order/product row locks, matching the cart edit lock order.
    session.execute(
        text("""
        SELECT pg_advisory_xact_lock(hashtextextended(CAST(c.user_id AS text), 0))
        FROM carts c JOIN orders o ON o.cart_id = c.id JOIN payments p ON p.order_id = o.id
        WHERE p.stripe_checkout_session_id = :checkout_session_id
    """),
        {"checkout_session_id": checkout_session_id},
    )


def consume_order_cart_snapshot(session: Session, order_id: UUID) -> None:
    lock_order_cart(session, order_id)
    rows = session.execute(
        text("""
        SELECT ci.cart_id, ci.product_id, ci.quantity, item.quantity AS purchased_quantity
        FROM cart_items ci JOIN orders o ON o.cart_id = ci.cart_id
        JOIN order_items item ON item.order_id = o.id AND item.product_id = ci.product_id
        WHERE o.id = :order_id ORDER BY ci.product_id FOR UPDATE OF ci
    """),
        {"order_id": order_id},
    ).all()
    for row in rows:
        remaining = max(0, row.quantity - row.purchased_quantity)
        params = {"cart_id": row.cart_id, "product_id": row.product_id}
        if remaining:
            session.execute(
                text("""
                UPDATE cart_items SET quantity = :quantity
                WHERE cart_id = :cart_id AND product_id = :product_id
            """),
                {**params, "quantity": remaining},
            )
        else:
            session.execute(
                text("""
                DELETE FROM cart_items WHERE cart_id = :cart_id AND product_id = :product_id
            """),
                params,
            )
