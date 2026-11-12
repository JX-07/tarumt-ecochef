BEGIN;

CREATE TABLE IF NOT EXISTS order_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    sender_role VARCHAR(20) NOT NULL
        CHECK (sender_role IN ('consumer', 'business_owner')),
    sender_id UUID NOT NULL,
    sender_name VARCHAR(150) NOT NULL,
    message_type VARCHAR(20) NOT NULL
        CHECK (message_type IN ('text', 'photo', 'pdf', 'delivery_alert')),
    body VARCHAR(2000),
    attachment_name VARCHAR(255),
    attachment_content_type VARCHAR(100),
    attachment_data BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (message_type IN ('text', 'delivery_alert') AND body IS NOT NULL AND attachment_data IS NULL)
        OR
        (message_type IN ('photo', 'pdf') AND attachment_data IS NOT NULL AND attachment_name IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS order_chat_messages_conversation_idx
    ON order_chat_messages (order_id, store_id, created_at, id);

CREATE TABLE IF NOT EXISTS order_chat_typing (
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    sender_role VARCHAR(20) NOT NULL
        CHECK (sender_role IN ('consumer', 'business_owner')),
    sender_id UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (order_id, store_id, sender_role, sender_id)
);

INSERT INTO schema_migrations (version) VALUES ('0042') ON CONFLICT (version) DO NOTHING;

COMMIT;
