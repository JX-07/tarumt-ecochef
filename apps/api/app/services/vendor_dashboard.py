"""Calendar-scoped vendor analytics derived from immutable paid order snapshots."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

MALAYSIA = ZoneInfo("Asia/Kuala_Lumpur")


def period_bounds(
    period: str, year: int | None = None, month: int | None = None, now: datetime | None = None
) -> tuple[datetime, datetime, str]:
    today = (now or datetime.now(timezone.utc)).astimezone(MALAYSIA).date()
    if period not in {"today", "week", "month", "year"}:
        raise HTTPException(422, "Choose today, week, month or year.")
    if (year is not None and (year < 2000 or year > today.year)) or (
        month is not None and not 1 <= month <= 12
    ):
        raise HTTPException(422, "Choose a valid reporting month and year.")
    if period in {"today", "week"} and (year is not None or month is not None):
        raise HTTPException(422, "Today and this week always use the current Malaysia calendar.")
    if period == "year" and month is not None:
        raise HTTPException(422, "A yearly report does not take a month.")
    if month is not None and year is None:
        raise HTTPException(422, "Choose a year for the reporting month.")
    selected_year = year or today.year
    if period == "today":
        start, end, label = today, today + timedelta(days=1), "Today"
    elif period == "week":
        start = today - timedelta(days=today.weekday())
        end, label = start + timedelta(days=7), "This Week"
    elif period == "month":
        selected_month = month or (
            today.month if year is None or selected_year == today.year else 1
        )
        start = date(selected_year, selected_month, 1)
        if start > today:
            raise HTTPException(422, "Future reporting months are not available.")
        end = date(selected_year + (selected_month == 12), selected_month % 12 + 1, 1)
        label = start.strftime("%B %Y")
    else:
        start, end = date(selected_year, 1, 1), date(selected_year + 1, 1, 1)
        label = str(selected_year)
    return datetime.combine(start, time(), MALAYSIA), datetime.combine(end, time(), MALAYSIA), label


# EXISTS avoids multiplying totals if an order has multiple payment attempts.
# Proceeds use captured allocations, including transfers awaiting settlement;
# reversals are deducted even if the original transfer's status has changed.
ORDER_CTE = """
    WITH store_orders AS (
      SELECT o.id, o.order_date, o.order_status AS status, u.name AS customer_name,
        c.user_id, SUM(item.net_amount) AS merchandise_total, SUM(item.quantity) AS units,
        string_agg(item.product_name||' ×'||item.quantity, ', ' ORDER BY item.product_name) AS items,
        CASE WHEN o.delivery_address='Customer pickup directly from store' THEN 'pickup' ELSE 'delivery' END AS fulfillment_method,
        EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.payment_status='refunded') AS fully_refunded,
        COALESCE((SELECT SUM(GREATEST(a.transfer_amount-a.reversed_amount,0))
          FROM payment_vendor_allocations a JOIN payments p ON p.id=a.payment_id
          WHERE p.order_id=o.id AND a.store_id=:store_id
            AND (p.paid_at IS NOT NULL OR p.payment_status IN ('paid','partially_refunded','refunded','disputed'))),0) AS net_proceeds
      FROM orders o JOIN carts c ON c.id=o.cart_id JOIN users u ON u.id=c.user_id
      JOIN order_items item ON item.order_id=o.id AND item.store_id=:store_id
      WHERE o.order_date>=:start AND o.order_date<:as_of
        AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id
          AND (p.paid_at IS NOT NULL OR p.payment_status IN ('paid','partially_refunded','refunded','disputed')))
      GROUP BY o.id,c.user_id,u.name
    ), paid_sales AS (
      SELECT * FROM store_orders WHERE status NOT IN ('cancelled','failed','refunded') AND NOT fully_refunded
    )
"""


def build_dashboard(
    session: Session,
    store_id: UUID,
    period: str = "week",
    year: int | None = None,
    month: int | None = None,
    now: datetime | None = None,
) -> dict:
    now = now or datetime.now(timezone.utc)
    start, end, label = period_bounds(period, year, month, now)
    params = {"store_id": store_id, "start": start, "end": end, "as_of": min(end, now)}
    store = (
        session.execute(text("SELECT id,store_name AS name FROM stores WHERE id=:store_id"), params)
        .mappings()
        .one()
    )
    summary = (
        session.execute(
            text(
                ORDER_CTE
                + """
      SELECT (SELECT COALESCE(SUM(net_proceeds),0) FROM paid_sales) AS revenue,
        (SELECT COALESCE(SUM(merchandise_total),0) FROM paid_sales) AS sales,
        (SELECT COUNT(*) FROM store_orders) AS orders,
        (SELECT COUNT(DISTINCT COALESCE(item.product_id::text,'deleted:'||item.product_name)) FROM order_items item JOIN paid_sales o ON o.id=item.order_id
          WHERE item.store_id=:store_id) AS products,
        (SELECT COUNT(*) FROM promo_codes pc WHERE pc.store_id=:store_id AND pc.status IN ('active','expired')
          AND pc.start_date<:as_of AND pc.end_date>=:start) AS deals
    """
            ),
            params,
        )
        .mappings()
        .one()
    )
    order_summary = (
        session.execute(
            text(
                ORDER_CTE
                + """
      SELECT COUNT(*) FILTER(WHERE status='completed') AS completed,
        COUNT(*) FILTER(WHERE status IN ('cancelled','failed')) AS cancelled,
        COUNT(*) FILTER(WHERE fully_refunded OR status='refunded') AS refunded,
        COUNT(*) FILTER(WHERE status IN ('placed','pending','preparing','ready') AND NOT fully_refunded) AS active,
        COUNT(*) FILTER(WHERE fulfillment_method='delivery') AS delivery,
        COUNT(*) FILTER(WHERE fulfillment_method='pickup') AS pickup,
        COUNT(DISTINCT user_id) AS customer_count,
        COALESCE(SUM(units) FILTER(WHERE status NOT IN ('cancelled','failed','refunded') AND NOT fully_refunded),0) AS items_sold
      FROM store_orders
    """
            ),
            params,
        )
        .mappings()
        .one()
    )
    # Generate the axis in Malaysia local time. Daily points also cover days with no sales.
    unit = "month" if period == "year" else "day"
    buckets = (
        session.execute(
            text(
                ORDER_CTE
                + f"""
      SELECT bucket::date AS day, COALESCE(SUM(o.net_proceeds),0) AS amount
      FROM generate_series(CAST(:start AS timestamptz) AT TIME ZONE 'Asia/Kuala_Lumpur',
        (CAST(:end AS timestamptz) AT TIME ZONE 'Asia/Kuala_Lumpur')-interval '1 {unit}', interval '1 {unit}') bucket
      LEFT JOIN paid_sales o ON date_trunc('{unit}',o.order_date AT TIME ZONE 'Asia/Kuala_Lumpur')=bucket
      GROUP BY bucket ORDER BY bucket
    """
            ),
            params,
        )
        .mappings()
        .all()
    )
    top = (
        session.execute(
            text(
                ORDER_CTE
                + """
      SELECT COALESCE(item.product_id::text,'deleted:'||item.product_name) AS id, COALESCE(MAX(p.product_name),MAX(item.product_name)) AS name, MAX(p.category) AS category,
        COALESCE(MAX(p.price),MAX(item.unit_price)) AS price,MAX(p.original_price) AS original_price,SUM(item.quantity) AS sold
      FROM order_items item JOIN paid_sales o ON o.id=item.order_id LEFT JOIN products p ON p.id=item.product_id
      WHERE item.store_id=:store_id GROUP BY COALESCE(item.product_id::text,'deleted:'||item.product_name)
      ORDER BY sold DESC,name LIMIT 4
    """
            ),
            params,
        )
        .mappings()
        .all()
    )
    reviews = (
        session.execute(
            text("""
      SELECT r.rating,r.comment,r.date_submitted,u.name,product.product_name FROM product_reviews r
      JOIN products product ON product.id=r.product_id JOIN users u ON u.id=r.user_id
      WHERE r.store_id=:store_id AND r.removed_at IS NULL AND r.date_submitted>=:start AND r.date_submitted<:as_of
      ORDER BY r.date_submitted DESC,r.id LIMIT 4
    """),
            params,
        )
        .mappings()
        .all()
    )
    review_summary = (
        session.execute(
            text("""SELECT COALESCE(AVG(rating),0) AS rating,COUNT(*) AS count
      FROM product_reviews WHERE store_id=:store_id AND removed_at IS NULL AND date_submitted>=:start AND date_submitted<:as_of"""),
            params,
        )
        .mappings()
        .one()
    )
    live_orders = (
        session.execute(
            text(
                ORDER_CTE
                + """SELECT id,customer_name,items,merchandise_total AS total,status,order_date
      FROM paid_sales WHERE status IN ('placed','pending','preparing','ready') ORDER BY order_date DESC,id LIMIT 4"""
            ),
            params,
        )
        .mappings()
        .all()
    )
    inventory = (
        session.execute(
            text("""SELECT COUNT(*) AS listed,
      COUNT(*) FILTER(WHERE status='active' AND stock_quantity>0 AND stock_quantity<5) AS low_stock,
      COUNT(*) FILTER(WHERE stock_quantity=0) AS out_of_stock FROM products WHERE store_id=:store_id"""),
            params,
        )
        .mappings()
        .one()
    )
    first_year = session.execute(
        text("""SELECT MIN(EXTRACT(YEAR FROM activity_date AT TIME ZONE 'Asia/Kuala_Lumpur'))::int FROM (
      SELECT o.order_date AS activity_date FROM orders o JOIN order_items item ON item.order_id=o.id WHERE item.store_id=:store_id
      UNION ALL SELECT date_submitted FROM product_reviews WHERE store_id=:store_id
      UNION ALL SELECT start_date FROM promo_codes WHERE store_id=:store_id
    ) activity"""),
        params,
    ).scalar_one()
    current_year = now.astimezone(MALAYSIA).year
    report_years = list(
        range(current_year, max(2000, min(first_year or current_year, current_year)) - 1, -1)
    )
    return {
        "period": {
            "key": period,
            "label": label,
            "start_date": start.date().isoformat(),
            "end_date": (end.date() - timedelta(days=1)).isoformat(),
            "timezone": "Asia/Kuala_Lumpur",
        },
        "store": dict(store),
        "generated_at": now.isoformat(),
        "summary": dict(summary),
        "order_summary": dict(order_summary),
        "revenue": [dict(row) for row in buckets],
        "top_products": [dict(row) for row in top],
        "reviews": [dict(row) for row in reviews],
        "review_summary": dict(review_summary),
        "live_orders": [dict(row) for row in live_orders],
        "inventory": dict(inventory),
        "report_years": report_years,
        "notes": [
            "Calendar boundaries use Malaysia time. Orders and revenue are attributed to the original order date.",
            "Net store revenue is captured vendor proceeds less recorded transfer reversals, including proceeds awaiting transfer. It excludes cancelled, failed and fully refunded orders.",
            "Merchandise sales are original paid item totals before vendor fees and any partial refunds. Units reflect ordered quantities; returned units are not tracked.",
            "Products sold counts distinct product listings purchased during the period. Deals counts enabled or expired coupon records whose validity overlaps the period; disabled/deleted promotions cannot be reconstructed historically.",
            "Inventory is the current snapshot because historical inventory snapshots are not stored. Ratings include visible feedback submitted during the reporting period.",
        ],
    }
