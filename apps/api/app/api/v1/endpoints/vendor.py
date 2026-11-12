import base64
import binascii
from uuid import UUID, uuid4
import json
import logging
import csv
import io
from datetime import date, time
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.core.config import get_settings
from app.services import stripe_payments
from app.schemas.vendor import StoreStaffInviteInput, StoreStaffPermissionInput, VendorProduct, VendorProductImageUpload, VendorProductImageUploadResult, VendorProductInput, VendorPromotionInput, VendorStore, VendorStoreInput, VendorStoreList
from app.modules.notifications.service import create_notification, send_push_notification

router = APIRouter()
logger = logging.getLogger(__name__)
CurrentOwner = Depends(require_roles(AccountRole.business_owner))
ORDER_STATUS_ALERTS = {
    "preparing": "The shop is preparing your order.",
    "ready": "Your order is ready.",
    "completed": "The shop has confirmed your order was handed over.",
}


@lru_cache(maxsize=1)
def _malaysia_postcodes() -> dict[str, dict[str, str]]:
    try:
        with urlopen("https://storage.data.gov.my/dictionaries/postcodes.csv", timeout=10) as response:
            rows = csv.DictReader(io.StringIO(response.read().decode("utf-8-sig")))
            return {str(row["postcode"]).zfill(5): {"city": row["city"], "state": row["state"]} for row in rows}
    except (HTTPError, URLError, TimeoutError, KeyError, UnicodeDecodeError) as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The Malaysian postcode directory is temporarily unavailable.") from error


@router.get("/postcodes/{postcode}")
def postcode_location(postcode: str, current_user: AuthenticatedUser = CurrentOwner) -> dict[str, str]:
    if len(postcode) != 5 or not postcode.isdigit():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter a five-digit Malaysian postcode.")
    location = _malaysia_postcodes().get(postcode)
    if location is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Malaysian postcode not found.")
    return {"postcode": postcode, **location, "country": "Malaysia"}


@router.get("/locations")
def malaysia_locations(current_user: AuthenticatedUser = CurrentOwner) -> dict[str, object]:
    states: dict[str, set[str]] = {}
    for location in _malaysia_postcodes().values():
        state, city = location["state"].strip(), location["city"].strip()
        if state and city:
            states.setdefault(state, set()).add(city)
    return {"country": "Malaysia", "states": {state: sorted(cities) for state, cities in sorted(states.items())}}


def _product(row: object) -> VendorProduct:
    return VendorProduct(id=row.id, store_id=row.store_id, name=row.product_name, description=row.description,
                         price=row.price, stock_quantity=row.stock_quantity, category=row.category,
                         subcategory=row.subcategory,
                         unit_label=row.unit_label, brand=getattr(row, "brand", None), size=getattr(row, "size_label", None),
                         image_url=row.image_url, original_price=row.original_price,
                         expiry_date=row.expiry_date, status=row.status, addons=row.addons or [],
                         discount=row.discount)


@router.post("/product-images", response_model=VendorProductImageUploadResult,
             status_code=status.HTTP_201_CREATED)
def upload_product_image(
    payload: VendorProductImageUpload,
    request: Request,
    current_user: AuthenticatedUser = CurrentOwner,
    session: Session = Depends(get_db_session),
) -> VendorProductImageUploadResult:
    try:
        image_bytes = base64.b64decode(payload.data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "The selected image could not be read.") from error
    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            "Product images must be smaller than 8 MB.")
    image_id = uuid4()
    session.execute(text("""
        INSERT INTO product_images (id, uploaded_by, content_type, image_data)
        VALUES (:id, :uploaded_by, :content_type, :image_data)
    """), {"id": image_id, "uploaded_by": current_user.id,
             "content_type": payload.content_type, "image_data": image_bytes})
    session.commit()
    image_url = str(request.base_url).rstrip("/") + f"{get_settings().api_prefix}/vendor/product-images/{image_id}"
    return VendorProductImageUploadResult(image_url=image_url)


@router.get("/product-images/{image_id}", response_class=Response)
def get_product_image(image_id: UUID, session: Session = Depends(get_db_session)) -> Response:
    image = session.execute(text("""
        SELECT content_type, image_data FROM product_images WHERE id = :image_id
    """), {"image_id": image_id}).mappings().one_or_none()
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product image not found.")
    return Response(content=bytes(image["image_data"]), media_type=image["content_type"],
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


def _store(row: object, products: list[VendorProduct], is_owner: bool = True, can_edit_store: bool = True) -> VendorStore:
    return VendorStore(id=row.id, name=row.store_name, address=row.store_address, phone_number=row.phone_number,
                       operating_hours=row.operating_hours, description=row.description, category=row.category,
                       status=row.status, delivery_fee=row.delivery_fee,
                       estimated_delivery_minutes=row.estimated_delivery_minutes,
                       street_address=row.street_address, postal_code=row.postal_code, city=row.city, state=row.state,
                       country=row.country, additional_location_details=row.additional_location_details,
                       contact_email=row.contact_email, helpline_phones=row.helpline_phones or [], icon_url=row.icon_url,
                       cover_image_url=row.cover_image_url,
                       operating_hours_schedule=row.operating_hours_schedule or {}, is_owner=is_owner,
                       slot_order_limit=getattr(row, "slot_order_limit", 10),
                       slot_item_limit=getattr(row, "slot_item_limit", 100),
                       can_edit_store=can_edit_store, products=products)


def _owned_store(session: Session, owner_id: UUID, store_id: UUID) -> object:
    row = session.execute(text("SELECT * FROM stores WHERE id = :id AND business_owner_id = :owner_id"),
                          {"id": store_id, "owner_id": owner_id}).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found.")
    return row


def _stripe_recipient_account(
    session: Session, current_user: AuthenticatedUser, store_id: UUID
) -> tuple[object, str]:
    store = _owned_store(session, current_user.id, store_id)
    account_id = getattr(store, "stripe_account_id", None)
    if account_id:
        return store, account_id
    account = stripe_payments.create_recipient_account(
        store_id=store.id,
        name=store.store_name,
        email=store.contact_email or current_user.email,
    )
    session.execute(text("""
        UPDATE stores
        SET stripe_account_id = :stripe_account_id,
            stripe_transfers_status = 'pending'
        WHERE id = :store_id
    """), {"stripe_account_id": account.id, "store_id": store.id})
    session.commit()
    return store, account.id


@router.post("/stores/{store_id}/stripe/account-session")
def create_stripe_account_session(
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentOwner,
    session: Session = Depends(get_db_session),
) -> dict[str, str]:
    try:
        _, account_id = _stripe_recipient_account(session, current_user, store_id)
        return {
            "account_id": account_id,
            "client_secret": stripe_payments.create_embedded_account_session(account_id),
        }
    except (stripe_payments.StripeConfigurationError, stripe_payments.StripeOperationError) as error:
        session.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error


@router.get("/stores/{store_id}/stripe/status")
def stripe_account_status(
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentOwner,
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    store = _owned_store(session, current_user.id, store_id)
    if not getattr(store, "stripe_account_id", None):
        return {"account_id": None, "transfers_status": "not_requested", "ready": False}
    try:
        account = stripe_payments.retrieve_recipient_account(store.stripe_account_id)
    except (stripe_payments.StripeConfigurationError, stripe_payments.StripeOperationError) as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
    transfers_status = stripe_payments.nested_value(
        account,
        "configuration", "recipient", "capabilities", "stripe_balance",
        "stripe_transfers", "status",
        default="pending",
    )
    ready = transfers_status == "active"
    session.execute(text("""
        UPDATE stores
        SET stripe_transfers_status = :transfers_status,
            stripe_onboarding_complete_at = CASE
              WHEN :ready THEN COALESCE(stripe_onboarding_complete_at, now())
              ELSE stripe_onboarding_complete_at
            END
        WHERE id = :store_id
    """), {"transfers_status": transfers_status, "ready": ready, "store_id": store.id})
    session.commit()
    return {
        "account_id": store.stripe_account_id,
        "transfers_status": transfers_status,
        "ready": ready,
    }


@router.post("/stores/{store_id}/stripe/dashboard-link")
def stripe_dashboard_link(
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentOwner,
    session: Session = Depends(get_db_session),
) -> dict[str, str]:
    store = _owned_store(session, current_user.id, store_id)
    if not getattr(store, "stripe_account_id", None):
        raise HTTPException(status.HTTP_409_CONFLICT, "Complete Stripe onboarding first.")
    try:
        return {"url": stripe_payments.create_express_login_link(store.stripe_account_id)}
    except (stripe_payments.StripeConfigurationError, stripe_payments.StripeOperationError) as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error


def _account_store_id(session: Session, account_id: UUID, require_approved: bool = False) -> UUID:
    row = session.execute(text("""
        SELECT id AS store_id, status FROM stores WHERE business_owner_id = :account_id
        UNION ALL
        SELECT s.id, s.status FROM store_staff_memberships m JOIN stores s ON s.id = m.store_id
        WHERE m.business_account_id = :account_id
        LIMIT 1
    """), {"account_id": account_id}).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No store is connected to this business account.")
    if require_approved and row.status != "approved":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Wait for administrator approval before using this store feature.")
    return row.store_id


def _accessible_store(session: Session, account_id: UUID, store_id: UUID, require_profile_edit: bool = False,
                      require_approved: bool = False) -> object:
    row = session.execute(text("""
        SELECT s.*, (s.business_owner_id = :account_id) AS is_owner,
               (s.business_owner_id = :account_id OR COALESCE(m.can_edit_store, false)) AS can_edit_store
        FROM stores s
        LEFT JOIN store_staff_memberships m
          ON m.store_id = s.id AND m.business_account_id = :account_id
        WHERE s.id = :store_id
          AND (s.business_owner_id = :account_id OR m.business_account_id IS NOT NULL)
    """), {"account_id": account_id, "store_id": store_id}).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found.")
    if require_profile_edit and not row.can_edit_store:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You have view-only access to this store profile.")
    if require_approved and row.status != "approved":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Wait for administrator approval before using this store feature.")
    return row


@router.get("/stores", response_model=VendorStoreList)
def list_stores(current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> VendorStoreList:
    stores = session.execute(text("""
        SELECT s.*, true AS is_owner, true AS can_edit_store
        FROM stores s WHERE s.business_owner_id = :account_id
        UNION ALL
        SELECT s.*, false AS is_owner, m.can_edit_store
        FROM store_staff_memberships m JOIN stores s ON s.id = m.store_id
        WHERE m.business_account_id = :account_id
        ORDER BY store_name
    """), {"account_id": current_user.id}).all()
    result = []
    for store in stores:
        products = session.execute(text("SELECT * FROM products WHERE store_id = :store_id ORDER BY product_name"),
                                   {"store_id": store.id}).all()
        result.append(_store(store, [_product(product) for product in products], store.is_owner, store.can_edit_store))
    return VendorStoreList(stores=result)


@router.get("/invitations")
def list_invitations(current_user: AuthenticatedUser = CurrentOwner,
                     session: Session = Depends(get_db_session)) -> dict:
    rows = session.execute(text("""
        SELECT i.id, i.store_id, s.store_name, i.assigned_role, i.can_edit_store, i.created_at,
               owner.name AS invited_by_name
        FROM store_staff_invitations i
        JOIN stores s ON s.id = i.store_id
        JOIN business_owners owner ON owner.id = i.invited_by
        WHERE lower(i.invited_email) = lower(:email) AND i.status = 'pending'
        ORDER BY i.created_at DESC
    """), {"email": current_user.email}).mappings().all()
    return {"invitations": [dict(row) for row in rows]}


@router.post("/invitations/{invitation_id}/accept")
def accept_invitation(invitation_id: UUID, current_user: AuthenticatedUser = CurrentOwner,
                      session: Session = Depends(get_db_session)) -> dict:
    invitation = session.execute(text("""
        SELECT i.*, s.store_name FROM store_staff_invitations i
        JOIN stores s ON s.id = i.store_id
        WHERE i.id = :id AND lower(i.invited_email) = lower(:email) AND i.status = 'pending'
        FOR UPDATE
    """), {"id": invitation_id, "email": current_user.email}).mappings().one_or_none()
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This store invitation is no longer available.")
    existing = session.execute(text("""
        SELECT 1 FROM stores WHERE business_owner_id = :account_id
        UNION ALL SELECT 1 FROM store_staff_memberships WHERE business_account_id = :account_id
    """), {"account_id": current_user.id}).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "This business account already owns or belongs to a store.")
    session.execute(text("""
        INSERT INTO store_staff_memberships (store_id, business_account_id, assigned_role, can_edit_store)
        VALUES (:store_id, :account_id, :assigned_role, false)
    """), {"store_id": invitation["store_id"], "account_id": current_user.id,
             "assigned_role": invitation["assigned_role"]})
    session.execute(text("""
        UPDATE store_staff_invitations SET status = 'accepted', accepted_at = now() WHERE id = :id
    """), {"id": invitation_id})
    session.commit()
    return {"message": f"Invitation accepted. You now belong to {invitation['store_name']}.",
            "store_id": invitation["store_id"]}


@router.get("/stores/{store_id}/team")
def store_team(store_id: UUID, current_user: AuthenticatedUser = CurrentOwner,
               session: Session = Depends(get_db_session)) -> dict:
    access = _accessible_store(session, current_user.id, store_id)
    members = session.execute(text("""
        SELECT owner.id AS account_id, owner.name, owner.email, 'Store Owner' AS assigned_role,
               true AS can_edit_store, 'active' AS status, true AS is_owner
        FROM stores s JOIN business_owners owner ON owner.id = s.business_owner_id WHERE s.id = :store_id
        UNION ALL
        SELECT account.id, account.name, account.email, member.assigned_role,
               member.can_edit_store, 'active', false
        FROM store_staff_memberships member
        JOIN business_owners account ON account.id = member.business_account_id
        WHERE member.store_id = :store_id
        ORDER BY is_owner DESC, name
    """), {"store_id": store_id}).mappings().all()
    pending = session.execute(text("""
        SELECT id, invited_email AS email, assigned_role, created_at
        FROM store_staff_invitations WHERE store_id = :store_id AND status = 'pending'
        ORDER BY created_at DESC
    """), {"store_id": store_id}).mappings().all()
    return {"members": [dict(row) for row in members], "pending_invitations": [dict(row) for row in pending],
            "can_manage_team": bool(access.is_owner)}


@router.post("/stores/{store_id}/invitations", status_code=status.HTTP_201_CREATED)
def invite_store_staff(store_id: UUID, request: StoreStaffInviteInput,
                       current_user: AuthenticatedUser = CurrentOwner,
                       session: Session = Depends(get_db_session)) -> dict:
    _owned_store(session, current_user.id, store_id)
    email = str(request.email).lower()
    owner_email = session.execute(text("SELECT lower(email) FROM business_owners WHERE id = :id"),
                                  {"id": current_user.id}).scalar_one()
    if email == owner_email:
        raise HTTPException(status.HTTP_409_CONFLICT, "The store owner is already part of this store.")
    account = session.execute(text("SELECT id FROM business_owners WHERE lower(email) = :email"),
                              {"email": email}).one_or_none()
    if account is not None:
        occupied = session.execute(text("""
            SELECT 1 FROM stores WHERE business_owner_id = :account_id
            UNION ALL SELECT 1 FROM store_staff_memberships WHERE business_account_id = :account_id
        """), {"account_id": account.id}).first()
        if occupied:
            raise HTTPException(status.HTTP_409_CONFLICT, "This business account already owns or belongs to a store.")
    invitation = session.execute(text("""
        INSERT INTO store_staff_invitations
          (store_id, invited_email, assigned_role, can_edit_store, invited_by, status, accepted_at)
        VALUES (:store_id, :email, :assigned_role, false, :invited_by, 'pending', NULL)
        ON CONFLICT (store_id, invited_email) DO UPDATE SET
          assigned_role = EXCLUDED.assigned_role, can_edit_store = false,
          invited_by = EXCLUDED.invited_by, status = 'pending', accepted_at = NULL, created_at = now()
        RETURNING id
    """), {"store_id": store_id, "email": email, "assigned_role": request.assigned_role,
             "invited_by": current_user.id}).one()
    session.commit()
    return {"id": invitation.id, "message": f"Invitation sent to {email}."}


@router.put("/stores/{store_id}/staff/{account_id}/permission")
def update_store_staff_permission(store_id: UUID, account_id: UUID, request: StoreStaffPermissionInput,
                                  current_user: AuthenticatedUser = CurrentOwner,
                                  session: Session = Depends(get_db_session)) -> dict:
    _owned_store(session, current_user.id, store_id)
    row = session.execute(text("""
        UPDATE store_staff_memberships SET can_edit_store = :can_edit_store
        WHERE store_id = :store_id AND business_account_id = :account_id
        RETURNING business_account_id
    """), {"store_id": store_id, "account_id": account_id,
             "can_edit_store": request.can_edit_store}).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Staff member not found.")
    session.commit()
    return {"account_id": row.business_account_id, "can_edit_store": request.can_edit_store}


@router.post("/stores", response_model=VendorStore, status_code=status.HTTP_201_CREATED)
def create_store(request: VendorStoreInput, current_user: AuthenticatedUser = CurrentOwner,
                 session: Session = Depends(get_db_session)) -> VendorStore:
    existing = session.execute(text("""
        SELECT 1 FROM stores WHERE business_owner_id = :account_id
        UNION ALL SELECT 1 FROM store_staff_memberships WHERE business_account_id = :account_id
    """), {"account_id": current_user.id}).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "This business account already owns or belongs to a store.")
    payload = request.model_dump()
    payload["operating_hours_schedule"] = json.dumps(payload["operating_hours_schedule"])
    row = session.execute(text("""
        INSERT INTO stores (business_owner_id, store_name, store_address, phone_number, operating_hours,
                            status, description, category, delivery_fee, estimated_delivery_minutes,
                            street_address, postal_code, city, state, country, additional_location_details,
                            contact_email, helpline_phones, icon_url, cover_image_url,
                            operating_hours_schedule, slot_order_limit, slot_item_limit)
        VALUES (:owner_id, :name, :address, :phone_number, :operating_hours, 'pending_approval', :description,
                :category, :delivery_fee, :estimated_delivery_minutes, :street_address, :postal_code, :city,
                :state, :country, :additional_location_details, :contact_email, :helpline_phones, :icon_url, :cover_image_url,
                CAST(:operating_hours_schedule AS jsonb), :slot_order_limit, :slot_item_limit) RETURNING *
    """), {"owner_id": current_user.id, **payload}).one()
    session.commit()
    return _store(row, [])


@router.put("/stores/{store_id}", response_model=VendorStore)
def update_store(store_id: UUID, request: VendorStoreInput, current_user: AuthenticatedUser = CurrentOwner,
                 session: Session = Depends(get_db_session)) -> VendorStore:
    access = _accessible_store(session, current_user.id, store_id, require_profile_edit=True)
    payload = request.model_dump()
    payload["operating_hours_schedule"] = json.dumps(payload["operating_hours_schedule"])
    row = session.execute(text("""
        UPDATE stores SET store_name=:name, phone_number=:phone_number,
          operating_hours=:operating_hours, description=:description, category=:category,
          delivery_fee=:delivery_fee, estimated_delivery_minutes=:estimated_delivery_minutes,
          store_address=:address, street_address=:street_address, postal_code=:postal_code, city=:city,
          state=:state, country=:country, additional_location_details=:additional_location_details,
          contact_email=:contact_email, helpline_phones=:helpline_phones, icon_url=:icon_url, cover_image_url=:cover_image_url,
          slot_order_limit=:slot_order_limit, slot_item_limit=:slot_item_limit,
          operating_hours_schedule=CAST(:operating_hours_schedule AS jsonb)
        WHERE id=:id RETURNING *
    """), {"id": store_id, **payload}).one()
    session.commit()
    products = session.execute(text("SELECT * FROM products WHERE store_id=:store_id ORDER BY product_name"), {"store_id": store_id}).all()
    return _store(row, [_product(product) for product in products], access.is_owner, access.can_edit_store)


@router.get("/stores/{store_id}/holidays")
def list_store_holidays(store_id: UUID, current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> dict:
    _accessible_store(session, current_user.id, store_id)
    rows = session.execute(text("""
        SELECT id,starts_on,ends_on,whole_day,opens_at,closes_at,reason
        FROM store_holiday_closures WHERE store_id=:store_id AND ends_on>=current_date ORDER BY starts_on
    """), {"store_id": store_id}).mappings().all()
    return {"holidays": [dict(row) for row in rows]}


@router.post("/stores/{store_id}/holidays", status_code=status.HTTP_201_CREATED)
def create_store_holiday(store_id: UUID, request: dict, current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> dict:
    _accessible_store(session, current_user.id, store_id, require_profile_edit=True)
    try:
        starts_on, ends_on = date.fromisoformat(str(request.get("starts_on"))), date.fromisoformat(str(request.get("ends_on")))
        whole_day = bool(request.get("whole_day", True))
        opens_at = None if whole_day else time.fromisoformat(str(request.get("opens_at")))
        closes_at = None if whole_day else time.fromisoformat(str(request.get("closes_at")))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose a valid holiday date range and time.")
    reason = str(request.get("reason") or "").strip()
    if len(reason.split()) > 30:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Closure reason cannot exceed 30 words.")
    if starts_on < date.today() or ends_on < starts_on or not reason or (not whole_day and opens_at >= closes_at):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose a valid future date range, operating time, and closure reason.")
    row = session.execute(text("""
        INSERT INTO store_holiday_closures (store_id,starts_on,ends_on,whole_day,opens_at,closes_at,reason)
        VALUES (:store_id,:starts_on,:ends_on,:whole_day,:opens_at,:closes_at,:reason)
        RETURNING id,starts_on,ends_on,whole_day,opens_at,closes_at,reason
    """), {"store_id": store_id, "starts_on": starts_on, "ends_on": ends_on, "whole_day": whole_day, "opens_at": opens_at, "closes_at": closes_at, "reason": reason[:300]}).mappings().one()
    session.commit()
    return dict(row)


@router.delete("/stores/{store_id}/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_store_holiday(store_id: UUID, holiday_id: UUID, current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> None:
    _accessible_store(session, current_user.id, store_id, require_profile_edit=True)
    deleted = session.execute(text("""
        DELETE FROM store_holiday_closures WHERE id=:holiday_id AND store_id=:store_id RETURNING id
    """), {"holiday_id": holiday_id, "store_id": store_id}).scalar_one_or_none()
    if deleted is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Holiday Closing Notice not found.")
    session.commit()


@router.post("/stores/{store_id}/products", response_model=VendorProduct, status_code=status.HTTP_201_CREATED)
def create_product(store_id: UUID, request: VendorProductInput, current_user: AuthenticatedUser = CurrentOwner,
                   session: Session = Depends(get_db_session)) -> VendorProduct:
    _accessible_store(session, current_user.id, store_id, require_approved=True)
    row = session.execute(text("""
        INSERT INTO products (store_id, product_name, description, price, stock_quantity, category, subcategory, unit_label, brand, size_label,
                              image_url, original_price, expiry_date, status, addons, discount)
        VALUES (:store_id, :name, :description, :price, :stock_quantity, :category, :subcategory, :unit_label, :brand, :size,
                :image_url, :original_price, :expiry_date, :status, CAST(:addons AS jsonb),
                CAST(:discount AS jsonb)) RETURNING *
    """), {"store_id": store_id, **request.model_dump(exclude={"addons", "discount"}),
             "addons": json.dumps(request.model_dump(mode="json")["addons"]),
             "discount": json.dumps(request.model_dump(mode="json")["discount"])}).one()
    session.commit()
    return _product(row)


@router.put("/stores/{store_id}/products/{product_id}", response_model=VendorProduct)
def update_product(store_id: UUID, product_id: UUID, request: VendorProductInput,
                   current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> VendorProduct:
    _accessible_store(session, current_user.id, store_id, require_approved=True)
    row = session.execute(text("""
        UPDATE products SET product_name=:name, description=:description, price=:price,
          stock_quantity=:stock_quantity, category=:category, subcategory=:subcategory, unit_label=:unit_label,
          brand=:brand, size_label=:size, image_url=:image_url,
          original_price=:original_price, expiry_date=:expiry_date, status=:status,
          addons=CAST(:addons AS jsonb), discount=CAST(:discount AS jsonb)
        WHERE id=:product_id AND store_id=:store_id RETURNING *
    """), {"product_id": product_id, "store_id": store_id,
             **request.model_dump(exclude={"addons", "discount"}),
             "addons": json.dumps(request.model_dump(mode="json")["addons"]),
             "discount": json.dumps(request.model_dump(mode="json")["discount"])}).one_or_none()
    if row is None:
        session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    session.commit()
    return _product(row)


@router.delete("/stores/{store_id}/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(store_id: UUID, product_id: UUID, current_user: AuthenticatedUser = CurrentOwner,
                   session: Session = Depends(get_db_session)) -> None:
    _accessible_store(session, current_user.id, store_id, require_approved=True)
    referenced = session.execute(text("SELECT 1 FROM cart_items WHERE product_id=:product_id LIMIT 1"), {"product_id": product_id}).first()
    if referenced:
        raise HTTPException(status.HTTP_409_CONFLICT, "This product belongs to a cart or order and cannot be deleted.")
    deleted = session.execute(text("DELETE FROM products WHERE id=:product_id AND store_id=:store_id RETURNING id"), {"product_id": product_id, "store_id": store_id}).one_or_none()
    if deleted is None:
        session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    session.commit()


@router.get("/dashboard")
def dashboard(current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session),
              period: str = "week", year: int | None = None, month: int | None = None) -> dict:
    from app.services.vendor_dashboard import build_dashboard

    store_id = _account_store_id(session, current_user.id)
    return build_dashboard(session, store_id, period, year, month)


@router.get("/orders")
def vendor_orders(current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> dict:
    store_id = _account_store_id(session, current_user.id, require_approved=True)
    rows = session.execute(text("""
        SELECT o.id,:store_id AS store_id,o.order_date,o.order_status AS status,u.name AS customer_name,u.email,u.phone_number,
          o.delivery_address,COALESCE(d.estimated_arrival,o.order_date) AS arrival_at,o.cancellation_reason,
          CASE WHEN o.delivery_address='Customer pickup directly from store' THEN 'pickup' ELSE 'delivery' END AS fulfillment_method,
          CASE WHEN (SELECT COUNT(DISTINCT all_items.store_id)=1 FROM order_items all_items WHERE all_items.order_id=o.id)
               THEN o.total_amount ELSE SUM(item.net_amount) END AS total,
          string_agg(item.product_name||' ×'||item.quantity, ', ' ORDER BY item.product_name) AS items,
          (SELECT COUNT(DISTINCT all_items.store_id)=1 FROM order_items all_items WHERE all_items.order_id=o.id) AS action_supported
        FROM orders o JOIN carts c ON c.id=o.cart_id JOIN users u ON u.id=c.user_id
        JOIN order_items item ON item.order_id=o.id AND item.store_id=:store_id
        JOIN stores s ON s.id=item.store_id
        JOIN payments pay ON pay.order_id=o.id AND pay.payment_status IN ('paid','partially_refunded','refunded')
        LEFT JOIN deliveries d ON d.payment_id=pay.id
        GROUP BY o.id,u.id,c.id,d.estimated_arrival ORDER BY o.order_date DESC
    """), {"store_id": store_id}).mappings().all()
    return {"orders": [dict(row) for row in rows]}


@router.put("/orders/{order_id}/status")
def update_order_status(order_id: UUID, request: dict, current_user: AuthenticatedUser = CurrentOwner,
                        session: Session = Depends(get_db_session)) -> dict:
    store_id = _account_store_id(session, current_user.id, require_approved=True)
    transitions = {"placed": "preparing", "pending": "preparing", "preparing": "ready", "ready": "completed"}
    row = session.execute(text("""
        WITH locked_order AS (
          SELECT * FROM orders WHERE id=:order_id FOR UPDATE
        )
        SELECT o.order_status, c.user_id, MAX(s.store_name) AS store_name, COUNT(DISTINCT s.id) AS store_count,
          BOOL_AND(s.id=:store_id) AS fully_owned,
          EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id=o.id
            AND (pay.paid_at IS NOT NULL OR pay.payment_status IN ('paid', 'partially_refunded', 'refunded', 'disputed'))) AS payment_captured
        FROM locked_order o JOIN carts c ON c.id=o.cart_id JOIN order_items item ON item.order_id=o.id
        JOIN stores s ON s.id=item.store_id WHERE o.id=:order_id GROUP BY o.id,o.order_status,c.user_id
    """), {"order_id": order_id, "store_id": store_id}).one_or_none()
    if row is None or not row.fully_owned or row.store_count != 1:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order is not available for fulfilment.")
    target = request.get("status")
    if target == "cancelled":
        if row.order_status not in {"placed", "pending", "cancellation_pending"}:
            raise HTTPException(status.HTTP_409_CONFLICT, "Orders can only be cancelled before preparation starts.")
        payment = session.execute(text("""
            SELECT id, payment_status, stripe_payment_intent_id FROM payments
            WHERE order_id=:order_id ORDER BY paid_at DESC NULLS LAST LIMIT 1 FOR UPDATE
        """), {"order_id": order_id}).one_or_none()
        if payment is None or payment.payment_status != "paid" or not payment.stripe_payment_intent_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "This order does not have a refundable Stripe payment.")
        if row.order_status != "cancellation_pending":
            session.execute(text("""
                UPDATE orders SET order_status='cancellation_pending',
                    cancellation_reason='Cancelled by the shop before preparation.' WHERE id=:order_id
            """), {"order_id": order_id})
            session.commit()
        try:
            refund = stripe_payments.refund_order_payment(payment_intent_id=payment.stripe_payment_intent_id, order_id=order_id)
        except (stripe_payments.StripeConfigurationError, stripe_payments.StripeOperationError) as error:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
        except Exception:
            logger.exception("Refund request could not be confirmed for order %s", order_id)
            return {"id": order_id, "status": "cancellation_pending"}
        from app.api.v1.endpoints.stripe import _handle_order_cancellation_refund, _push_order_cancellation
        try:
            completed = _handle_order_cancellation_refund(refund, session)
            session.commit()
        except Exception:
            session.rollback()
            logger.exception("Refund finalisation failed for order %s; awaiting Stripe retry", order_id)
            return {"id": order_id, "status": "cancellation_pending"}
        if completed:
            _push_order_cancellation(session, row.user_id, order_id)
        if refund.status in {"failed", "canceled"}:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The refund failed. Contact support before preparing this order.")
        return {"id": order_id, "status": "cancelled" if completed else "cancellation_pending"}
    if transitions.get(row.order_status) != target:
        raise HTTPException(status.HTTP_409_CONFLICT, "Invalid order status transition.")
    session.execute(
        text("""
            UPDATE orders
            SET order_status = :status,
                ready_at = CASE WHEN :mark_ready THEN now() ELSE ready_at END
            WHERE id = :id
        """),
        {"status": target, "mark_ready": target == "ready", "id": order_id},
    )
    alert_message = ORDER_STATUS_ALERTS[target]
    alert_id = session.execute(text("""
        INSERT INTO order_chat_messages
          (order_id, store_id, sender_role, sender_id, sender_name, message_type, body)
        VALUES
          (:order_id, :store_id, 'business_owner', :sender_id, :sender_name, 'delivery_alert', :body)
        RETURNING id
    """), {
        "order_id": order_id, "store_id": store_id, "sender_id": current_user.id,
        "sender_name": current_user.name, "body": alert_message,
    }).scalar_one()
    alert_title = f"Delivery update from {row.store_name}"
    alert_path = f"/marketplace/chat?orderId={order_id}&storeId={store_id}"
    create_notification(
        session, user_id=row.user_id, category="delivery", title=alert_title,
        message=alert_message, source_key=f"chat-delivery-alert:{alert_id}",
        action_path=alert_path,
        metadata={"order_id": str(order_id), "store_id": str(store_id), "alert": target},
    )
    session.commit()
    try:
        send_push_notification(
            session, user_id=row.user_id, title=alert_title,
            message=alert_message, action_path=alert_path,
        )
    except Exception:
        logger.exception("Push notification failed after order %s advanced to %s", order_id, target)
    return {"id": order_id, "status": target}


@router.get("/customers")
def vendor_customers(current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> dict:
    store_id = _account_store_id(session, current_user.id, require_approved=True)
    rows = session.execute(text("""
        WITH purchases AS (
          SELECT c.user_id,COUNT(DISTINCT o.id) AS total_orders,COALESCE(SUM(item.net_amount),0) AS total_spent,
            MIN(o.order_date) AS first_order_at,MAX(o.order_date) AS last_order_at
          FROM carts c JOIN orders o ON o.cart_id=c.id JOIN order_items item ON item.order_id=o.id
          JOIN payments pay ON pay.order_id=o.id AND pay.payment_status='paid'
          WHERE item.store_id=:store_id GROUP BY c.user_id
        )
        SELECT u.id,u.name,u.email,COALESCE(p.total_orders,0) AS total_orders,
          COALESCE(p.total_spent,0) AS total_spent,COALESCE(p.last_order_at,f.created_at) AS logged_at,
          (f.user_id IS NOT NULL) AS favourited
        FROM users u LEFT JOIN purchases p ON p.user_id=u.id
        LEFT JOIN store_favourites f ON f.user_id=u.id AND f.store_id=:store_id
        WHERE p.user_id IS NOT NULL OR f.user_id IS NOT NULL
        ORDER BY logged_at DESC
    """), {"store_id": store_id}).mappings().all()
    return {"customers": [dict(row) for row in rows]}


@router.get("/promotions")
def vendor_promotions(current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> dict:
    store_id = _account_store_id(session, current_user.id, require_approved=True)
    rows = session.execute(text("""
        SELECT pc.id,pc.code,pc.title,pc.description,pc.status,pc.start_date,pc.end_date,pc.usage_limit,
          pc.discount_percent,pc.discount_amount,COUNT(up.user_id) AS assigned,
          COUNT(up.user_id) FILTER (WHERE up.redeemed_at IS NOT NULL) AS redemptions
        FROM promo_codes pc JOIN stores s ON s.id=pc.store_id LEFT JOIN user_promo_codes up ON up.promo_code_id=pc.id
        WHERE s.id=:store_id GROUP BY pc.id ORDER BY pc.end_date
    """), {"store_id": store_id}).mappings().all()
    direct_rows = session.execute(text("""
        SELECT id, product_name, discount FROM products
        WHERE store_id=:store_id AND discount IS NOT NULL AND discount <> 'null'::jsonb
        ORDER BY product_name
    """), {"store_id": store_id}).mappings().all()
    promotions = [{**dict(row), "kind": "coupon"} for row in rows]
    for row in direct_rows:
        discount = row["discount"]
        if not isinstance(discount, dict):
            continue
        promotions.append({
            "id": f"product-{row['id']}", "kind": "direct", "code": None,
            "title": discount.get("promotion_title") or row["product_name"], "description": discount.get("promotion_description") or f"Discount applied automatically to {row['product_name']}.",
            "status": "active", "start_date": discount.get("starts_at"), "end_date": discount.get("ends_at"),
            "usage_limit": None, "redemptions": 0, "discount": discount,
        })
    return {"promotions": promotions}


def _share_promotion(session: Session, *, store_id: UUID, promotion_id: UUID, user_id: UUID, reward_message: str) -> bool:
    promo = session.execute(text("""
        SELECT pc.*,s.store_name FROM promo_codes pc JOIN stores s ON s.id=pc.store_id
        WHERE pc.id=:promotion_id AND pc.store_id=:store_id AND pc.status='active' AND now() BETWEEN pc.start_date AND pc.end_date
    """), {"promotion_id": promotion_id, "store_id": store_id}).mappings().one_or_none()
    if promo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Active promotion code not found.")
    inserted = session.execute(text("""
        INSERT INTO user_promo_codes (user_id,promo_code_id,shared_at,reward_message)
        VALUES (:user_id,:promotion_id,now(),:message)
        ON CONFLICT (user_id,promo_code_id) DO UPDATE SET shared_at=now(),reward_message=EXCLUDED.reward_message,seen_at=NULL
        RETURNING user_id
    """), {"user_id": user_id, "promotion_id": promotion_id, "message": reward_message or "A reward for being an EcoChef shopper."}).scalar_one_or_none()
    message = f"{promo['store_name']} sent you {promo['title']} ({promo['code']})."
    create_notification(session, user_id=user_id, category="promotion", title="You received a voucher", message=message, source_key=f"shared-promo:{promotion_id}:{user_id}:{promo['code']}", action_path="/marketplace", metadata={"promo_code": promo["code"], "store_name": promo["store_name"]})
    return inserted is not None


@router.post("/promotions/{promotion_id}/share")
def share_vendor_promotion(promotion_id: UUID, request: dict, current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> dict:
    store_id = _account_store_id(session, current_user.id, require_approved=True)
    try:
        customer_id = UUID(str(request.get("customer_id")))
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose a customer.")
    if not session.execute(text("SELECT 1 FROM users WHERE id=:id"), {"id": customer_id}).first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found.")
    _share_promotion(session, store_id=store_id, promotion_id=promotion_id, user_id=customer_id, reward_message=str(request.get("reward_message") or "")[:300])
    session.commit()
    return {"message": "Promotion code shared with this customer."}


@router.post("/promotions/{promotion_id}/broadcast")
def broadcast_vendor_promotion(promotion_id: UUID, request: dict, current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> dict:
    store_id = _account_store_id(session, current_user.id, require_approved=True)
    customer_ids = session.execute(text("""
        SELECT DISTINCT c.user_id FROM carts c JOIN orders o ON o.cart_id=c.id JOIN order_items item ON item.order_id=o.id
        JOIN payments pay ON pay.order_id=o.id AND pay.payment_status='paid' WHERE item.store_id=:store_id
        UNION SELECT user_id FROM store_favourites WHERE store_id=:store_id
    """), {"store_id": store_id}).scalars().all()
    for customer_id in customer_ids:
        _share_promotion(session, store_id=store_id, promotion_id=promotion_id, user_id=customer_id, reward_message=str(request.get("reward_message") or "")[:300])
    session.commit()
    return {"message": f"Promotion code shared with {len(customer_ids)} customers.", "count": len(customer_ids)}


@router.post("/promotions", status_code=status.HTTP_201_CREATED)
def create_vendor_promotion(payload: VendorPromotionInput, current_user: AuthenticatedUser = CurrentOwner,
                            session: Session = Depends(get_db_session)) -> dict:
    store = session.execute(text("SELECT id FROM stores WHERE business_owner_id=:owner_id"), {"owner_id": current_user.id}).one_or_none()
    if store is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the store owner can create promotions.")
    if payload.promotion_kind == "direct":
        products = session.execute(text("SELECT id, price FROM products WHERE store_id=:store_id AND id=ANY(:ids)"), {"store_id": store.id, "ids": payload.product_ids}).all()
        if len(products) != len(payload.product_ids):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "One or more selected products are unavailable.")
        if payload.discount_type == "fixed_amount" and any(payload.value >= product.price for product in products):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A fixed discount must be below every selected product price.")
        discount = {"type": payload.discount_type, "starts_at": payload.starts_at.isoformat(), "ends_at": payload.ends_at.isoformat(), "promotion_title": payload.title, "promotion_description": payload.description}
        if payload.discount_type in {"percentage", "fixed_amount"}:
            discount["value"] = float(payload.value)
        else:
            discount.update({"buy_quantity": payload.buy_quantity, "gift_quantity": payload.gift_quantity})
        session.execute(text("UPDATE products SET discount=CAST(:discount AS jsonb) WHERE store_id=:store_id AND id=ANY(:ids)"), {"discount": json.dumps(discount), "store_id": store.id, "ids": payload.product_ids})
    else:
        if session.execute(text("SELECT 1 FROM promo_codes WHERE upper(code)=upper(:code)"), {"code": payload.code}).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "This coupon code is already in use.")
        session.execute(text("""
            INSERT INTO promo_codes (store_id, code, title, description, discount_percent, discount_amount,
              status, start_date, end_date, usage_limit, audience, minimum_order_amount, promotion_type)
            VALUES (:store_id, upper(:code), :title, :description, :discount_percent, :discount_amount,
              'active', :start_date, :end_date, :usage_limit, 'available', :minimum_order_amount, 'discount')
        """), {"store_id": store.id, "code": payload.code, "title": payload.title,
                 "description": payload.description or "Store coupon", "discount_percent": payload.value if payload.discount_type == "percentage" else None,
                 "discount_amount": payload.value if payload.discount_type == "fixed_amount" else None,
                 "start_date": payload.starts_at, "end_date": payload.ends_at,
                 "usage_limit": payload.usage_limit, "minimum_order_amount": payload.minimum_order_amount})
    session.commit()
    return {"message": "Promotion created."}



@router.get("/report-outcomes")
def vendor_report_outcomes(current_user: AuthenticatedUser = CurrentOwner, session: Session = Depends(get_db_session)) -> dict:
    store_id=_account_store_id(session,current_user.id)
    rows=session.execute(text("""SELECT d.id,d.note,d.created_at,i.category,s.store_name
        FROM content_report_decisions d JOIN content_report_issues i ON i.id=d.issue_id
        JOIN stores s ON s.id=i.subject_id AND i.subject_type='store'
        WHERE s.id=:store AND s.business_owner_id=:owner AND d.decision='upheld'
        ORDER BY d.created_at DESC LIMIT 20"""),{"store":store_id,"owner":current_user.id}).mappings().all()
    return {"items":[dict(row) for row in rows]}
