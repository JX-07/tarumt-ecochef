-- Rebaseline for the Chapter 4.3 data dictionary.
-- This migration is for the empty local development database only.
BEGIN;

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20),
    date_joined TIMESTAMPTZ NOT NULL DEFAULT now(),
    profile_picture_url VARCHAR(255)
);

CREATE TABLE business_owners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    date_joined TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE administrators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_level VARCHAR(20) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    date_assigned TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_owner_id UUID NOT NULL REFERENCES business_owners(id),
    store_name VARCHAR(100) NOT NULL,
    store_address VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20),
    operating_hours VARCHAR(100),
    status VARCHAR(20) NOT NULL
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id),
    product_name VARCHAR(100) NOT NULL,
    description VARCHAR(100),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER NOT NULL CHECK (stock_quantity >= 0)
);

CREATE TABLE carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE cart_items (
    cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    date_added TIMESTAMPTZ NOT NULL DEFAULT now(),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL REFERENCES carts(id),
    delivery_address VARCHAR(100) NOT NULL,
    order_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    order_status VARCHAR(20) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0)
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    payment_method VARCHAR(30) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    payment_status VARCHAR(20) NOT NULL,
    payment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    coupon_applied VARCHAR(20)
);

CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    delivery_status VARCHAR(20) NOT NULL,
    estimated_arrival TIMESTAMPTZ,
    delivered_date TIMESTAMPTZ
);

CREATE TABLE promo_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_percent NUMERIC(5, 2) CHECK (discount_percent > 0 AND discount_percent <= 100),
    discount_amount NUMERIC(10, 2) CHECK (discount_amount > 0),
    status VARCHAR(20) NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    usage_limit INTEGER CHECK (usage_limit > 0),
    CHECK ((discount_percent IS NULL) <> (discount_amount IS NULL)),
    CHECK (end_date > start_date)
);

CREATE TABLE store_reviews (
    store_id UUID NOT NULL REFERENCES stores(id),
    user_id UUID NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment VARCHAR(500),
    date_submitted TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, user_id)
);

CREATE TABLE addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    address_line_1 VARCHAR(255) NOT NULL,
    address_line_2 VARCHAR(255),
    city VARCHAR(50) NOT NULL,
    state VARCHAR(50) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE user_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_name VARCHAR(100) NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id),
    created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    description VARCHAR(300)
);

CREATE TABLE group_members (
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    join_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(20) NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE group_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role_name VARCHAR(30) NOT NULL,
    FOREIGN KEY (group_id, user_id) REFERENCES group_members(group_id, user_id)
);

CREATE TABLE friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id_1 UUID NOT NULL REFERENCES users(id),
    user_id_2 UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL,
    date_requested TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (user_id_1 <> user_id_2),
    UNIQUE (user_id_1, user_id_2)
);

CREATE TABLE meal_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    default_unit VARCHAR(20),
    ingredient_type VARCHAR(20) NOT NULL
);

CREATE TABLE ingredient_inventories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE ingredient_inventory_items (
    ingredient_inventory_id UUID NOT NULL REFERENCES ingredient_inventories(id) ON DELETE CASCADE,
    ingredient_id UUID NOT NULL REFERENCES ingredients(id),
    quantity VARCHAR(20) NOT NULL,
    expiry_date TIMESTAMPTZ NOT NULL,
    date_recorded TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ingredient_inventory_id, ingredient_id)
);

CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(150) NOT NULL,
    instructions VARCHAR(2000) NOT NULL,
    prep_time INTEGER CHECK (prep_time >= 0),
    cook_time INTEGER CHECK (cook_time >= 0),
    servings INTEGER CHECK (servings > 0),
    date_created TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meal_plan_recipes (
    meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
    recipe_id UUID NOT NULL REFERENCES recipes(id),
    scheduled_date DATE NOT NULL,
    meal_slot VARCHAR(20) NOT NULL,
    PRIMARY KEY (meal_plan_id, recipe_id)
);

CREATE TABLE recipe_ingredients (
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id UUID NOT NULL REFERENCES ingredients(id),
    quantity VARCHAR(20) NOT NULL,
    PRIMARY KEY (recipe_id, ingredient_id)
);

CREATE TABLE recipe_feedback (
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment VARCHAR(500),
    date_submitted TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (recipe_id, user_id)
);

CREATE TABLE recipe_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(500)
);

CREATE TABLE recipe_tag_list (
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    recipe_tag_id UUID NOT NULL REFERENCES recipe_tags(id),
    PRIMARY KEY (recipe_id, recipe_tag_id)
);

CREATE TABLE diet_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE diets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diet_name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(300),
    tag_preference_id UUID NOT NULL REFERENCES diet_tags(id),
    tag_restrict_id UUID NOT NULL REFERENCES diet_tags(id)
);

CREATE TABLE user_diets (
    user_id UUID NOT NULL REFERENCES users(id),
    diet_id UUID NOT NULL REFERENCES diets(id),
    PRIMARY KEY (user_id, diet_id)
);

CREATE TABLE schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES ('0001_chapter_4_3_schema');

CREATE INDEX stores_business_owner_idx ON stores(business_owner_id);
CREATE INDEX products_store_idx ON products(store_id);
CREATE INDEX orders_cart_idx ON orders(cart_id);
CREATE INDEX recipes_user_idx ON recipes(user_id);
CREATE INDEX ingredient_inventories_user_idx ON ingredient_inventories(user_id);
CREATE INDEX meal_plans_user_idx ON meal_plans(user_id);

COMMIT;
