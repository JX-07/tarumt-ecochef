BEGIN;

CREATE TABLE user_blocks (
    blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX friendships_user_1_idx ON friendships(user_id_1, status);
CREATE INDEX friendships_user_2_idx ON friendships(user_id_2, status);
CREATE INDEX user_blocks_blocked_idx ON user_blocks(blocked_user_id);

INSERT INTO schema_migrations (version) VALUES ('0007') ON CONFLICT (version) DO NOTHING;
COMMIT;
