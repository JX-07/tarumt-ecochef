from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict
from math import asin, cos, radians, sin, sqrt
import base64
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.core.config import get_settings
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.marketplace import (
    CartQuantityUpdate,
    CheckoutRequest,
    CheckoutResult,
    CheckoutStatusResult,
    MarketplaceCart,
    MarketplaceCartItem,
    MarketplaceCartStockAdjustment,
    MarketplaceCategoryStore,
    MarketplaceCategoryStoreList,
    MarketplaceProduct,
    MarketplacePromotion,
    MarketplaceReview,
    MarketplaceReviewList,
    MarketplaceProductReviewInput,
    MarketplaceProductReview,
    MarketplaceProductReviewList,
    MarketplaceReviewPrompt,
    MarketplaceReviewPromptList,
    MarketplaceLocation,
    MarketplaceLocationList,
    MarketplaceMapImage,
    MarketplaceStoreDetail,
    MarketplaceStoreList,
    MarketplaceStoreSummary,
    MarketplaceSummary,
    ProductReportInput,
    PromoApplyRequest,
    ShopCartRemoveRequest,
)
from app.services import stripe_payments
from app.services.order_cart import lock_order_cart, consume_order_cart_snapshot

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))
MONEY = Decimal("0.01")
DEFAULT_DELIVERY_FEE = Decimal("2.50")
DELIVERY_INCLUDED_DISTANCE_KM = Decimal("3")
DELIVERY_PRICE_PER_EXTRA_KM = Decimal("0.75")
PRODUCT_CATEGORIES = (
    "Produce",
    "Bakery",
    "Pantry",
    "Prepared Food",
    "Beverages",
    "Dairy",
    "Snacks & Confectionery",
)
PRODUCT_CATEGORY_PARENTS = {
    "fruits": "Produce",
    "vegetables": "Produce",
    "herbs & aromatics": "Produce",
    "mushrooms": "Produce",
    "bread": "Bakery",
    "pastries": "Bakery",
    "cakes": "Bakery",
    "biscuits & cookies": "Snacks & Confectionery",
    "chips & crisps": "Snacks & Confectionery",
    "chocolate & candy": "Snacks & Confectionery",
    "nuts & seeds": "Snacks & Confectionery",
    "milk": "Dairy",
    "cheese": "Dairy",
    "yoghurt": "Dairy",
    "butter & cream": "Dairy",
    "plant-based alternatives": "Dairy",
    "water": "Beverages",
    "waters": "Beverages",
    "carbonated beverages": "Beverages",
    "sports & energy drinks": "Beverages",
    "juices": "Beverages",
    "tea & coffee": "Beverages",
}


@router.get("/shared-vouchers")
def shared_vouchers(
    current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)
) -> dict:
    rows = (
        session.execute(
            text("""
        SELECT pc.id,pc.code,pc.title,pc.description,pc.discount_percent,pc.discount_amount,
          pc.minimum_order_amount,s.store_name,up.reward_message,up.shared_at
        FROM user_promo_codes up JOIN promo_codes pc ON pc.id=up.promo_code_id
        JOIN stores s ON s.id=pc.store_id
        WHERE up.user_id=:user_id AND up.shared_at IS NOT NULL AND up.seen_at IS NULL
          AND pc.status='active' AND now() BETWEEN pc.start_date AND pc.end_date
        ORDER BY up.shared_at
    """),
            {"user_id": current_user.id},
        )
        .mappings()
        .all()
    )
    return {"vouchers": [dict(row) for row in rows]}


@router.post("/shared-vouchers/{promotion_id}/seen", status_code=status.HTTP_204_NO_CONTENT)
def mark_shared_voucher_seen(
    promotion_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    session.execute(
        text(
            "UPDATE user_promo_codes SET seen_at=now() WHERE user_id=:user_id AND promo_code_id=:promotion_id"
        ),
        {"user_id": current_user.id, "promotion_id": promotion_id},
    )
    session.commit()


@router.put("/stores/{store_id}/favourite", status_code=status.HTTP_204_NO_CONTENT)
def favourite_store(
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    if not session.execute(
        text("SELECT 1 FROM stores WHERE id=:store_id AND status='approved'"),
        {"store_id": store_id},
    ).first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found.")
    session.execute(
        text(
            "INSERT INTO store_favourites (store_id,user_id) VALUES (:store_id,:user_id) ON CONFLICT DO NOTHING"
        ),
        {"store_id": store_id, "user_id": current_user.id},
    )
    session.commit()


@router.delete("/stores/{store_id}/favourite", status_code=status.HTTP_204_NO_CONTENT)
def unfavourite_store(
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    session.execute(
        text("DELETE FROM store_favourites WHERE store_id=:store_id AND user_id=:user_id"),
        {"store_id": store_id, "user_id": current_user.id},
    )
    session.commit()


def _sandbox_payment_simulation_enabled() -> bool:
    settings = get_settings()
    if not settings.stripe_simulated_payments_enabled:
        return False
    if settings.stripe_api_key is None:
        return False
    return settings.stripe_api_key.get_secret_value().startswith(("sk_test_", "rk_test_"))


def _product_category(value: object) -> str:
    category = str(value or "Other").strip() or "Other"
    return PRODUCT_CATEGORY_PARENTS.get(category.casefold(), category)


def _geoapify_location(feature: dict) -> MarketplaceLocation | None:
    properties = feature.get("properties") or {}
    coordinates = (feature.get("geometry") or {}).get("coordinates") or []
    latitude = properties.get("lat", coordinates[1] if len(coordinates) > 1 else None)
    longitude = properties.get("lon", coordinates[0] if coordinates else None)
    house_number = str(properties.get("housenumber") or "").strip()
    street = str(properties.get("street") or "").strip()
    street_address = ", ".join(part for part in (house_number, street) if part)
    address_line_1 = (
        street_address or properties.get("address_line1") or properties.get("formatted")
    )
    if latitude is None or longitude is None or not address_line_1:
        return None
    postcode = str(properties.get("postcode") or "")
    city = properties.get("city") or properties.get("suburb") or properties.get("county") or ""
    # Geoapify uses the expanded municipal boundary name "George Town" for
    # many south-west Penang Island addresses. Malaysian 119xx postal
    # addresses use Bayan Lepas as their delivery locality.
    if str(city).casefold() == "george town" and postcode.startswith("119"):
        city = "Bayan Lepas"
    neighbourhood = str(properties.get("district") or properties.get("suburb") or "").strip()
    if (
        neighbourhood
        and neighbourhood.casefold() not in str(address_line_1).casefold()
        and neighbourhood.casefold() != str(city).casefold()
    ):
        address_line_1 = f"{address_line_1}, {neighbourhood}"
    return MarketplaceLocation(
        name=properties.get("name"),
        address_line_1=address_line_1,
        city=city,
        state=properties.get("state") or "",
        postal_code=postcode,
        latitude=float(latitude),
        longitude=float(longitude),
    )


def _reverse_location(features: list[dict]) -> MarketplaceLocation | None:
    valid_features = [feature for feature in features if _geoapify_location(feature) is not None]
    if not valid_features:
        return None
    nearest = min(
        valid_features,
        key=lambda feature: float(
            (feature.get("properties") or {}).get("distance") or float("inf")
        ),
    )
    location = _geoapify_location(nearest)
    assert location is not None
    nearest_properties = nearest.get("properties") or {}
    landmark_name = str(
        nearest_properties.get("name") or nearest_properties.get("address_line1") or ""
    ).casefold()

    # Geoapify currently has duplicate Zan Pavilion records with conflicting
    # administrative cities. Use the local Bayan Lepas record and the verified
    # delivery postcode instead of its broad George Town/11920 record.
    if landmark_name in {"zan pavilion", "zan pavillon"}:
        local_match = next(
            (
                feature
                for feature in valid_features
                if str((feature.get("properties") or {}).get("city") or "").casefold()
                == "bayan lepas"
                and float((feature.get("properties") or {}).get("distance") or float("inf")) <= 100
            ),
            None,
        )
        if local_match:
            location = location.model_copy(update={"city": "Bayan Lepas"})
        location = location.model_copy(
            update={
                "name": "Zan Pavillon",
                "address_line_1": "Zan Pavillon",
                "postal_code": "11900",
            }
        )
    return _normalise_known_delivery_location(location)


def _normalise_known_delivery_location(location: MarketplaceLocation) -> MarketplaceLocation:
    landmark_name = str(location.name or location.address_line_1).casefold()
    if landmark_name in {"zan pavilion", "zan pavillon"}:
        return location.model_copy(
            update={
                "name": "Zan Pavillon",
                "address_line_1": "Zan Pavillon",
                "city": "Bayan Lepas",
                "postal_code": "11900",
            }
        )
    return location


def _landmark_key(feature: dict) -> str:
    properties = feature.get("properties") or {}
    identity = str(
        properties.get("name") or properties.get("street") or properties.get("address_line1") or ""
    )
    identity = re.sub(r"\b(?:condominium\s+)?clubhouse\b", "", identity, flags=re.IGNORECASE)
    identity = re.sub(r"\bcondominium\b", "", identity, flags=re.IGNORECASE)
    return " ".join(identity.casefold().split())


def _consolidate_autocomplete(features: list[dict]) -> list[MarketplaceLocation]:
    groups: dict[str, list[dict]] = {}
    for feature in features:
        key = _landmark_key(feature)
        if key:
            groups.setdefault(key, []).append(feature)

    results: list[MarketplaceLocation] = []
    for key, group in groups.items():
        valid = [(feature, _geoapify_location(feature)) for feature in group]
        valid = [(feature, location) for feature, location in valid if location is not None]
        if not valid:
            continue
        best_feature, best_location = max(
            valid,
            key=lambda pair: (
                bool((pair[0].get("properties") or {}).get("street"))
                and str((pair[0].get("properties") or {}).get("street")).casefold() != key,
                bool(pair[1].postal_code),
                bool(pair[1].city),
            ),
        )
        names = [
            str((feature.get("properties") or {}).get("name") or "").strip() for feature, _ in valid
        ]
        clean_names = [
            name for name in names if _landmark_key({"properties": {"name": name}}) == key
        ]
        display_name = min(clean_names, key=len) if clean_names else best_location.name
        results.append(
            _normalise_known_delivery_location(
                best_location.model_copy(update={"name": display_name or None})
            )
        )
    return results


def _geoapify(path: str, params: dict[str, object]) -> dict:
    api_key = get_settings().geoapify_api_key
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Location search is not configured.",
        )
    url = f"https://api.geoapify.com/v1/geocode/{path}?{urlencode({**params, 'apiKey': api_key})}"
    try:
        with urlopen(url, timeout=6) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The location service is temporarily unavailable.",
        ) from error


@router.get("/locations/autocomplete", response_model=MarketplaceLocationList)
def autocomplete_location(
    query: str = Query(min_length=3, max_length=120),
    latitude: float | None = None,
    longitude: float | None = None,
    current_user: AuthenticatedUser = CurrentConsumer,
) -> MarketplaceLocationList:
    params: dict[str, object] = {
        "text": query,
        "format": "geojson",
        "limit": 5,
        "lang": "en",
        "filter": "countrycode:my",
    }
    if latitude is not None and longitude is not None:
        params["bias"] = f"proximity:{longitude},{latitude}"
    payload = _geoapify("autocomplete", params)
    locations = _consolidate_autocomplete(payload.get("features", []))
    return MarketplaceLocationList(locations=locations)


@router.get("/locations/reverse", response_model=MarketplaceLocation)
def reverse_location(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    current_user: AuthenticatedUser = CurrentConsumer,
) -> MarketplaceLocation:
    payload = _geoapify(
        "reverse",
        {"lat": latitude, "lon": longitude, "format": "geojson", "limit": 10, "lang": "en"},
    )
    location = _reverse_location(payload.get("features", []))
    if location is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No verified address was found for this location.",
        )
    return location.model_copy(update={"latitude": latitude, "longitude": longitude})


@router.get("/locations/nearby", response_model=MarketplaceLocationList)
def nearby_locations(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    current_user: AuthenticatedUser = CurrentConsumer,
) -> MarketplaceLocationList:
    payload = _geoapify(
        "reverse",
        {"lat": latitude, "lon": longitude, "format": "geojson", "limit": 5, "lang": "en"},
    )
    features = sorted(
        payload.get("features", []),
        key=lambda feature: float(
            (feature.get("properties") or {}).get("distance") or float("inf")
        ),
    )
    locations = [
        _normalise_known_delivery_location(item)
        for feature in features
        if (item := _geoapify_location(feature)) is not None
    ]
    unique_locations: dict[str, MarketplaceLocation] = {}
    for location in locations:
        key = str(location.name or location.address_line_1).casefold()
        unique_locations.setdefault(key, location)
    return MarketplaceLocationList(locations=list(unique_locations.values()))


@router.get("/locations/map", response_model=MarketplaceMapImage)
def location_map(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    current_user: AuthenticatedUser = CurrentConsumer,
) -> MarketplaceMapImage:
    api_key = get_settings().geoapify_api_key
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Location maps are not configured.",
        )
    params = urlencode(
        {
            "style": "osm-bright",
            "width": 3000,
            "height": 3000,
            "format": "jpeg",
            "center": f"lonlat:{longitude},{latitude}",
            "zoom": 17,
            "attribution": "default",
            "lang": "en",
            "apiKey": api_key,
        }
    )
    try:
        with urlopen(f"https://maps.geoapify.com/v1/staticmap?{params}", timeout=15) as response:
            encoded = base64.b64encode(response.read()).decode("ascii")
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The location map is temporarily unavailable.",
        ) from error
    return MarketplaceMapImage(data_uri=f"data:image/jpeg;base64,{encoded}")


def _money(value: Decimal | int | float | None) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _distance_km(a_lat: object, a_lon: object, b_lat: object, b_lon: object) -> float | None:
    if None in (a_lat, a_lon, b_lat, b_lon):
        return None
    lat1, lon1, lat2, lon2 = map(lambda value: radians(float(value)), (a_lat, a_lon, b_lat, b_lon))
    delta_lat, delta_lon = lat2 - lat1, lon2 - lon1
    value = sin(delta_lat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(delta_lon / 2) ** 2
    return round(6371 * 2 * asin(sqrt(value)), 1)


def _estimated_delivery_minutes(
    configured_minutes: object, distance_km: float | None
) -> int | None:
    """Use the seller estimate as a floor and account for longer delivery journeys."""
    configured = int(configured_minutes) if configured_minutes is not None else None
    if distance_km is None:
        return configured
    travel_aware = 10 + round(distance_km * 3)
    return max(configured or 20, travel_aware)


def _distance_delivery_fee(base_fee: object, distance_km: float | None) -> Decimal:
    """Include the first 3 km in the store fee, then charge RM0.75 per extra km."""
    base = _money(base_fee)
    if base <= 0:
        base = DEFAULT_DELIVERY_FEE
    if distance_km is None:
        return base
    extra_distance = max(Decimal("0"), Decimal(str(distance_km)) - DELIVERY_INCLUDED_DISTANCE_KM)
    return _money(base + extra_distance * DELIVERY_PRICE_PER_EXTRA_KM)


def _promotion(row: object | None) -> MarketplacePromotion | None:
    if row is None or row.id is None:
        return None
    return MarketplacePromotion(
        id=row.id,
        store_id=getattr(row, "store_id", None),
        code=row.code,
        title=row.promo_title,
        description=row.promo_description,
        discount_percent=row.discount_percent,
        discount_amount=row.discount_amount,
        minimum_order_amount=row.minimum_order_amount,
        free_delivery=row.free_delivery,
        start_date=row.start_date,
        end_date=row.end_date,
    )


def _active_cart_id(session: Session, user_id: UUID, create: bool = True) -> UUID | None:
    cart_id = session.execute(
        text("""
        SELECT (
            SELECT c.id FROM carts c
            WHERE c.user_id = :user_id AND (EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id=c.id) OR NOT EXISTS (
                SELECT 1 FROM orders o
                JOIN payments p ON p.order_id = o.id
                WHERE o.cart_id = c.id AND p.payment_status = 'paid'
            ))
            ORDER BY c.id LIMIT 1
        )
        FROM (SELECT pg_advisory_xact_lock(hashtextextended(CAST(:user_id AS text), 0))) locked
    """),
        {"user_id": user_id},
    ).scalar_one_or_none()
    if cart_id is None and create:
        cart_id = session.execute(
            text("INSERT INTO carts (user_id) VALUES (:user_id) RETURNING id"),
            {"user_id": user_id},
        ).scalar_one()
        session.commit()
    return cart_id


def _promo_for_cart(session: Session, cart_id: UUID) -> object | None:
    return session.execute(
        text("""
        SELECT p.id, p.code, p.title AS promo_title, p.description AS promo_description,
               p.discount_percent, p.discount_amount, p.minimum_order_amount,
               p.free_delivery, p.start_date, p.end_date, p.store_id, p.product_id, p.product_category
        FROM carts c JOIN promo_codes p ON p.id = c.promo_code_id
        WHERE c.id = :cart_id AND p.status = 'active' AND now() BETWEEN p.start_date AND p.end_date
          AND (p.audience = 'available'
            OR (p.audience = 'new_account' AND EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id AND u.date_joined >= now() - interval '30 days'))
            OR (p.audience = 'gift' AND EXISTS (SELECT 1 FROM user_promo_codes up WHERE up.user_id = c.user_id AND up.promo_code_id = p.id AND up.redeemed_at IS NULL)))
    """),
        {"cart_id": cart_id},
    ).one_or_none()


def _store_closed_today_sql(alias: str) -> str:
    # Every browsing/cart/payment check uses the same Malaysia opening hours.
    local = "now() AT TIME ZONE 'Asia/Kuala_Lumpur'"
    hours = f"COALESCE({alias}.operating_hours_schedule -> to_char({local}, 'FMDay'), {alias}.operating_hours_schedule -> lower(to_char({local}, 'FMDay')))"
    return f"""(
        COALESCE(({hours} ->> 'closed')::boolean, false)
        OR (COALESCE({alias}.operating_hours_schedule, '{{}}'::jsonb) <> '{{}}'::jsonb AND {hours} IS NULL)
        OR ({hours} IS NOT NULL AND (
            ({local})::time < COALESCE(({hours} ->> 'open')::time, '00:00'::time)
            OR ({local})::time >= COALESCE(({hours} ->> 'close')::time, '00:00'::time)))
        OR EXISTS (SELECT 1 FROM store_holiday_closures closure
                   WHERE closure.store_id={alias}.id
                     AND ({local})::date BETWEEN closure.starts_on AND closure.ends_on
                     AND (closure.whole_day OR ({local})::time < closure.opens_at OR ({local})::time >= closure.closes_at))
    )"""


def _cart_rows(session: Session, cart_id: UUID, lock: bool = False) -> list[object]:
    suffix = " FOR UPDATE OF product" if lock else ""
    return session.execute(
        text(
            f"""
        SELECT ci.product_id, ci.quantity, product.product_name, product.description,
               product.image_url, product.category, product.subcategory, product.unit_label,
               product.brand, product.size_label, product.price,
               product.original_price, product.expiry_date, product.stock_quantity,
               product.addons, product.discount, product.status AS product_status, store.id AS store_id,
               store.store_name, store.status AS store_status, store.delivery_fee,
               store.latitude AS store_latitude, store.longitude AS store_longitude,
               store.estimated_delivery_minutes,
               {_store_closed_today_sql("store")} AS store_closed_today
        FROM cart_items ci JOIN products product ON product.id = ci.product_id
        JOIN stores store ON store.id = product.store_id
        WHERE ci.cart_id = :cart_id ORDER BY store.store_name, product.product_name
    """
            + suffix
        ),
        {"cart_id": cart_id},
    ).all()


def _active_direct_discount(row: object) -> dict | None:
    discount = getattr(row, "discount", None)
    if not isinstance(discount, dict):
        return None
    try:
        start = datetime.fromisoformat(str(discount["starts_at"]).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(discount["ends_at"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None
    now = datetime.now(timezone.utc)
    return discount if start <= now <= end else None


def _direct_unit_price(row: object) -> Decimal:
    price = _money(row.price)
    discount = _active_direct_discount(row)
    if not discount:
        return price
    if discount.get("type") == "percentage":
        return _money(
            price * (Decimal("1") - Decimal(str(discount.get("value", 0))) / Decimal("100"))
        )
    if discount.get("type") == "fixed_amount":
        return _money(max(Decimal("0"), price - Decimal(str(discount.get("value", 0)))))
    return price


def _direct_line_total(row: object) -> Decimal:
    unit_price = _direct_unit_price(row)
    discount = _active_direct_discount(row)
    if discount and discount.get("type") == "buy_x_get_y":
        buy, gift = int(discount.get("buy_quantity", 0)), int(discount.get("gift_quantity", 0))
        group = buy + gift
        if buy > 0 and gift > 0 and group > 0:
            paid_quantity = row.quantity - (row.quantity // group) * gift
            return _money(unit_price * paid_quantity)
    return _money(unit_price * row.quantity)


def _product(row: object, cart_quantity: int = 0) -> MarketplaceProduct:
    base_price = _money(row.price)
    direct = _active_direct_discount(row)
    price = _direct_unit_price(row)
    original = (
        base_price
        if direct and price < base_price
        else (_money(row.original_price) if row.original_price is not None else None)
    )
    discount = (
        int(((original - price) / original * 100).quantize(Decimal("1")))
        if original and original > price
        else 0
    )
    return MarketplaceProduct(
        id=row.product_id if hasattr(row, "product_id") else row.id,
        store_id=row.store_id,
        name=row.product_name,
        description=row.description,
        image_url=row.image_url,
        category=row.category,
        subcategory=row.subcategory,
        unit_label=row.unit_label,
        brand=getattr(row, "brand", None),
        size=getattr(row, "size_label", None),
        price=price,
        original_price=original,
        discount_percent=discount,
        expiry_date=row.expiry_date,
        stock_quantity=row.stock_quantity,
        cart_quantity=cart_quantity,
        addons=row.addons or [],
        store_closed_today=bool(getattr(row, "store_closed_today", False)),
    )


def _cart_response(
    session: Session,
    user_id: UUID,
    lock: bool = False,
    delivery_latitude: object = None,
    delivery_longitude: object = None,
    store_id: UUID | None = None,
) -> MarketplaceCart:
    cart_id = _active_cart_id(session, user_id)
    assert cart_id is not None
    rows = _cart_rows(session, cart_id, lock)
    if store_id is not None:
        rows = [row for row in rows if row.store_id == store_id]
    stock_adjustments: list[MarketplaceCartStockAdjustment] = []
    if lock:
        for row in rows:
            if getattr(row, "store_closed_today", False):
                raise HTTPException(
                    409,
                    "This shop is closed today. Remove its items from your cart before checking out.",
                )
            if row.store_status != "approved" or row.product_status != "active":
                raise HTTPException(
                    status.HTTP_409_CONFLICT, f"{row.product_name} is no longer available."
                )
            if row.expiry_date is not None and row.expiry_date <= datetime.now(timezone.utc):
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"{row.product_name} has expired and cannot be ordered.",
                )
            if row.quantity > row.stock_quantity:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, f"{row.product_name} no longer has enough stock."
                )
    else:
        for row in rows:
            if row.quantity <= row.stock_quantity:
                continue
            adjusted_quantity = max(0, row.stock_quantity)
            stock_adjustments.append(
                MarketplaceCartStockAdjustment(
                    product_id=row.product_id,
                    product_name=row.product_name,
                    previous_quantity=row.quantity,
                    adjusted_quantity=adjusted_quantity,
                )
            )
            if adjusted_quantity:
                session.execute(
                    text("""
                    UPDATE cart_items SET quantity = :quantity
                    WHERE cart_id = :cart_id AND product_id = :product_id
                """),
                    {
                        "quantity": adjusted_quantity,
                        "cart_id": cart_id,
                        "product_id": row.product_id,
                    },
                )
            else:
                session.execute(
                    text("""
                    DELETE FROM cart_items
                    WHERE cart_id = :cart_id AND product_id = :product_id
                """),
                    {"cart_id": cart_id, "product_id": row.product_id},
                )
        if stock_adjustments:
            rows = _cart_rows(session, cart_id, lock=False)
            if store_id is not None:
                rows = [row for row in rows if row.store_id == store_id]
    subtotal = sum((_direct_line_total(row) for row in rows), Decimal("0"))
    store_distances = {
        row.store_id: _distance_km(
            delivery_latitude,
            delivery_longitude,
            getattr(row, "store_latitude", None),
            getattr(row, "store_longitude", None),
        )
        for row in rows
    }
    store_fees = {
        row.store_id: _distance_delivery_fee(row.delivery_fee, store_distances[row.store_id])
        for row in rows
    }
    delivery = sum(store_fees.values(), Decimal("0"))
    promo_row = _promo_for_cart(session, cart_id)
    discount = Decimal("0")
    if promo_row:
        eligible = [
            row
            for row in rows
            if (promo_row.store_id is None or row.store_id == promo_row.store_id)
            and (promo_row.product_id is None or row.product_id == promo_row.product_id)
            and (promo_row.product_category is None or row.category == promo_row.product_category)
        ]
        eligible_total = sum((_direct_line_total(row) for row in eligible), Decimal("0"))
        if eligible_total >= _money(promo_row.minimum_order_amount):
            if promo_row.discount_percent:
                discount = eligible_total * Decimal(promo_row.discount_percent) / Decimal("100")
            elif promo_row.discount_amount:
                discount = min(eligible_total, _money(promo_row.discount_amount))
            if promo_row.free_delivery:
                delivery = (
                    Decimal("0")
                    if promo_row.store_id is None
                    else delivery - store_fees.get(promo_row.store_id, Decimal("0"))
                )
        else:
            promo_row = None
    discount = _money(discount)
    items = [
        MarketplaceCartItem(
            product=_product(row, row.quantity),
            store_name=row.store_name,
            line_total=_direct_line_total(row),
        )
        for row in rows
    ]
    return MarketplaceCart(
        id=cart_id,
        items=items,
        item_count=sum(row.quantity for row in rows),
        subtotal=_money(subtotal),
        delivery_fee=_money(delivery),
        discount=discount,
        total=_money(subtotal + delivery - discount),
        applied_promo=_promotion(promo_row),
        stock_adjustments=stock_adjustments,
        checkout_blocked_reason="A shop in your cart is closed today. Remove its items before checking out."
        if any(getattr(row, "store_closed_today", False) for row in rows)
        else None,
        estimated_delivery_minutes=max(
            (
                estimate
                for row in rows
                if (
                    estimate := _estimated_delivery_minutes(
                        getattr(row, "estimated_delivery_minutes", None),
                        store_distances[row.store_id],
                    )
                )
                is not None
            ),
            default=None,
        ),
        estimated_delivery_distance_km=max(
            (distance for distance in store_distances.values() if distance is not None),
            default=None,
        ),
    )


def _address_coordinates(
    session: Session, user_id: UUID, address_id: UUID | None
) -> tuple[object, object]:
    if address_id is None:
        return None, None
    row = session.execute(
        text("SELECT latitude, longitude FROM addresses WHERE id = :id AND user_id = :user_id"),
        {"id": address_id, "user_id": user_id},
    ).one_or_none()
    return (row.latitude, row.longitude) if row else (None, None)


@router.get("/summary", response_model=MarketplaceSummary)
def marketplace_summary(
    current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)
) -> MarketplaceSummary:
    row = session.execute(
        text("""
        SELECT COUNT(*) FILTER (WHERE p.original_price > p.price) AS deals,
               COALESCE(AVG((p.original_price - p.price) / NULLIF(p.original_price, 0) * 100)
                 FILTER (WHERE p.original_price > p.price), 0) AS savings
        FROM products p JOIN stores s ON s.id = p.store_id
        WHERE s.status = 'approved' AND p.status = 'active' AND p.stock_quantity > 0
          AND (p.expiry_date IS NULL OR p.expiry_date > now())
    """)
    ).one()
    cart = _cart_response(session, current_user.id)
    return MarketplaceSummary(
        deals_active=row.deals,
        average_savings_percent=round(row.savings),
        cart_item_count=cart.item_count,
    )


@router.get("/stores", response_model=MarketplaceStoreList)
def marketplace_stores(
    search: str = Query(default="", max_length=100),
    address_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceStoreList:
    search_term = f"%{search.strip()}%"
    rows = session.execute(
        text(f"""
        SELECT s.id, s.store_name, s.description, s.category, s.cover_image_url, s.icon_url,
               s.store_address, s.latitude, s.longitude, s.delivery_fee, s.estimated_delivery_minutes,
               {_store_closed_today_sql("s")} AS store_closed_today,
               COALESCE(AVG(r.rating), 0) AS rating, COUNT(r.id) AS review_count
        FROM stores s LEFT JOIN product_reviews r ON r.store_id = s.id AND r.removed_at IS NULL
        WHERE s.status = 'approved'
          AND EXISTS (SELECT 1 FROM products available WHERE available.store_id = s.id
            AND available.status = 'active' AND available.stock_quantity > 0
            AND (available.expiry_date IS NULL OR available.expiry_date > now()))
          AND (
          :search = '' OR s.store_name ILIKE :term OR COALESCE(s.category, '') ILIKE :term OR
          EXISTS (SELECT 1 FROM products p WHERE p.store_id = s.id AND p.status = 'active'
            AND p.stock_quantity > 0 AND (p.expiry_date IS NULL OR p.expiry_date > now())
            AND (p.product_name ILIKE :term OR COALESCE(p.category, '') ILIKE :term
              OR COALESCE(p.subcategory, '') ILIKE :term)))
        GROUP BY s.id ORDER BY EXISTS (
          SELECT 1 FROM store_holiday_closures holiday
          WHERE holiday.store_id=s.id AND current_date BETWEEN holiday.starts_on AND holiday.ends_on
        ), s.store_name
    """),
        {"search": search.strip(), "term": search_term},
    ).all()
    address_lat, address_lon = (
        (latitude, longitude)
        if latitude is not None and longitude is not None
        else _address_coordinates(session, current_user.id, address_id)
    )
    stores = []
    for row in rows:
        promo = session.execute(
            text("""
            SELECT id, store_id, code, title AS promo_title, description AS promo_description,
                   discount_percent, discount_amount, minimum_order_amount, free_delivery, start_date, end_date
            FROM promo_codes WHERE status = 'active' AND audience = 'available' AND now() BETWEEN start_date AND end_date
              AND (store_id IS NULL OR store_id = :store_id)
            ORDER BY discount_percent DESC NULLS LAST, discount_amount DESC NULLS LAST LIMIT 1
        """),
            {"store_id": row.id},
        ).one_or_none()
        distance = _distance_km(address_lat, address_lon, row.latitude, row.longitude)
        stores.append(
            MarketplaceStoreSummary(
                id=row.id,
                name=row.store_name,
                description=row.description,
                category=row.category,
                store_closed_today=row.store_closed_today,
                cover_image_url=row.cover_image_url,
                icon_url=row.icon_url,
                address=row.store_address,
                rating=_money(row.rating),
                review_count=row.review_count,
                distance_km=distance,
                estimated_delivery_minutes=_estimated_delivery_minutes(
                    row.estimated_delivery_minutes, distance
                ),
                best_promotion=_promotion(promo),
                delivery_fee=_money(row.delivery_fee),
            )
        )
    return MarketplaceStoreList(stores=stores, total=len(stores))


@router.get("/product-categories/{category}", response_model=MarketplaceCategoryStoreList)
def marketplace_product_category(
    category: str,
    address_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceCategoryStoreList:
    if category != "All" and category not in PRODUCT_CATEGORIES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product category not found.")
    cart_id = _active_cart_id(session, current_user.id)
    rows = session.execute(
        text(f"""
        SELECT p.id AS product_id, p.store_id, p.product_name, p.description, p.image_url,
               p.category, p.subcategory, p.unit_label, p.brand, p.size_label, p.price, p.original_price,
               p.expiry_date, p.stock_quantity, p.addons, p.discount,
               s.store_name, s.description AS store_description, s.category AS store_category,
               s.cover_image_url, s.icon_url, s.store_address, s.latitude, s.longitude,
               s.delivery_fee, s.estimated_delivery_minutes,
               {_store_closed_today_sql("s")} AS store_closed_today,
               (SELECT COALESCE(AVG(r.rating), 0) FROM product_reviews r WHERE r.store_id = s.id AND r.removed_at IS NULL) AS rating,
               (SELECT COUNT(*) FROM product_reviews r WHERE r.store_id = s.id AND r.removed_at IS NULL) AS review_count,
               (SELECT COALESCE(SUM(ordered.quantity), 0) FROM cart_items ordered
                  JOIN orders o ON o.cart_id = ordered.cart_id WHERE ordered.product_id = p.id) AS sold,
               COALESCE((SELECT current_item.quantity FROM cart_items current_item
                 WHERE current_item.cart_id = :cart_id AND current_item.product_id = p.id), 0) AS cart_quantity,
               (SELECT COUNT(*) FROM promo_codes promo WHERE promo.status = 'active'
                 AND promo.audience = 'available' AND now() BETWEEN promo.start_date AND promo.end_date
                 AND (promo.store_id IS NULL OR promo.store_id = s.id)) AS promotion_count
        FROM products p JOIN stores s ON s.id = p.store_id
        WHERE s.status = 'approved' AND p.status = 'active' AND p.stock_quantity > 0
          AND (p.expiry_date IS NULL OR p.expiry_date > now())
        ORDER BY s.store_name, p.product_name
    """),
        {"cart_id": cart_id},
    ).all()
    address_lat, address_lon = (
        (latitude, longitude)
        if latitude is not None and longitude is not None
        else _address_coordinates(session, current_user.id, address_id)
    )
    grouped: dict[UUID, dict[str, object]] = {}
    for row in rows:
        if category != "All" and _product_category(row.category) != category:
            continue
        product = _product(row, row.cart_quantity)
        if row.store_id not in grouped:
            distance = _distance_km(address_lat, address_lon, row.latitude, row.longitude)
            grouped[row.store_id] = {
                "summary": MarketplaceStoreSummary(
                    id=row.store_id,
                    name=row.store_name,
                    description=row.store_description,
                    store_closed_today=row.store_closed_today,
                    category=row.store_category,
                    cover_image_url=row.cover_image_url,
                    icon_url=row.icon_url,
                    address=row.store_address,
                    rating=_money(row.rating),
                    review_count=row.review_count,
                    distance_km=distance,
                    estimated_delivery_minutes=_estimated_delivery_minutes(
                        row.estimated_delivery_minutes, distance
                    ),
                    delivery_fee=_money(row.delivery_fee),
                ),
                "products": [],
                "popularity": 0,
                "offer_count": int(row.promotion_count or 0),
            }
        group = grouped[row.store_id]
        group["products"].append(product)
        group["popularity"] = int(group["popularity"]) + int(row.sold or 0)
        if product.discount_percent > 0:
            group["offer_count"] = int(group["offer_count"]) + 1
    category_stores = [
        MarketplaceCategoryStore(
            **group["summary"].model_dump(),
            products=group["products"],
            popularity=group["popularity"],
            offer_count=group["offer_count"],
        )
        for group in grouped.values()
    ]
    return MarketplaceCategoryStoreList(
        category=category, stores=category_stores, total=len(category_stores)
    )


@router.get("/stores/{store_id}", response_model=MarketplaceStoreDetail)
def marketplace_store(
    store_id: UUID,
    address_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceStoreDetail:
    row = session.execute(
        text(f"""
        SELECT s.*, {_store_closed_today_sql("s")} AS store_closed_today, COALESCE(AVG(r.rating), 0) AS rating, COUNT(r.id) AS review_count
        FROM stores s LEFT JOIN product_reviews r ON r.store_id = s.id AND r.removed_at IS NULL
        WHERE s.id = :id AND s.status = 'approved' GROUP BY s.id
    """),
        {"id": store_id},
    ).one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found or unavailable.")
    promotions = session.execute(
        text("""
        SELECT id, store_id, code, title AS promo_title, description AS promo_description,
               discount_percent, discount_amount, minimum_order_amount, free_delivery, start_date, end_date
        FROM promo_codes WHERE status = 'active' AND audience = 'available' AND now() BETWEEN start_date AND end_date
          AND (store_id IS NULL OR store_id = :store_id) ORDER BY end_date
    """),
        {"store_id": store_id},
    ).all()
    cart_id = _active_cart_id(session, current_user.id)
    products = session.execute(
        text(f"""
        SELECT p.*, {_store_closed_today_sql("store")} AS store_closed_today, COALESCE(ci.quantity, 0) AS cart_quantity
        FROM products p JOIN stores store ON store.id=p.store_id LEFT JOIN cart_items ci ON ci.product_id = p.id AND ci.cart_id = :cart_id
        WHERE p.store_id = :store_id AND p.status = 'active'
          AND p.stock_quantity > 0 AND (p.expiry_date IS NULL OR p.expiry_date > now()) ORDER BY p.product_name
    """),
        {"cart_id": cart_id, "store_id": store_id},
    ).all()
    holiday = (
        session.execute(
            text("""
        SELECT starts_on,ends_on,whole_day,opens_at,closes_at,reason
        FROM store_holiday_closures
        WHERE store_id=:store_id AND current_date BETWEEN starts_on AND ends_on
        ORDER BY starts_on LIMIT 1
    """),
            {"store_id": store_id},
        )
        .mappings()
        .one_or_none()
    )
    is_favourite = session.execute(
        text(
            "SELECT EXISTS(SELECT 1 FROM store_favourites WHERE store_id=:store_id AND user_id=:user_id)"
        ),
        {"store_id": store_id, "user_id": current_user.id},
    ).scalar_one()
    address_lat, address_lon = (
        (latitude, longitude)
        if latitude is not None and longitude is not None
        else _address_coordinates(session, current_user.id, address_id)
    )
    distance = _distance_km(address_lat, address_lon, row.latitude, row.longitude)
    return MarketplaceStoreDetail(
        id=row.id,
        name=row.store_name,
        description=row.description,
        category=row.category,
        cover_image_url=row.cover_image_url,
        icon_url=row.icon_url,
        address=row.store_address,
        phone_number=row.phone_number,
        operating_hours=row.operating_hours,
        rating=_money(row.rating),
        review_count=row.review_count,
        operating_hours_schedule=row.operating_hours_schedule or {},
        latitude=row.latitude,
        longitude=row.longitude,
        holiday_closure=dict(holiday) if holiday else None,
        is_favourite=is_favourite,
        closed_today=row.store_closed_today,
        delivery_fee=_money(row.delivery_fee),
        distance_km=distance,
        estimated_delivery_minutes=_estimated_delivery_minutes(
            row.estimated_delivery_minutes, distance
        ),
        estimated_pickup_minutes=max(30, int(row.estimated_delivery_minutes or 30)),
        promotions=[_promotion(promo) for promo in promotions if promo],
        products=[_product(product, product.cart_quantity) for product in products],
    )


@router.get("/stores/{store_id}/reviews", response_model=MarketplaceReviewList)
def marketplace_reviews(
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceReviewList:
    exists = session.execute(
        text("SELECT 1 FROM stores WHERE id = :id AND status = 'approved'"), {"id": store_id}
    ).first()
    if not exists:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found or unavailable.")
    rows = (
        session.execute(
            text("""
        SELECT r.id, r.product_id, product.product_name, r.user_id, u.name AS user_name, r.rating, r.comment, r.date_submitted
        FROM product_reviews r JOIN users u ON u.id = r.user_id
        JOIN products product ON product.id = r.product_id
        WHERE r.store_id = :store_id AND r.removed_at IS NULL ORDER BY r.date_submitted DESC
    """),
            {"store_id": store_id},
        )
        .mappings()
        .all()
    )
    reviews = [MarketplaceReview(**row) for row in rows]
    return MarketplaceReviewList(reviews=reviews, total=len(reviews))


def _completed_product_purchase(
    session: Session, user_id: UUID, product_id: UUID, *, lock: bool = False
) -> object | None:
    # The product ID comes from the immutable purchased snapshot, never from a
    # client-provided store ID. A different product in the same shop is ineligible.
    return session.execute(
        text(
            """
        SELECT o.id AS order_id, item.store_id, item.product_name
        FROM orders o JOIN carts cart ON cart.id = o.cart_id
        JOIN order_items item ON item.order_id = o.id
        JOIN payments payment ON payment.order_id = o.id
        WHERE cart.user_id = :user_id AND item.product_id = :product_id
          AND o.order_status = 'completed' AND payment.payment_status = 'paid'
          AND payment.inventory_deducted_at IS NOT NULL
        ORDER BY o.order_date DESC LIMIT 1
    """
            + (" FOR UPDATE OF o, payment" if lock else "")
        ),
        {
            "user_id": user_id,
            "product_id": product_id,
        },
    ).one_or_none()


def _product_review_state(
    session: Session, product_id: UUID, user_id: UUID, lock: bool = False
) -> object | None:
    return session.execute(
        text(
            """SELECT r.removed_at,flag.status,flag.resolution_note FROM product_reviews r
        LEFT JOIN product_feedback_flags flag ON flag.feedback_id=r.id
        WHERE r.product_id=:id AND r.user_id=:user"""
            + (" FOR UPDATE OF r" if lock else "")
        ),
        {"id": product_id, "user": user_id},
    ).one_or_none()


def _product_reviews(
    session: Session, product_id: UUID, user_id: UUID
) -> MarketplaceProductReviewList:
    if not session.execute(text("SELECT 1 FROM products WHERE id=:id"), {"id": product_id}).first():
        raise HTTPException(404, "Product not found.")
    rows = (
        session.execute(
            text("""
        SELECT r.id, r.product_id, product.product_name, r.store_id, r.user_id,
               consumer.name AS user_name, r.rating, r.comment, r.date_submitted
        FROM product_reviews r JOIN users consumer ON consumer.id=r.user_id
        JOIN products product ON product.id=r.product_id
        WHERE r.product_id=:id AND r.removed_at IS NULL ORDER BY r.date_submitted DESC, r.id
    """),
            {"id": product_id},
        )
        .mappings()
        .all()
    )
    reviews = [MarketplaceProductReview(**row) for row in rows]
    state = _product_review_state(session, product_id, user_id)
    locked = bool(state and (state.removed_at is not None or state.status is not None))
    reason = None
    if locked:
        reason = (
            "Your feedback was removed by a moderator. "
            if state.removed_at is not None
            else "This feedback is part of a moderation decision and cannot be changed. "
        ) + (state.resolution_note or "")
    return MarketplaceProductReviewList(
        reviews=reviews,
        total=len(reviews),
        review_eligibility_reason=reason,
        rating=_money(
            sum((Decimal(review.rating) for review in reviews), Decimal(0)) / len(reviews)
        )
        if reviews
        else Decimal(0),
        can_review=not locked
        and _completed_product_purchase(session, user_id, product_id) is not None,
        my_review=next((review for review in reviews if review.user_id == user_id), None),
    )


@router.get("/products/{product_id}/reviews", response_model=MarketplaceProductReviewList)
def product_reviews(
    product_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceProductReviewList:
    return _product_reviews(session, product_id, current_user.id)


@router.put("/products/{product_id}/reviews", response_model=MarketplaceProductReviewList)
def write_product_review(
    product_id: UUID,
    request: MarketplaceProductReviewInput,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceProductReviewList:
    purchase = _completed_product_purchase(session, current_user.id, product_id, lock=True)
    if purchase is None:
        raise HTTPException(
            403, "You can rate only an item you purchased after that paid order is completed."
        )
    state = _product_review_state(session, product_id, current_user.id, lock=True)
    if state and (state.removed_at is not None or state.status is not None):
        raise HTTPException(
            409, "This feedback is under moderation or has a decision and cannot be changed."
        )
    session.execute(
        text("""
        INSERT INTO product_reviews(user_id, product_id, store_id, order_id, rating, comment)
        VALUES (:user_id,:product_id,:store_id,:order_id,:rating,:comment)
        ON CONFLICT (user_id, product_id) DO UPDATE
        SET rating=EXCLUDED.rating, comment=EXCLUDED.comment, updated_at=now()
    """),
        {
            "user_id": current_user.id,
            "product_id": product_id,
            "store_id": purchase.store_id,
            "order_id": purchase.order_id,
            "rating": request.rating,
            "comment": request.comment,
        },
    )
    session.commit()
    return _product_reviews(session, product_id, current_user.id)


@router.get("/review-prompts", response_model=MarketplaceReviewPromptList)
def product_review_prompts(
    order_id: UUID | None = None,
    store_id: UUID | None = None,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceReviewPromptList:
    rows = (
        session.execute(
            text("""
        SELECT DISTINCT ON (item.product_id) item.product_id, item.product_name,
               item.store_id, store.store_name, o.id AS order_id,
               (review.id IS NOT NULL) AS reviewed, review.rating, review.comment
        FROM orders o JOIN carts cart ON cart.id=o.cart_id
        JOIN order_items item ON item.order_id=o.id
        JOIN stores store ON store.id=item.store_id
        JOIN payments payment ON payment.order_id=o.id
        LEFT JOIN product_reviews review ON review.product_id=item.product_id AND review.user_id=cart.user_id
        WHERE cart.user_id=:user_id AND o.order_status='completed'
          AND payment.payment_status='paid' AND payment.inventory_deducted_at IS NOT NULL
          AND (CAST(:order_id AS uuid) IS NULL OR o.id=:order_id)
          AND (CAST(:store_id AS uuid) IS NULL OR item.store_id=:store_id)
        ORDER BY item.product_id,o.order_date DESC
    """),
            {"user_id": current_user.id, "order_id": order_id, "store_id": store_id},
        )
        .mappings()
        .all()
    )
    return MarketplaceReviewPromptList(items=[MarketplaceReviewPrompt(**row) for row in rows])


@router.post("/products/{product_id}/report", status_code=status.HTTP_204_NO_CONTENT)
def report_marketplace_product(
    product_id: UUID,
    request: ProductReportInput,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> None:
    product = session.execute(
        text("""
        SELECT p.store_id,p.product_name FROM products p JOIN stores s ON s.id = p.store_id
        WHERE p.id = :product_id AND s.status = 'approved'
    """),
        {"product_id": product_id},
    ).one_or_none()
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found or unavailable.")
    from app.api.v1.endpoints.reports import submit_report
    from app.schemas.reports import ContentReportInput

    submit_report(
        ContentReportInput(
            subject_type="store",
            subject_id=product.store_id,
            category="other",
            description=f"Product: {product.product_name}. {request.report_request.strip()}",
        ),
        current_user,
        session,
    )


@router.get("/cart", response_model=MarketplaceCart)
def get_cart(
    address_id: UUID | None = None,
    store_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceCart:
    delivery_latitude, delivery_longitude = (
        (latitude, longitude)
        if latitude is not None and longitude is not None
        else _address_coordinates(session, current_user.id, address_id)
    )
    cart = _cart_response(
        session,
        current_user.id,
        delivery_latitude=delivery_latitude,
        delivery_longitude=delivery_longitude,
        store_id=store_id,
    )
    if cart.stock_adjustments:
        session.commit()
    return cart


@router.put("/cart/items/{product_id}", response_model=MarketplaceCart)
def update_cart_item(
    product_id: UUID,
    request: CartQuantityUpdate,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceCart:
    product = session.execute(
        text(f"""
        SELECT p.stock_quantity, p.product_name, {_store_closed_today_sql("s")} AS store_closed_today FROM products p JOIN stores s ON s.id = p.store_id
        WHERE p.id = :id AND p.status = 'active' AND s.status = 'approved'
          AND (p.expiry_date IS NULL OR p.expiry_date > now())
    """),
        {"id": product_id},
    ).one_or_none()
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found or unavailable.")
    if getattr(product, "store_closed_today", False):
        raise HTTPException(409, "This shop is closed today and is not accepting cart additions.")
    cart_id = _active_cart_id(session, current_user.id)
    if request.cart_id is not None and request.cart_id != cart_id:
        return _cart_response(session, current_user.id)
    adjusted_quantity = min(request.quantity, product.stock_quantity)
    if adjusted_quantity:
        session.execute(
            text("""
            INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (:cart_id, :product_id, :quantity)
            ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity
        """),
            {"cart_id": cart_id, "product_id": product_id, "quantity": adjusted_quantity},
        )
    else:
        session.execute(
            text("""
            DELETE FROM cart_items WHERE cart_id = :cart_id AND product_id = :product_id
        """),
            {"cart_id": cart_id, "product_id": product_id},
        )
    session.commit()
    cart = _cart_response(session, current_user.id)
    if adjusted_quantity != request.quantity:
        cart.stock_adjustments.append(
            MarketplaceCartStockAdjustment(
                product_id=product_id,
                product_name=product.product_name,
                previous_quantity=request.quantity,
                adjusted_quantity=adjusted_quantity,
            )
        )
    return cart


@router.delete("/cart/items/{product_id}", response_model=MarketplaceCart)
def remove_cart_item(
    product_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceCart:
    cart_id = _active_cart_id(session, current_user.id)
    session.execute(
        text("DELETE FROM cart_items WHERE cart_id = :cart_id AND product_id = :product_id"),
        {"cart_id": cart_id, "product_id": product_id},
    )
    session.commit()
    return _cart_response(session, current_user.id)


@router.delete("/cart/shops", response_model=MarketplaceCart)
def remove_shop_carts(
    request: ShopCartRemoveRequest,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceCart:
    cart_id = _active_cart_id(session, current_user.id)
    session.execute(
        text("""
        DELETE FROM cart_items item USING products product
        WHERE item.product_id=product.id AND item.cart_id=:cart_id
          AND product.store_id=ANY(CAST(:store_ids AS uuid[]))
    """),
        {"cart_id": cart_id, "store_ids": [str(store_id) for store_id in set(request.store_ids)]},
    )
    session.commit()
    return _cart_response(session, current_user.id)


@router.post("/cart/promo", response_model=MarketplaceCart)
def apply_cart_promo(
    request: PromoApplyRequest,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> MarketplaceCart:
    cart_id = _active_cart_id(session, current_user.id)
    promo_id = session.execute(
        text("""
        SELECT p.id FROM promo_codes p JOIN users u ON u.id = :user_id
        WHERE upper(p.code) = upper(:code) AND p.status = 'active'
          AND now() BETWEEN start_date AND end_date
          AND (p.usage_limit IS NULL OR p.usage_limit > (SELECT COUNT(*) FROM payments WHERE coupon_applied = p.code))
          AND (p.audience = 'available' OR (p.audience = 'new_account' AND u.date_joined >= now() - interval '30 days')
            OR (p.audience = 'gift' AND EXISTS (SELECT 1 FROM user_promo_codes up WHERE up.user_id = :user_id AND up.promo_code_id = p.id AND up.redeemed_at IS NULL)))
    """),
        {"code": request.code.strip(), "user_id": current_user.id},
    ).scalar_one_or_none()
    if not promo_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "This promo code is invalid, expired, or no longer available.",
        )
    session.execute(
        text("UPDATE carts SET promo_code_id = :promo_id WHERE id = :cart_id"),
        {"promo_id": promo_id, "cart_id": cart_id},
    )
    cart = _cart_response(session, current_user.id, store_id=request.store_id)
    if cart.applied_promo is None:
        session.rollback()
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "This cart does not meet the promotion requirements.",
        )
    session.commit()
    return cart


@router.delete("/cart/promo", response_model=MarketplaceCart)
def remove_cart_promo(
    current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)
) -> MarketplaceCart:
    cart_id = _active_cart_id(session, current_user.id)
    session.execute(
        text("UPDATE carts SET promo_code_id = NULL WHERE id = :cart_id"), {"cart_id": cart_id}
    )
    session.commit()
    return _cart_response(session, current_user.id)


STORE_TIMEZONE = timezone(timedelta(hours=8))
SLOT_DURATION = timedelta(minutes=30)


def _slot_start(value: datetime) -> datetime:
    value = value.astimezone(timezone.utc)
    return value.replace(minute=(value.minute // 30) * 30, second=0, microsecond=0)


def _slot_problem(
    cart: MarketplaceCart, slot: datetime, store_id: UUID, limits: object, usage: object
) -> str | None:
    """Shared rules for the advisory picker and the authoritative locked checkout."""
    end = slot + SLOT_DURATION
    items = [item for item in cart.items if item.product.store_id == store_id]
    if any(item.product.expiry_date and item.product.expiry_date <= end for item in items):
        return "An item expires before the end of this window. Choose an earlier time or remove it."
    if getattr(limits, "store_status", "approved") != "approved":
        return "This shop is not accepting orders."
    local = slot.astimezone(STORE_TIMEZONE)
    local_end = end.astimezone(STORE_TIMEZONE)
    schedule = getattr(limits, "operating_hours_schedule", None) or {}
    hours = schedule.get(local.strftime("%A")) or schedule.get(local.strftime("%A").lower())
    if (
        getattr(limits, "holiday_closed", False)
        or (schedule and not hours)
        or (
            hours
            and (
                hours.get("closed")
                or local.date() != local_end.date()
                or not str(hours.get("open", "00:00")) <= local.strftime("%H:%M")
                or local_end.strftime("%H:%M") >= str(hours.get("close", "00:00"))
            )
        )
    ):
        return "This shop is closed during this window. Choose a time during its operating hours."
    quantity = sum(item.product.cart_quantity for item in items)
    if usage.orders >= limits.slot_order_limit or usage.items + quantity > limits.slot_item_limit:
        return "This shop cannot prepare that quantity in this 30-minute slot. Choose another time or reduce the quantity."
    return None


def _capacity_store(session: Session, store_id: UUID, slot: datetime, lock: bool = False) -> object:
    local = slot.astimezone(STORE_TIMEZONE)
    local_end = (slot + SLOT_DURATION).astimezone(STORE_TIMEZONE)
    return session.execute(
        text(
            """
        SELECT slot_order_limit, slot_item_limit, operating_hours_schedule, status AS store_status,
               EXISTS (SELECT 1 FROM store_holiday_closures h
                 WHERE h.store_id = stores.id
                   AND CAST(:local_date AS date) BETWEEN h.starts_on AND h.ends_on
                   AND (h.whole_day OR CAST(:local_time AS time) < h.opens_at
                        OR CAST(:end_time AS time) >= h.closes_at)) AS holiday_closed
        FROM stores WHERE id = :id
    """
            + (" FOR UPDATE" if lock else "")
        ),
        {
            "id": store_id,
            "local_date": local.date(),
            "local_time": local.strftime("%H:%M"),
            "end_time": local_end.strftime("%H:%M"),
        },
    ).one()


def _reserve_fulfilment_capacity(
    session: Session, cart: MarketplaceCart, arrival_at: datetime | None
) -> datetime:
    """Serialize capacity checks per store; only paid orders consume capacity."""
    now = datetime.now(timezone.utc)
    earliest = now + timedelta(minutes=max(30, cart.estimated_delivery_minutes or 0))
    if arrival_at is not None:
        slot = _slot_start(arrival_at)
        if arrival_at.astimezone(timezone.utc) != slot:
            raise HTTPException(422, "Choose a window starting on the hour or half hour.")
        if slot < earliest:
            raise HTTPException(
                409,
                "This window does not allow enough preparation and travel time. Choose a later window.",
            )
    else:
        slot = _slot_start(earliest)
        if slot < earliest:
            slot += SLOT_DURATION
    for store_id in sorted({item.product.store_id for item in cart.items}, key=str):
        limits = _capacity_store(session, store_id, slot, lock=True)
        usage = session.execute(
            text("""
            SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(item.quantity), 0) AS items
            FROM orders o JOIN order_items item ON item.order_id = o.id
            WHERE item.store_id = :store_id AND o.fulfilment_slot = :slot
              AND o.order_status NOT IN ('pending_payment', 'cancelled', 'failed', 'refunded')
        """),
            {"store_id": store_id, "slot": slot},
        ).one()
        problem = _slot_problem(cart, slot, store_id, limits, usage)
        if problem:
            raise HTTPException(409, problem)
    return slot


@router.get("/cart/availability")
def cart_slot_availability(
    day: date,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
    store_id: UUID | None = None,
) -> dict:
    """Advisory availability; checkout rechecks under store locks to prevent races."""
    from types import SimpleNamespace

    now = datetime.now(timezone.utc)
    today = now.astimezone(STORE_TIMEZONE).date()
    if not today <= day <= today + timedelta(days=7):
        raise HTTPException(422, "Choose a date within the next seven days.")
    cart = _cart_response(session, current_user.id, store_id=store_id)
    if cart.stock_adjustments:
        session.commit()
    start = datetime.combine(day, datetime.min.time(), tzinfo=STORE_TIMEZONE).astimezone(
        timezone.utc
    )
    end = start + timedelta(days=1)
    store_ids = sorted(
        {item.product.store_id for item in cart.items} | ({store_id} if store_id else set()),
        key=str,
    )
    stores = (
        session.execute(
            text("""
        SELECT id, slot_order_limit, slot_item_limit, operating_hours_schedule, status AS store_status
        FROM stores WHERE id = ANY(:store_ids)
    """),
            {"store_ids": store_ids},
        ).all()
        if store_ids
        else []
    )
    holidays = (
        session.execute(
            text("""
        SELECT store_id, whole_day, opens_at, closes_at FROM store_holiday_closures
        WHERE store_id = ANY(:store_ids) AND :day BETWEEN starts_on AND ends_on
    """),
            {"store_ids": store_ids, "day": day},
        ).all()
        if store_ids
        else []
    )
    usage = (
        session.execute(
            text("""
        SELECT item.store_id, o.fulfilment_slot, COUNT(DISTINCT o.id) AS orders,
               COALESCE(SUM(item.quantity), 0) AS items
        FROM orders o JOIN order_items item ON item.order_id = o.id
        WHERE item.store_id = ANY(:store_ids) AND o.fulfilment_slot >= :start AND o.fulfilment_slot < :end
          AND o.order_status NOT IN ('pending_payment', 'cancelled', 'failed', 'refunded')
        GROUP BY item.store_id, o.fulfilment_slot
    """),
            {"store_ids": store_ids, "start": start, "end": end},
        ).all()
        if store_ids
        else []
    )
    if store_id and not any(store.id == store_id for store in stores):
        raise HTTPException(404, "Shop not found.")
    usage_by_slot = {(row.store_id, row.fulfilment_slot): row for row in usage}
    earliest = now + timedelta(minutes=max(30, cart.estimated_delivery_minutes or 0))
    slots = []
    for index in range(48):
        slot = start + index * SLOT_DURATION
        if slot < earliest or slot > now + timedelta(days=7):
            continue
        reason = None
        for store in stores:
            local_time = slot.astimezone(STORE_TIMEZONE).time()
            local_end = (slot + SLOT_DURATION).astimezone(STORE_TIMEZONE).time()
            holiday_closed = any(
                h.whole_day or local_time < h.opens_at or local_end >= h.closes_at
                for h in holidays
                if h.store_id == store.id
            )
            limits = SimpleNamespace(
                slot_order_limit=store.slot_order_limit,
                slot_item_limit=store.slot_item_limit,
                operating_hours_schedule=store.operating_hours_schedule,
                store_status=store.store_status,
                holiday_closed=holiday_closed,
            )
            reason = _slot_problem(
                cart,
                slot,
                store.id,
                limits,
                usage_by_slot.get((store.id, slot), SimpleNamespace(orders=0, items=0)),
            )
            if reason:
                break
        # Hide closed windows in every picker, including the cart's unscoped
        # request. Capacity/stock failures stay visible as disabled choices.
        if (reason and "closed during this window" in reason) or (
            store_id
            and any(store.id == store_id and not store.operating_hours_schedule for store in stores)
        ):
            continue
        slots.append(
            {
                "start": slot.isoformat(),
                "end": (slot + SLOT_DURATION).isoformat(),
                "available": reason is None,
                "reason": reason,
            }
        )
    return {"slots": slots, "cart_checked": bool(cart.items), "timezone": "Asia/Kuala_Lumpur"}


def _ensure_no_pending_checkout(session: Session, cart_id: UUID) -> None:
    # Replace abandoned sessions under the cart lock instead of blocking for 30 minutes.
    pending = session.execute(
        text("""
        SELECT o.id AS order_id, p.id AS payment_id, p.stripe_checkout_session_id
        FROM orders o JOIN payments p ON p.order_id = o.id
        WHERE o.cart_id = :cart_id AND o.order_status = 'pending_payment'
          AND p.payment_status = 'pending'
    """),
        {"cart_id": cart_id},
    ).all()
    for payment in pending:
        if payment.stripe_checkout_session_id:
            stripe_payments.expire_unpaid_checkout(payment.stripe_checkout_session_id)
        session.execute(
            text(
                "UPDATE payments SET payment_status='failed', failure_reason='Replaced by a new checkout.' WHERE id=:id"
            ),
            {"id": payment.payment_id},
        )
        session.execute(
            text("UPDATE orders SET order_status='cancelled' WHERE id=:id"),
            {"id": payment.order_id},
        )


@router.post("/checkout", response_model=CheckoutResult, status_code=status.HTTP_201_CREATED)
def checkout(
    request: CheckoutRequest,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> CheckoutResult:
    try:
        if request.fulfillment_method == "pickup":
            delivery_address = "Customer pickup directly from store"
        elif request.address_id is not None:
            address = session.execute(
                text("""
                SELECT address_line_1, address_line_2, city, state, postal_code, latitude, longitude FROM addresses
                WHERE id = :id AND user_id = :user_id
            """),
                {"id": request.address_id, "user_id": current_user.id},
            ).one_or_none()
            if not address:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a valid delivery address."
                )
            delivery_address = ", ".join(
                filter(
                    None,
                    [
                        address.address_line_1,
                        address.address_line_2,
                        address.city,
                        address.state,
                        address.postal_code,
                    ],
                )
            )
            delivery_latitude = getattr(address, "latitude", None)
            delivery_longitude = getattr(address, "longitude", None)
        else:
            temporary = request.temporary_location
            assert temporary is not None
            delivery_address = ", ".join(
                filter(
                    None,
                    [
                        temporary.address_line_1,
                        temporary.city,
                        temporary.state,
                        temporary.postal_code,
                    ],
                )
            )
            delivery_latitude, delivery_longitude = temporary.latitude, temporary.longitude
        if request.fulfillment_method == "pickup":
            delivery_latitude, delivery_longitude = None, None
        cart = _cart_response(
            session,
            current_user.id,
            lock=True,
            delivery_latitude=delivery_latitude,
            delivery_longitude=delivery_longitude,
            store_id=request.store_id,
        )
        if not cart.items:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Your cart is empty.")
        if len({item.product.store_id for item in cart.items}) > 1:
            raise HTTPException(
                409,
                "Check out one shop at a time. Remove the other shop’s items before continuing.",
            )
        if request.fulfillment_method == "pickup":
            cart = cart.model_copy(
                update={
                    "delivery_fee": Decimal("0"),
                    "total": _money(cart.total - cart.delivery_fee),
                }
            )
        for item in cart.items:
            if item.product.stock_quantity < item.product.cart_quantity:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, f"{item.product.name} no longer has enough stock."
                )
        _ensure_no_pending_checkout(session, cart.id)
        fulfilment_slot = _reserve_fulfilment_capacity(session, cart, request.arrival_at)
        order_id = session.execute(
            text("""
            INSERT INTO orders (cart_id, delivery_address, order_status, total_amount, fulfilment_slot)
            VALUES (:cart_id, :address, 'pending_payment', :total, :slot) RETURNING id
        """),
            {
                "cart_id": cart.id,
                "address": delivery_address[:100],
                "total": cart.total,
                "slot": fulfilment_slot,
            },
        ).scalar_one()
        payment_id = session.execute(
            text("""
            INSERT INTO payments (order_id, payment_method, amount, payment_status, coupon_applied)
            VALUES (:order_id, :method, :amount, 'pending', :coupon) RETURNING id
        """),
            {
                "order_id": order_id,
                "method": "stripe",
                "amount": cart.total,
                "coupon": cart.applied_promo.code if cart.applied_promo else None,
            },
        ).scalar_one()
        session.execute(
            text("""
            INSERT INTO deliveries (payment_id, delivery_status, estimated_arrival)
            VALUES (:payment_id, 'pending', :estimated_arrival)
        """),
            {
                "payment_id": payment_id,
                "estimated_arrival": fulfilment_slot,
            },
        )
        promo_scope = _promo_for_cart(session, cart.id) if cart.discount > 0 else None
        discounted_items = [
            item
            for item in cart.items
            if promo_scope is not None
            and (promo_scope.store_id is None or item.product.store_id == promo_scope.store_id)
            and (promo_scope.product_id is None or item.product.id == promo_scope.product_id)
            and (
                promo_scope.product_category is None
                or item.product.category == promo_scope.product_category
            )
        ]
        remaining_discount = cart.discount
        remaining_eligible_total = sum((item.line_total for item in discounted_items), Decimal("0"))
        vendor_net: dict[UUID, Decimal] = defaultdict(lambda: Decimal("0"))
        checkout_lines: list[dict] = []
        for item in cart.items:
            is_discounted = item in discounted_items
            if not is_discounted:
                line_discount = Decimal("0")
            elif item is discounted_items[-1] or remaining_eligible_total <= 0:
                line_discount = min(remaining_discount, item.line_total)
            else:
                eligible_total = sum((entry.line_total for entry in discounted_items), Decimal("0"))
                line_discount = _money(cart.discount * item.line_total / eligible_total)
                line_discount = min(line_discount, remaining_discount, item.line_total)
            net_amount = _money(item.line_total - line_discount)
            remaining_discount = _money(remaining_discount - line_discount)
            if is_discounted:
                remaining_eligible_total = _money(remaining_eligible_total - item.line_total)
            unit_price = _money(item.line_total / item.product.cart_quantity)
            session.execute(
                text("""
                INSERT INTO order_items
                  (order_id, product_id, store_id, product_name, unit_price, quantity,
                   line_total, discount_amount, net_amount)
                VALUES
                  (:order_id, :product_id, :store_id, :product_name, :unit_price, :quantity,
                   :line_total, :discount_amount, :net_amount)
            """),
                {
                    "order_id": order_id,
                    "product_id": item.product.id,
                    "store_id": item.product.store_id,
                    "product_name": item.product.name,
                    "unit_price": unit_price,
                    "quantity": item.product.cart_quantity,
                    "line_total": item.line_total,
                    "discount_amount": line_discount,
                    "net_amount": net_amount,
                },
            )
            vendor_net[item.product.store_id] += net_amount
            if net_amount > 0:
                checkout_lines.append(
                    {
                        "price_data": {
                            "currency": get_settings().stripe_currency.lower(),
                            "product_data": {
                                "name": f"{item.product.name} × {item.product.cart_quantity}",
                                "description": item.store_name,
                            },
                            "unit_amount": int(net_amount * 100),
                        },
                        "quantity": 1,
                    }
                )
        if cart.delivery_fee > 0:
            checkout_lines.append(
                {
                    "price_data": {
                        "currency": get_settings().stripe_currency.lower(),
                        "product_data": {"name": "EcoChef delivery"},
                        "unit_amount": int(cart.delivery_fee * 100),
                    },
                    "quantity": 1,
                }
            )
        for store_id, gross_amount in vendor_net.items():
            platform_fee = _money(gross_amount * Decimal("0.15"))
            session.execute(
                text("""
                INSERT INTO payment_vendor_allocations
                  (payment_id, store_id, stripe_account_id, gross_amount,
                   platform_fee_amount, transfer_amount)
                VALUES (:payment_id, :store_id, :stripe_account_id, :gross_amount,
                        :platform_fee_amount, :transfer_amount)
            """),
                {
                    "payment_id": payment_id,
                    "store_id": store_id,
                    "stripe_account_id": None,
                    "gross_amount": gross_amount,
                    "platform_fee_amount": platform_fee,
                    "transfer_amount": _money(gross_amount - platform_fee),
                },
            )
        stripe_checkout = stripe_payments.create_checkout_session(
            order_id=order_id,
            payment_id=payment_id,
            customer_email=current_user.email,
            line_items=checkout_lines,
        )
        session.execute(
            text("""
            UPDATE payments SET stripe_checkout_session_id = :checkout_session_id
            WHERE id = :payment_id
        """),
            {"checkout_session_id": stripe_checkout.id, "payment_id": payment_id},
        )
        session.commit()
        return CheckoutResult(
            order_id=order_id,
            payment_status="pending",
            total=cart.total,
            message="Complete payment securely in the embedded Stripe form.",
            checkout_client_secret=stripe_checkout.client_secret,
            checkout_session_id=stripe_checkout.id,
            simulation_available=_sandbox_payment_simulation_enabled(),
        )
    except (
        stripe_payments.StripeConfigurationError,
        stripe_payments.StripeOperationError,
    ) as error:
        session.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
    except Exception:
        session.rollback()
        raise


def _ensure_order_shop_open_today(session: Session, order_id: UUID) -> None:
    closed = session.execute(
        text(f"""
        SELECT EXISTS(SELECT 1 FROM order_items item JOIN stores store ON store.id=item.store_id
                      WHERE item.order_id=:id AND {_store_closed_today_sql("store")})
    """),
        {"id": order_id},
    ).scalar_one()
    if closed:
        raise HTTPException(
            409, "This shop is closed today. Payment cannot continue for this checkout."
        )


@router.post("/checkout/{order_id}/simulate-payment", response_model=CheckoutStatusResult)
def simulate_checkout_payment(
    order_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> CheckoutStatusResult:
    """Complete an explicitly enabled Stripe test payment; never available with live keys."""
    if not _sandbox_payment_simulation_enabled():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Simulated payment is only available in an explicitly enabled Stripe test environment.",
        )
    lock_order_cart(session, order_id)
    payment = session.execute(
        text("""
        SELECT p.id, p.order_id, p.payment_status, p.inventory_deducted_at,
               o.order_status, o.total_amount
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        JOIN carts c ON c.id = o.cart_id
        WHERE o.id = :order_id AND c.user_id = :user_id
        FOR UPDATE OF p, o
    """),
        {"order_id": order_id, "user_id": current_user.id},
    ).one_or_none()
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checkout not found.")
    if payment.payment_status == "paid":
        return CheckoutStatusResult(
            order_id=payment.order_id,
            payment_status="paid",
            order_status=payment.order_status,
            total=payment.total_amount,
        )
    if payment.payment_status != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This checkout cannot be simulated because it is {payment.payment_status}.",
        )

    _ensure_order_shop_open_today(session, order_id)
    inventory = []
    if payment.inventory_deducted_at is None:
        inventory = session.execute(
            text("""
            SELECT product.id, product.product_name, product.stock_quantity, item.quantity
            FROM order_items item
            JOIN products product ON product.id = item.product_id
            WHERE item.order_id = :order_id
            ORDER BY product.id
            FOR UPDATE OF product
        """),
            {"order_id": order_id},
        ).all()
        unavailable = next(
            (item for item in inventory if item.stock_quantity < item.quantity),
            None,
        )
        if unavailable is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{unavailable.product_name} no longer has enough stock.",
            )
    try:
        stripe_payment = stripe_payments.create_sandbox_payment(
            order_id=order_id,
            payment_id=payment.id,
            amount=int(_money(payment.total_amount) * 100),
        )
    except (
        stripe_payments.StripeConfigurationError,
        stripe_payments.StripeOperationError,
    ) as error:
        session.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
    charge = stripe_payment.latest_charge
    charge_id = charge if isinstance(charge, str) else getattr(charge, "id", None)
    if not charge_id:
        session.rollback()
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Stripe completed the test payment without a charge reference.",
        )

    if payment.inventory_deducted_at is None:
        session.execute(
            text("""
            UPDATE products product
            SET stock_quantity = product.stock_quantity - item.quantity
            FROM order_items item
            WHERE item.order_id = :order_id AND item.product_id = product.id
        """),
            {"order_id": order_id},
        )

    session.execute(
        text("""
        UPDATE payment_vendor_allocations
        SET transfer_status = 'transferred', transferred_at = now(),
            settlement_method = 'simulated'
        WHERE payment_id = :payment_id AND transfer_status = 'pending'
    """),
        {"payment_id": payment.id},
    )
    session.execute(
        text("""
        UPDATE payments
        SET payment_status = 'paid', paid_at = now(),
            stripe_payment_intent_id = :payment_intent_id,
            stripe_charge_id = :charge_id,
            inventory_deducted_at = COALESCE(inventory_deducted_at, now()),
            failure_reason = NULL
        WHERE id = :payment_id
    """),
        {
            "payment_id": payment.id,
            "payment_intent_id": stripe_payment.id,
            "charge_id": charge_id,
        },
    )
    session.execute(
        text("UPDATE orders SET order_status = 'placed' WHERE id = :order_id"),
        {"order_id": order_id},
    )
    consume_order_cart_snapshot(session, order_id)
    session.commit()
    return CheckoutStatusResult(
        order_id=payment.order_id,
        payment_status="paid",
        order_status="placed",
        total=payment.total_amount,
    )


@router.get("/checkout/{order_id}", response_model=CheckoutStatusResult)
def checkout_status(
    order_id: UUID,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> CheckoutStatusResult:
    row = session.execute(
        text("""
        SELECT o.id, o.order_status, o.total_amount, p.payment_status,
               p.stripe_hosted_invoice_url, p.stripe_invoice_pdf_url
        FROM orders o
        JOIN carts c ON c.id = o.cart_id
        JOIN payments p ON p.order_id = o.id
        WHERE o.id = :order_id AND c.user_id = :user_id
    """),
        {"order_id": order_id, "user_id": current_user.id},
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checkout not found.")
    return CheckoutStatusResult(
        order_id=row.id,
        payment_status=row.payment_status,
        order_status=row.order_status,
        total=row.total_amount,
        invoice_url=row.stripe_hosted_invoice_url,
        invoice_pdf_url=row.stripe_invoice_pdf_url,
    )
