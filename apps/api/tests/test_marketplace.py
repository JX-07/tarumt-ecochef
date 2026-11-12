from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import SecretStr, ValidationError

from app.api.v1.endpoints import marketplace
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.marketplace import (
    CartQuantityUpdate,
    CheckoutRequest,
    MarketplaceCart,
    MarketplaceCartItem,
    MarketplaceLocation,
    MarketplaceProduct,
    ProductReportInput,
)


def _consumer() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(), firebase_uid="market-user", name="Market User",
        email="market@example.com", role=AccountRole.consumer,
    )


def _cart() -> MarketplaceCart:
    product = MarketplaceProduct(
        id=uuid4(), store_id=uuid4(), name="Spinach", price=Decimal("1.49"),
        discount_percent=50, stock_quantity=4, cart_quantity=2,
    )
    return MarketplaceCart(
        id=uuid4(), items=[MarketplaceCartItem(product=product, store_name="Green Farm", line_total=Decimal("2.98"))],
        item_count=2, subtotal=Decimal("2.98"), delivery_fee=Decimal("2.50"),
        discount=Decimal("0"), total=Decimal("5.48"),
    )


def test_cart_quantity_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        CartQuantityUpdate(quantity=0)


def test_store_list_exposes_closed_status_for_logo_treatment() -> None:
    user, session = _consumer(), Mock()
    row = SimpleNamespace(
        id=uuid4(), store_name="Closed Shop", description=None, category="Groceries",
        cover_image_url=None, icon_url="https://example.com/logo.png", store_address="Kuala Lumpur",
        latitude=0, longitude=0, delivery_fee=Decimal("2"), estimated_delivery_minutes=20,
        rating=Decimal("4"), review_count=1, store_closed_today=True,
    )
    session.execute.side_effect = [Mock(all=Mock(return_value=[row])), Mock(one_or_none=Mock(return_value=None))]
    result = marketplace.marketplace_stores("", None, 0, 0, user, session)
    assert result.stores[0].store_closed_today is True


def test_stale_cart_quantity_update_cannot_repopulate_new_cart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, session = _consumer(), Mock()
    paid_cart_id, active_cart_id = uuid4(), uuid4()
    product_result = Mock()
    product_result.one_or_none.return_value = SimpleNamespace(
        stock_quantity=8, product_name="Spinach",
    )
    session.execute.return_value = product_result
    empty_cart = _cart().model_copy(update={"id": active_cart_id, "items": [], "item_count": 0})
    monkeypatch.setattr(marketplace, "_active_cart_id", lambda *_args, **_kwargs: active_cart_id)
    monkeypatch.setattr(marketplace, "_cart_response", lambda *_args, **_kwargs: empty_cart)

    result = marketplace.update_cart_item(
        uuid4(), CartQuantityUpdate(quantity=3, cart_id=paid_cart_id), user, session,
    )

    assert result.item_count == 0
    assert not any(
        "INSERT INTO cart_items" in str(call.args[0])
        for call in session.execute.call_args_list
    )
    session.commit.assert_not_called()


def test_pending_payment_does_not_retire_the_active_cart() -> None:
    session, cart_id = Mock(), uuid4()
    result = Mock()
    result.scalar_one_or_none.return_value = cart_id
    session.execute.return_value = result

    assert marketplace._active_cart_id(session, uuid4()) == cart_id
    statement = str(session.execute.call_args.args[0])
    assert "p.payment_status = 'paid'" in statement


def test_checkout_accepts_only_supported_payment_methods() -> None:
    with pytest.raises(ValidationError):
        CheckoutRequest(address_id=uuid4(), payment_method="cash")


@pytest.mark.parametrize(
    ("environment", "enabled", "key", "expected"),
    [
        ("development", True, "sk_test_example", True),
        ("development", True, "rk_test_example", True),
        ("production", True, "sk_test_example", True),
        ("production", True, "rk_test_example", True),
        ("production", True, "sk_live_example", False),
        ("development", False, "sk_test_example", False),
        ("development", True, "sk_live_example", False),
    ],
)
def test_payment_simulation_requires_all_sandbox_guards(
    monkeypatch: pytest.MonkeyPatch,
    environment: str,
    enabled: bool,
    key: str,
    expected: bool,
) -> None:
    settings = SimpleNamespace(
        environment=environment,
        stripe_simulated_payments_enabled=enabled,
        stripe_api_key=SecretStr(key),
    )
    monkeypatch.setattr(marketplace, "get_settings", lambda: settings)

    assert marketplace._sandbox_payment_simulation_enabled() is expected


def test_checkout_requires_exactly_one_delivery_destination() -> None:
    temporary = MarketplaceLocation(
        address_line_1="Jalan Ampang", city="Kuala Lumpur", state="Kuala Lumpur",
        postal_code="50450", latitude=3.159, longitude=101.713,
    )

    assert CheckoutRequest(temporary_location=temporary, payment_method="card").temporary_location == temporary
    with pytest.raises(ValidationError):
        CheckoutRequest(payment_method="card")
    with pytest.raises(ValidationError):
        CheckoutRequest(address_id=uuid4(), temporary_location=temporary, payment_method="card")
    assert CheckoutRequest(fulfillment_method="pickup").fulfillment_method == "pickup"
    with pytest.raises(ValidationError, match="Pickup orders do not use"):
        CheckoutRequest(fulfillment_method="pickup", address_id=uuid4())


def test_checkout_rejects_invalid_scheduled_delivery_times() -> None:
    with pytest.raises(ValidationError, match="timezone"):
        CheckoutRequest(address_id=uuid4(), payment_method="card", arrival_at=datetime.now() + timedelta(hours=2))
    with pytest.raises(ValidationError, match="future"):
        CheckoutRequest(address_id=uuid4(), payment_method="card", arrival_at=datetime.now(timezone.utc) - timedelta(minutes=1))

    scheduled = datetime.now(timezone.utc) + timedelta(hours=2)
    assert CheckoutRequest(address_id=uuid4(), payment_method="card", arrival_at=scheduled).arrival_at == scheduled


def test_marketplace_distance_is_calculated_in_kilometres() -> None:
    assert marketplace._distance_km(3.1390, 101.6869, 3.1579, 101.7123) == pytest.approx(3.5, abs=.2)
    assert marketplace._distance_km(None, None, 3.1579, 101.7123) is None


def test_delivery_fee_increases_after_included_distance() -> None:
    assert marketplace._distance_delivery_fee(Decimal("0"), None) == Decimal("2.50")
    assert marketplace._distance_delivery_fee(Decimal("2.50"), None) == Decimal("2.50")
    assert marketplace._distance_delivery_fee(Decimal("2.50"), 3.0) == Decimal("2.50")
    assert marketplace._distance_delivery_fee(Decimal("2.50"), 5.0) == Decimal("4.00")
    assert marketplace._distance_delivery_fee(Decimal("2.50"), 10.0) == Decimal("7.75")


def test_delivery_estimate_respects_store_floor_and_longer_journeys() -> None:
    assert marketplace._estimated_delivery_minutes(30, None) == 30
    assert marketplace._estimated_delivery_minutes(30, 2.0) == 30
    assert marketplace._estimated_delivery_minutes(20, 12.0) == 46
    assert marketplace._estimated_delivery_minutes(None, 1.0) == 20


def test_marketplace_product_categories_normalise_legacy_product_labels() -> None:
    assert marketplace._product_category("Fruits") == "Produce"
    assert marketplace._product_category("Sports & Energy Drinks") == "Beverages"
    assert marketplace._product_category("Prepared Food") == "Prepared Food"


def test_unknown_marketplace_product_category_is_rejected() -> None:
    with pytest.raises(HTTPException) as error:
        marketplace.marketplace_product_category("Unknown", current_user=_consumer(), session=Mock())

    assert error.value.status_code == 404


def test_product_report_rejects_blank_requests() -> None:
    with pytest.raises(ValidationError, match="at least 10 characters"):
        ProductReportInput(report_request="             ")


def test_product_report_reaches_grouped_store_moderation(monkeypatch) -> None:
    from app.api.v1.endpoints import reports
    user, product_id, store_id, session = _consumer(), uuid4(), uuid4(), Mock()
    session.execute.return_value.one_or_none.return_value = SimpleNamespace(store_id=store_id,product_name="Apple")
    submit = Mock()
    monkeypatch.setattr(reports,"submit_report",submit)
    marketplace.report_marketplace_product(product_id,ProductReportInput(report_request=" Incorrect product photo "),user,session)
    report, reporter, used_session = submit.call_args.args
    assert report.subject_type == "store" and report.subject_id == store_id
    assert report.category == "other"
    assert report.description == "Product: Apple. Incorrect product photo"
    assert reporter is user and used_session is session


def test_geoapify_uses_bayan_lepas_for_119xx_delivery_addresses() -> None:
    location = marketplace._geoapify_location({
        "properties": {
            "name": "Example Building", "address_line1": "Example Building",
            "city": "George Town", "postcode": "11900",
            "state": "Penang", "lat": 5.334, "lon": 100.268,
        },
        "geometry": {"coordinates": [100.268, 5.334]},
    })

    assert location is not None
    assert location.city == "Bayan Lepas"
    assert location.postal_code == "11900"


def test_geoapify_consolidates_landmark_variants_using_complete_address() -> None:
    features = [
        {"properties": {"name": "Regency Heights", "address_line1": "Bayan Lepas", "city": "George Town", "district": "Sungai Ara", "lat": 5.32, "lon": 100.26}},
        {"properties": {"name": "Regency Heights Condominium Clubhouse", "address_line1": "Regency Heights Condominium Clubhouse", "street": "Jalan Kenari", "postcode": "11900", "city": "George Town", "district": "Sungai Ara", "state": "Penang", "lat": 5.321, "lon": 100.263}},
        {"properties": {"address_line1": "Regency Heights", "street": "Regency Heights", "postcode": "11900", "city": "George Town", "district": "Sungai Ara", "lat": 5.322, "lon": 100.264}},
    ]

    locations = marketplace._consolidate_autocomplete(features)

    assert len(locations) == 1
    assert locations[0].name == "Regency Heights"
    assert locations[0].address_line_1 == "Jalan Kenari, Sungai Ara"
    assert locations[0].city == "Bayan Lepas"
    assert locations[0].postal_code == "11900"


def test_checkout_rolls_back_all_changes_when_a_write_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    user, cart, session = _consumer(), _cart(), Mock()
    address = SimpleNamespace(address_line_1="123 Green Avenue", address_line_2=None, city="Kuala Lumpur", state="WP", postal_code="50000")
    address_result, order_result = Mock(), Mock()
    address_result.one_or_none.return_value = address
    order_result.scalar_one.return_value = uuid4()
    payment_result = Mock()
    payment_result.scalar_one.return_value = uuid4()
    session.execute.side_effect = [
        address_result, order_result, payment_result, Mock(), Mock(),
        RuntimeError("stock write failed"),
    ]
    monkeypatch.setattr(marketplace, "_cart_response", lambda *_args, **_kwargs: cart)
    monkeypatch.setattr(marketplace, "_reserve_fulfilment_capacity", lambda *_args: datetime.now(timezone.utc))
    monkeypatch.setattr(marketplace, "_ensure_no_pending_checkout", lambda *_args: None)

    with pytest.raises(RuntimeError, match="stock write failed"):
        marketplace.checkout(CheckoutRequest(address_id=uuid4(), payment_method="card"), user, session)

    session.rollback.assert_called_once_with()
    session.commit.assert_not_called()


def test_checkout_does_not_decrease_stock_before_payment(monkeypatch: pytest.MonkeyPatch) -> None:
    user, cart, session = _consumer(), _cart(), Mock()
    order_id, payment_id = uuid4(), uuid4()
    address = SimpleNamespace(
        address_line_1="123 Green Avenue", address_line_2=None,
        city="Kuala Lumpur", state="WP", postal_code="50000",
    )

    def execute(statement, _parameters=None):
        sql = str(statement)
        result = Mock()
        if "FROM addresses" in sql:
            result.one_or_none.return_value = address
        elif "INSERT INTO orders" in sql:
            result.scalar_one.return_value = order_id
        elif "INSERT INTO payments" in sql:
            result.scalar_one.return_value = payment_id
        return result

    session.execute.side_effect = execute
    monkeypatch.setattr(marketplace, "_cart_response", lambda *_args, **_kwargs: cart)
    monkeypatch.setattr(marketplace, "_reserve_fulfilment_capacity", lambda *_args: datetime.now(timezone.utc))
    monkeypatch.setattr(marketplace, "_ensure_no_pending_checkout", lambda *_args: None)
    monkeypatch.setattr(
        marketplace.stripe_payments,
        "create_checkout_session",
        lambda **_kwargs: SimpleNamespace(id="cs_test", client_secret="cs_secret"),
    )

    marketplace.checkout(
        CheckoutRequest(address_id=uuid4(), payment_method="card"), user, session,
    )

    statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert not any("UPDATE products" in statement for statement in statements)
    session.commit.assert_called_once_with()


def test_simulated_payment_decreases_stock_and_clears_paid_cart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, session = _consumer(), Mock()
    order_id, payment_id = uuid4(), uuid4()
    payment_result, inventory_result = Mock(), Mock()
    payment_result.one_or_none.return_value = SimpleNamespace(
        id=payment_id,
        order_id=order_id,
        payment_status="pending",
        inventory_deducted_at=None,
        order_status="pending_payment",
        total_amount=Decimal("5.48"),
    )
    inventory_result.all.return_value = [SimpleNamespace(
        id=uuid4(), product_name="Spinach", stock_quantity=4, quantity=2,
    )]
    session.execute.side_effect = [
        Mock(), payment_result, inventory_result, Mock(), Mock(), Mock(), Mock(), Mock(),
    ]
    monkeypatch.setattr(marketplace, "_sandbox_payment_simulation_enabled", lambda: True)
    monkeypatch.setattr(marketplace, "_ensure_order_shop_open_today", lambda *_args: None)
    monkeypatch.setattr(
        marketplace.stripe_payments,
        "create_sandbox_payment",
        lambda **_kwargs: SimpleNamespace(
            id="pi_test_ecochef", latest_charge=SimpleNamespace(id="ch_test_ecochef")
        ),
    )

    cleanup = Mock()
    monkeypatch.setattr(marketplace, "consume_order_cart_snapshot", cleanup)
    result = marketplace.simulate_checkout_payment(order_id, user, session)

    statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert result.payment_status == "paid"
    assert sum("UPDATE products product" in statement for statement in statements) == 1
    cleanup.assert_called_once_with(session, order_id)
    payment_update = next(
        call for call in session.execute.call_args_list
        if "stripe_payment_intent_id" in str(call.args[0])
    )
    assert payment_update.args[1]["payment_intent_id"] == "pi_test_ecochef"
    assert payment_update.args[1]["charge_id"] == "ch_test_ecochef"
    session.commit.assert_called_once_with()


def test_locked_cart_rejects_stale_stock(monkeypatch: pytest.MonkeyPatch) -> None:
    row = SimpleNamespace(product_name="Spinach", store_status="approved", product_status="active", expiry_date=None, quantity=3, stock_quantity=2)
    monkeypatch.setattr(marketplace, "_active_cart_id", lambda *_args, **_kwargs: uuid4())
    monkeypatch.setattr(marketplace, "_cart_rows", lambda *_args, **_kwargs: [row])

    with pytest.raises(HTTPException) as error:
        marketplace._cart_response(Mock(), uuid4(), lock=True)

    assert error.value.status_code == 409


def test_cart_clamps_stale_quantity_to_available_stock(monkeypatch: pytest.MonkeyPatch) -> None:
    cart_id, product_id, store_id = uuid4(), uuid4(), uuid4()
    base = {
        "product_id": product_id, "product_name": "Spinach", "description": None,
        "image_url": None, "category": "Produce", "subcategory": None,
        "unit_label": "bag", "brand": None, "size_label": None,
        "price": Decimal("1.49"), "original_price": None, "expiry_date": None,
        "stock_quantity": 3, "addons": [], "discount": None,
        "product_status": "active", "store_id": store_id, "store_name": "Green Farm",
        "store_status": "approved", "delivery_fee": Decimal("2.50"),
    }
    stale = SimpleNamespace(**base, quantity=5)
    adjusted = SimpleNamespace(**base, quantity=3)
    session = Mock()
    monkeypatch.setattr(marketplace, "_active_cart_id", lambda *_args, **_kwargs: cart_id)
    monkeypatch.setattr(marketplace, "_cart_rows", Mock(side_effect=[[stale], [adjusted]]))
    monkeypatch.setattr(marketplace, "_promo_for_cart", lambda *_args, **_kwargs: None)

    cart = marketplace._cart_response(session, uuid4())

    assert cart.items[0].product.cart_quantity == 3
    assert cart.stock_adjustments[0].previous_quantity == 5
    assert cart.stock_adjustments[0].adjusted_quantity == 3
    assert "UPDATE cart_items" in str(session.execute.call_args.args[0])


def test_shop_cart_excludes_other_shops_before_stock_validation(monkeypatch):
    store_id = uuid4()
    cart = _cart()
    row = SimpleNamespace(store_id=store_id, quantity=2, stock_quantity=4, product_name="Spinach", store_name="Green Farm", store_status="approved", product_status="active", expiry_date=None, price=Decimal("1.49"), delivery_fee=Decimal("2.50"))
    other = SimpleNamespace(store_id=uuid4(), store_closed_today=True, quantity=3, stock_quantity=0)
    monkeypatch.setattr(marketplace, "_active_cart_id", lambda *_args, **_kwargs: cart.id)
    monkeypatch.setattr(marketplace, "_cart_rows", lambda *_args, **_kwargs: [row, other])
    monkeypatch.setattr(marketplace, "_promo_for_cart", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(marketplace, "_product", lambda *_args: cart.items[0].product.model_copy(update={"store_id": store_id}))
    monkeypatch.setattr(marketplace, "_direct_line_total", lambda *_args: Decimal("2.98"))
    result = marketplace._cart_response(Mock(), uuid4(), lock=True, store_id=store_id)
    assert result.item_count == 2
    assert len(result.items) == 1
    assert result.total == Decimal("5.48")
    assert result.checkout_blocked_reason is None


def test_remove_shop_carts_only_deletes_selected_shops_in_owned_cart(monkeypatch):
    from app.schemas.marketplace import ShopCartRemoveRequest
    session, cart_id, shop_id = Mock(), uuid4(), uuid4()
    monkeypatch.setattr(marketplace, "_active_cart_id", lambda *_args: cart_id)
    monkeypatch.setattr(marketplace, "_cart_response", lambda *_args: _cart())
    marketplace.remove_shop_carts(ShopCartRemoveRequest(store_ids=[shop_id]), _consumer(), session)
    statement, params = session.execute.call_args.args
    assert "item.cart_id=:cart_id" in str(statement)
    assert "product.store_id=ANY" in str(statement)
    assert params == {"cart_id": cart_id, "store_ids": [str(shop_id)]}
    session.commit.assert_called_once()


@pytest.mark.parametrize("orders,items,quantity,blocked", [(10,0,1,True),(0,99,2,True),(9,98,2,False),(0,0,101,True)])
def test_slot_limits_include_both_orders_and_units(orders, items, quantity, blocked):
    cart, session = _cart(), Mock()
    cart.items[0].product.cart_quantity = quantity
    session.execute.return_value.one.side_effect = [
        SimpleNamespace(slot_order_limit=10, slot_item_limit=100),
        SimpleNamespace(orders=orders, items=items),
    ]
    if blocked:
        with pytest.raises(HTTPException) as error:
            marketplace._reserve_fulfilment_capacity(session, cart, None)
        assert error.value.status_code == 409
    else:
        slot = marketplace._reserve_fulfilment_capacity(session, cart, None)
        assert slot.minute in (0, 30)
    assert "FOR UPDATE" in str(session.execute.call_args_list[0].args[0])


def test_schedule_rejects_insufficient_lead_time_and_distant_dates():
    for delta in (timedelta(minutes=5), timedelta(days=8)):
        with pytest.raises(ValidationError):
            CheckoutRequest(address_id=uuid4(), arrival_at=datetime.now(timezone.utc) + delta)


def test_schedule_rejects_food_expiring_before_arrival():
    cart = _cart()
    cart.items[0].product.expiry_date = datetime.now(timezone.utc) + timedelta(hours=1)
    with pytest.raises(HTTPException, match="expires"):
        marketplace._reserve_fulfilment_capacity(Mock(), cart, (datetime.now(timezone.utc) + timedelta(hours=2)).replace(minute=0,second=0,microsecond=0))


@pytest.mark.parametrize("holiday,hours", [(True,{}),(False,{"closed":True}),(False,{"open":"00:00","close":"00:01"})])
def test_checkout_rejects_closed_store(holiday,hours):
    session = Mock()
    arrival = (datetime.now(timezone.utc) + timedelta(days=1)).replace(minute=0,second=0,microsecond=0)
    local = arrival.astimezone(timezone(timedelta(hours=8)))
    session.execute.return_value.one.return_value = SimpleNamespace(
        slot_order_limit=10, slot_item_limit=100, holiday_closed=holiday,
        operating_hours_schedule={local.strftime("%A"):hours},
    )
    with pytest.raises(HTTPException, match="closed"):
        marketplace._reserve_fulfilment_capacity(session, _cart(), arrival)



def test_duplicate_checkout_replaces_abandoned_payment(monkeypatch):
    session = Mock()
    payment = SimpleNamespace(order_id=uuid4(), payment_id=uuid4(), stripe_checkout_session_id="cs_abandoned")
    session.execute.return_value.all.return_value = [payment]
    expire = Mock()
    monkeypatch.setattr(marketplace.stripe_payments, "expire_unpaid_checkout", expire)
    marketplace._ensure_no_pending_checkout(session, uuid4())
    expire.assert_called_once_with("cs_abandoned")
    assert session.execute.call_count == 3


def test_checkout_rejects_unaligned_windows():
    with pytest.raises(HTTPException, match="hour or half hour"):
        marketplace._reserve_fulfilment_capacity(Mock(), _cart(), (datetime.now(timezone.utc) + timedelta(days=1)).replace(minute=29))


def test_item_must_remain_valid_through_window_end():
    cart = _cart()
    slot = (datetime.now(timezone.utc) + timedelta(days=1)).replace(minute=0,second=0,microsecond=0)
    cart.items[0].product.expiry_date = slot + timedelta(minutes=10)
    problem = marketplace._slot_problem(cart, slot, cart.items[0].product.store_id,
        SimpleNamespace(slot_order_limit=10,slot_item_limit=100), SimpleNamespace(orders=0,items=0))
    assert "expires" in problem


def test_whole_window_must_fit_store_hours():
    cart = _cart()
    slot = (datetime.now(marketplace.STORE_TIMEZONE) + timedelta(days=1)).replace(hour=12,minute=0,second=0,microsecond=0)
    limits = SimpleNamespace(slot_order_limit=10,slot_item_limit=100,
        operating_hours_schedule={slot.strftime("%A"):{"open":"09:00","close":"12:15"}})
    assert "closed" in marketplace._slot_problem(cart,slot,cart.items[0].product.store_id,limits,SimpleNamespace(orders=0,items=0))


def test_checkout_uses_estimated_travel_lead_time():
    cart = _cart()
    cart.estimated_delivery_minutes = 120
    slot = marketplace._slot_start(datetime.now(timezone.utc) + timedelta(hours=1))
    with pytest.raises(HTTPException, match="travel"):
        marketplace._reserve_fulfilment_capacity(Mock(), cart, slot)



@pytest.mark.parametrize("whole_day", [True, False])
def test_shop_detail_serializes_database_holiday_dates_and_times(whole_day):
    from datetime import date, time
    from app.schemas.marketplace import MarketplaceStoreDetail
    detail = MarketplaceStoreDetail(id=uuid4(),name="Holiday shop",address="Market road",rating=0,review_count=0,promotions=[],products=[],
        holiday_closure={"starts_on":date(2026,11,4),"ends_on":date(2026,11,6),"whole_day":whole_day,
            "opens_at":None if whole_day else time(10,30),"closes_at":None if whole_day else time(16),"reason":"Holiday hours"})
    closure = detail.model_dump(mode="json")["holiday_closure"]
    assert closure["starts_on"] == "2026-11-04"
    assert closure["ends_on"] == "2026-11-06"
    assert closure["opens_at"] == (None if whole_day else "10:30:00")
    assert closure["closes_at"] == (None if whole_day else "16:00:00")


@pytest.mark.parametrize("minute,allowed", [(0, True), (30, False)])
def test_last_half_hour_before_closing_is_not_bookable(minute, allowed):
    cart = _cart()
    slot = (datetime.now(marketplace.STORE_TIMEZONE) + timedelta(days=1)).replace(hour=12, minute=minute, second=0, microsecond=0)
    limits = SimpleNamespace(slot_order_limit=10, slot_item_limit=100,
        operating_hours_schedule={slot.strftime("%A"): {"open": "09:00", "close": "13:00"}})
    problem = marketplace._slot_problem(cart, slot, cart.items[0].product.store_id, limits, SimpleNamespace(orders=0, items=0))
    assert (problem is None) == allowed


@pytest.mark.parametrize("store_id", [None, uuid4()])
def test_marketplace_promotion_preserves_issuer_scope(store_id):
    row=SimpleNamespace(id=uuid4(),store_id=store_id,code="ISSUER20",promo_title="Fresh vegetables",promo_description="Voucher terms",discount_percent=Decimal("20"),discount_amount=None,minimum_order_amount=Decimal("0"),free_delivery=False,start_date=datetime.now(timezone.utc),end_date=datetime.now(timezone.utc)+timedelta(days=1))
    assert marketplace._promotion(row).store_id==store_id


@pytest.mark.parametrize("orders,items,quantity,blocked", [(9,99,1,False),(10,0,1,True),(0,100,1,True),(0,0,100,False),(0,0,101,True)])
def test_slot_limits_use_exact_configured_values(orders,items,quantity,blocked):
    cart=_cart()
    cart.items[0].product.cart_quantity=quantity
    problem=marketplace._slot_problem(cart,datetime.now(timezone.utc)+timedelta(days=1),cart.items[0].product.store_id,SimpleNamespace(slot_order_limit=10,slot_item_limit=100),SimpleNamespace(orders=orders,items=items))
    assert bool(problem)==blocked
