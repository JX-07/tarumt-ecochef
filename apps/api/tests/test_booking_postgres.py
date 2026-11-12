"""Real PostgreSQL checks, opt-in and restricted to an isolated audit database."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
from threading import Event
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.api.v1.endpoints import marketplace
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.marketplace import MarketplaceCart, MarketplaceCartItem, MarketplaceProduct


@pytest.fixture
def booking_data():
    url = os.environ.get("ECOCHEF_AUDIT_DATABASE_URL")
    if not url:
        pytest.skip("Requires a fresh isolated PostgreSQL audit database")
    parsed = make_url(url)
    assert parsed.host == "127.0.0.1" and parsed.port == 55439
    assert parsed.database.startswith("ecochef_audit_")
    engine = create_engine(url)
    with engine.begin() as connection:
        owner = connection.execute(text("INSERT INTO business_owners(name,email,firebase_uid) VALUES ('Audit owner',:email,:uid) RETURNING id"), {"email":f"{uuid4()}@example.test","uid":str(uuid4())}).scalar_one()
        store = connection.execute(text("INSERT INTO stores(business_owner_id,store_name,store_address,status,slot_order_limit,slot_item_limit) VALUES (:owner,'Audit shop','Audit street','approved',1,10) RETURNING id"), {"owner":owner}).scalar_one()
        product = connection.execute(text("INSERT INTO products(store_id,product_name,price,stock_quantity,status) VALUES (:store,'Audit apples',1,100,'active') RETURNING id"), {"store":store}).scalar_one()
        user = connection.execute(text("INSERT INTO users(name,email,firebase_uid) VALUES ('Audit user',:email,:uid) RETURNING id"), {"email":f"{uuid4()}@example.test","uid":str(uuid4())}).scalar_one()
        cart_id = connection.execute(text("INSERT INTO carts(user_id) VALUES (:user) RETURNING id"), {"user":user}).scalar_one()
    cart = MarketplaceCart(id=cart_id, items=[MarketplaceCartItem(product=MarketplaceProduct(id=product,store_id=store,name="Audit apples",price=Decimal(1),discount_percent=0,stock_quantity=100,cart_quantity=2),store_name="Audit shop",line_total=Decimal(2))], item_count=2,subtotal=2,delivery_fee=0,discount=0,total=2)
    tomorrow = datetime.now(timezone.utc).astimezone(marketplace.STORE_TIMEZONE) + timedelta(days=1)
    slot = tomorrow.replace(hour=12,minute=0,second=0,microsecond=0).astimezone(timezone.utc)
    yield engine, cart, slot, store, user
    engine.dispose()


def _insert_order(session, cart, slot):
    order = session.execute(text("INSERT INTO orders(cart_id,delivery_address,order_status,total_amount,fulfilment_slot) VALUES (:cart,'Audit street','pending_payment',2,:slot) RETURNING id"), {"cart":cart.id,"slot":slot}).scalar_one()
    session.execute(text("INSERT INTO order_items(order_id,product_id,store_id,product_name,unit_price,quantity,line_total,discount_amount,net_amount) VALUES (:order,:product,:store,'Audit apples',1,2,2,0,2)"), {"order":order,"product":cart.items[0].product.id,"store":cart.items[0].product.store_id})
    return order


def test_simultaneous_bookings_cannot_take_last_slot_twice(booking_data):
    engine, cart, slot, store, user = booking_data
    started = Event()
    def contender():
        with Session(engine) as session:
            session.execute(text("SET LOCAL lock_timeout = '3s'"))
            started.set()
            try:
                marketplace._reserve_fulfilment_capacity(session, cart, slot)
                _insert_order(session, cart, slot)
                session.commit()
                return "accepted"
            except HTTPException as error:
                session.rollback()
                return error.status_code
    with Session(engine) as first, ThreadPoolExecutor(max_workers=1) as pool:
        marketplace._reserve_fulfilment_capacity(first, cart, slot)
        _insert_order(first, cart, slot)
        future = pool.submit(contender)
        assert started.wait(timeout=3)
        # The contender must wait for the store lock, not read stale capacity.
        from concurrent.futures import TimeoutError
        with pytest.raises(TimeoutError):
            future.result(timeout=.15)
        first.commit()
        assert future.result(timeout=5) == 409


def test_availability_matches_locked_checkout_and_releases_cancelled_slot(booking_data):
    engine, cart, slot, store, user = booking_data
    with Session(engine) as session:
        session.execute(text("INSERT INTO cart_items(cart_id,product_id,quantity) VALUES (:cart,:product,2)"), {"cart":cart.id,"product":cart.items[0].product.id})
        order = _insert_order(session, cart, slot)
        session.commit()
        consumer = AuthenticatedUser(id=user,firebase_uid="audit",name="Audit user",email="audit@example.com",role=AccountRole.consumer)
        day = slot.astimezone(marketplace.STORE_TIMEZONE).date()
        availability = marketplace.cart_slot_availability(day, consumer, session)
        matching = next(item for item in availability["slots"] if datetime.fromisoformat(item["start"]) == slot)
        assert matching["available"] is False
        session.execute(text("UPDATE orders SET order_status='cancelled' WHERE id=:id"), {"id":order})
        session.commit()
        availability = marketplace.cart_slot_availability(day, consumer, session)
        assert next(item for item in availability["slots"] if datetime.fromisoformat(item["start"]) == slot)["available"] is True
        assert marketplace._reserve_fulfilment_capacity(session, cart, slot) == slot



@pytest.mark.parametrize("closure", ["open", "weekly", "holiday"])
def test_closed_today_shop_disables_existing_cart_and_rejects_checkout(booking_data, closure):
    import json
    from app.schemas.marketplace import CartQuantityUpdate, CheckoutRequest
    engine, cart, slot, store, user = booking_data
    consumer = AuthenticatedUser(id=user,firebase_uid="audit",name="Audit user",email="audit@example.com",role=AccountRole.consumer)
    with Session(engine) as session:
        # The basket exists before the store is marked closed.
        session.execute(text("INSERT INTO cart_items(cart_id,product_id,quantity) VALUES (:cart,:product,2)"),{"cart":cart.id,"product":cart.items[0].product.id})
        session.commit()
        if closure == "weekly":
            day = datetime.now(marketplace.STORE_TIMEZONE).strftime("%A")
            session.execute(text("UPDATE stores SET operating_hours_schedule=CAST(:hours AS jsonb) WHERE id=:id"),{"id":store,"hours":json.dumps({day:{"closed":True}})})
        elif closure == "holiday":
            session.execute(text("INSERT INTO store_holiday_closures(store_id,starts_on,ends_on,whole_day,reason) VALUES (:id,(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,true,'Closed for audit test')"),{"id":store})
        session.commit()
        detail = marketplace.marketplace_store(store,address_id=None,latitude=None,longitude=None,current_user=consumer,session=session)
        assert detail.closed_today is (closure != "open")
        assert all(product.store_closed_today is (closure != "open") for product in detail.products)
        loaded = marketplace.get_cart(address_id=None,latitude=None,longitude=None,current_user=consumer,session=session)
        assert bool(loaded.checkout_blocked_reason) is (closure != "open")
        assert loaded.items[0].product.cart_quantity == 2
        if closure != "open":
            order = _insert_order(session, cart, slot)
            session.commit()
            with pytest.raises(HTTPException, match="closed today"):
                marketplace._ensure_order_shop_open_today(session, order)
            with pytest.raises(HTTPException) as addition:
                marketplace.update_cart_item(cart.items[0].product.id,CartQuantityUpdate(quantity=3),consumer,session)
            assert addition.value.status_code == 409
            session.rollback()
            # Future scheduling cannot bypass the explicit closed-today policy.
            with pytest.raises(HTTPException) as checkout:
                marketplace.checkout(CheckoutRequest(fulfillment_method="pickup",arrival_at=slot),consumer,session)
            assert checkout.value.status_code == 409
            assert "closed today" in checkout.value.detail
            # Removing existing unavailable items is always possible.
            marketplace.remove_cart_item(cart.items[0].product.id,consumer,session)
            assert not marketplace.get_cart(address_id=None,latitude=None,longitude=None,current_user=consumer,session=session).items


def test_storefront_closed_state_checks_clock_time_not_only_day_switch(booking_data):
    import json
    from uuid import uuid4
    engine, *_ = booking_data
    with Session(engine) as session:
        day = session.execute(text("SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'FMDay')")).scalar_one()
        for hours in ({"open":"00:00","close":"00:00","closed":False},{"open":"09:00","close":"18:00","closed":True}):
            result=session.execute(text("SELECT "+marketplace._store_closed_today_sql("s")+" FROM (SELECT CAST(:id AS uuid) AS id,CAST(:schedule AS jsonb) AS operating_hours_schedule) s"),{"id":uuid4(),"schedule":json.dumps({day:hours})}).scalar_one()
            assert result is True
