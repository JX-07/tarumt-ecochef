ALTER TABLE ingredients
    ADD COLUMN IF NOT EXISTS icon VARCHAR(8);

COMMENT ON COLUMN ingredients.icon IS
    'Optional user-selected emoji or short symbol. NULL keeps automatic name-based icon selection.';
