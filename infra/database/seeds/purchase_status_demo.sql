-- Adds one recent purchase-history record for every mobile status-tag state.
-- Safe to re-run: the CODEX_STATUS_PREVIEW delivery-address marker prevents duplicates.
WITH demo(status, product_name, amount, age_minutes) AS (
    VALUES
        ('placed', 'Fresh Vegetable Box', 24.50::numeric, 1),
        ('pending', 'Wholegrain Bread', 7.20::numeric, 2),
        ('preparing', 'Seasonal Fruit Box', 18.80::numeric, 3),
        ('completed', 'Local Pantry Bundle', 36.00::numeric, 5),
        ('cancelled', 'Cancelled Basket', 0.00::numeric, 7),
        ('failed', 'Payment Retry Basket', 0.00::numeric, 8),
        ('refunded', 'Refunded Grocery Order', 0.00::numeric, 9)
),
target_cart AS (
    SELECT cart.id
    FROM carts cart
    JOIN users consumer ON consumer.id = cart.user_id
    WHERE consumer.name = 'Ahmad'
    ORDER BY cart.id
    LIMIT 1
),
target_store AS (
    SELECT id FROM stores WHERE status = 'approved' ORDER BY store_name LIMIT 1
),
inserted AS (
    INSERT INTO orders (id, cart_id, delivery_address, order_date, order_status, total_amount)
    SELECT gen_random_uuid(), target_cart.id, 'CODEX_STATUS_PREVIEW:' || demo.status,
           now() - demo.age_minutes * interval '1 minute', demo.status, demo.amount
    FROM demo CROSS JOIN target_cart
    WHERE NOT EXISTS (
        SELECT 1 FROM orders existing
        WHERE existing.cart_id = target_cart.id
          AND existing.delivery_address = 'CODEX_STATUS_PREVIEW:' || demo.status
    )
    RETURNING id, order_status, total_amount
)
INSERT INTO order_items
    (order_id, product_id, store_id, product_name, unit_price, quantity,
     line_total, discount_amount, net_amount)
SELECT inserted.id, NULL, target_store.id, demo.product_name, inserted.total_amount, 1,
       inserted.total_amount, 0, inserted.total_amount
FROM inserted
JOIN demo ON demo.status = inserted.order_status
CROSS JOIN target_store;
