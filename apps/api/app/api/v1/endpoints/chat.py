import base64
import binascii
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.modules.notifications.service import create_notification, send_push_notification
from app.schemas.auth import AccountRole, AuthenticatedUser


router = APIRouter()
CurrentChatUser = Depends(require_roles(AccountRole.consumer, AccountRole.business_owner))
MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALERT_LABELS = {
    "preparing": "The shop is preparing your order.",
    "ready": "Your order is ready.",
    "out_for_delivery": "Your order is out for delivery.",
    "arriving": "Your order is arriving soon.",
    "delayed": "Your delivery has been delayed. The shop will keep you updated.",
    "delivered": "The shop has marked your order as delivered.",
}


class ChatMessageInput(BaseModel):
    message_type: Literal["text", "photo", "pdf"]
    body: str | None = Field(default=None, max_length=2000)
    attachment_name: str | None = Field(default=None, max_length=255)
    attachment_content_type: str | None = Field(default=None, max_length=100)
    attachment_data: str | None = None

    @model_validator(mode="after")
    def validate_message(self) -> "ChatMessageInput":
        if self.message_type == "text":
            if not (self.body or "").strip():
                raise ValueError("Enter a message.")
            if self.attachment_data or self.attachment_name or self.attachment_content_type:
                raise ValueError("Text messages cannot include an attachment.")
            return self
        if not self.attachment_data or not self.attachment_name or not self.attachment_content_type:
            raise ValueError("Choose a file to send.")
        if self.message_type == "photo" and self.attachment_content_type not in PHOTO_TYPES:
            raise ValueError("Photos must be JPEG, PNG, or WebP.")
        if self.message_type == "pdf" and self.attachment_content_type != "application/pdf":
            raise ValueError("Documents must be PDF files.")
        return self


class TypingInput(BaseModel):
    typing: bool


class DeliveryAlertInput(BaseModel):
    alert: Literal["preparing", "ready", "out_for_delivery", "arriving", "delayed", "delivered"]
    note: str | None = Field(default=None, max_length=300)


def _conversation_access(
    session: Session,
    current_user: AuthenticatedUser,
    order_id: UUID,
    store_id: UUID,
) -> object:
    row = session.execute(
        text("""
        SELECT o.id AS order_id, o.order_status, c.user_id, u.name AS customer_name,
               s.id AS store_id, s.store_name, s.icon_url,
               EXISTS (
                   SELECT 1 FROM payments pay
                   WHERE pay.order_id=o.id AND pay.payment_status='paid'
               ) AS is_paid,
               EXISTS (
                   SELECT 1 FROM order_items item
                   WHERE item.order_id=o.id AND item.store_id=s.id
               ) AS includes_store,
               (s.business_owner_id=:account_id OR EXISTS (
                   SELECT 1 FROM store_staff_memberships membership
                   WHERE membership.store_id=s.id AND membership.business_account_id=:account_id
               )) AS business_access
        FROM orders o
        JOIN carts c ON c.id=o.cart_id
        JOIN users u ON u.id=c.user_id
        JOIN stores s ON s.id=:store_id
        WHERE o.id=:order_id
    """),
        {"order_id": order_id, "store_id": store_id, "account_id": current_user.id},
    ).one_or_none()
    if row is None or not row.is_paid or not row.includes_store:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This paid-order conversation is not available."
        )
    if current_user.role == AccountRole.consumer and row.user_id != current_user.id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This paid-order conversation is not available."
        )
    if current_user.role == AccountRole.business_owner and not row.business_access:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This paid-order conversation is not available."
        )
    return row


def _message_payload(row: object, order_id: UUID, store_id: UUID) -> dict:
    has_attachment = bool(row.attachment_content_type)
    attachment_bytes = getattr(row, "attachment_data", None)
    return {
        "id": row.id,
        "sender_role": row.sender_role,
        "sender_name": row.sender_name,
        "message_type": row.message_type,
        "body": row.body,
        "attachment_name": row.attachment_name,
        "attachment_content_type": row.attachment_content_type,
        "attachment_url": (
            f"/api/v1/chats/orders/{order_id}/stores/{store_id}/messages/{row.id}/attachment"
            if has_attachment
            else None
        ),
        "attachment_data": base64.b64encode(bytes(attachment_bytes)).decode("ascii")
        if attachment_bytes
        else None,
        "created_at": row.created_at,
    }


@router.get("/orders/{order_id}")
def list_order_conversations(
    order_id: UUID,
    current_user: AuthenticatedUser = CurrentChatUser,
    session: Session = Depends(get_db_session),
) -> dict:
    if current_user.role != AccountRole.consumer:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Customer order chat list only.")
    rows = (
        session.execute(
            text("""
        SELECT DISTINCT s.id AS store_id, s.store_name, s.icon_url
        FROM orders o
        JOIN carts c ON c.id=o.cart_id
        JOIN payments pay ON pay.order_id=o.id AND pay.payment_status='paid'
        JOIN order_items item ON item.order_id=o.id
        JOIN stores s ON s.id=item.store_id
        WHERE o.id=:order_id AND c.user_id=:user_id
        ORDER BY s.store_name
    """),
            {"order_id": order_id, "user_id": current_user.id},
        )
        .mappings()
        .all()
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat opens after this order has been paid.")
    return {"order_id": order_id, "stores": [dict(row) for row in rows]}


@router.get("/orders/{order_id}/stores/{store_id}")
def get_conversation(
    order_id: UUID,
    store_id: UUID,
    current_user: AuthenticatedUser = CurrentChatUser,
    session: Session = Depends(get_db_session),
) -> dict:
    conversation = _conversation_access(session, current_user, order_id, store_id)
    rows = session.execute(
        text("""
        SELECT id,sender_role,sender_name,message_type,body,attachment_name,
               attachment_content_type,attachment_data,created_at
        FROM order_chat_messages
        WHERE order_id=:order_id AND store_id=:store_id
        ORDER BY created_at,id
        LIMIT 500
    """),
        {"order_id": order_id, "store_id": store_id},
    ).all()
    other_role = "business_owner" if current_user.role == AccountRole.consumer else "consumer"
    other_typing = bool(
        session.execute(
            text("""
        SELECT 1 FROM order_chat_typing
        WHERE order_id=:order_id AND store_id=:store_id
          AND sender_role=:other_role AND expires_at > now()
        LIMIT 1
    """),
            {"order_id": order_id, "store_id": store_id, "other_role": other_role},
        ).first()
    )
    return {
        "order_id": order_id,
        "store_id": store_id,
        "store_name": conversation.store_name,
        "store_icon_url": conversation.icon_url,
        "customer_name": conversation.customer_name,
        "order_status": conversation.order_status,
        "messages": [_message_payload(row, order_id, store_id) for row in rows],
        "other_typing": other_typing,
    }


@router.post("/orders/{order_id}/stores/{store_id}/messages", status_code=status.HTTP_201_CREATED)
def send_message(
    order_id: UUID,
    store_id: UUID,
    request: ChatMessageInput,
    current_user: AuthenticatedUser = CurrentChatUser,
    session: Session = Depends(get_db_session),
) -> dict:
    _conversation_access(session, current_user, order_id, store_id)
    attachment: bytes | None = None
    if request.attachment_data:
        if len(request.attachment_data) > (MAX_ATTACHMENT_BYTES * 4 // 3) + 8:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Attachments must be 8 MB or smaller."
            )
        try:
            attachment = base64.b64decode(request.attachment_data, validate=True)
        except (ValueError, binascii.Error) as error:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "The attachment data is invalid."
            ) from error
        if len(attachment) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Attachments must be 8 MB or smaller."
            )
    row = session.execute(
        text("""
        INSERT INTO order_chat_messages
          (order_id,store_id,sender_role,sender_id,sender_name,message_type,body,
           attachment_name,attachment_content_type,attachment_data)
        VALUES
          (:order_id,:store_id,:sender_role,:sender_id,:sender_name,:message_type,:body,
           :attachment_name,:attachment_content_type,:attachment_data)
        RETURNING id,sender_role,sender_name,message_type,body,attachment_name,
                  attachment_content_type,attachment_data,created_at
    """),
        {
            "order_id": order_id,
            "store_id": store_id,
            "sender_role": current_user.role.value,
            "sender_id": current_user.id,
            "sender_name": current_user.name,
            "message_type": request.message_type,
            "body": (request.body or "").strip() or None,
            "attachment_name": request.attachment_name,
            "attachment_content_type": request.attachment_content_type,
            "attachment_data": attachment,
        },
    ).one()
    session.execute(
        text("""
        DELETE FROM order_chat_typing
        WHERE order_id=:order_id AND store_id=:store_id AND sender_role=:sender_role AND sender_id=:sender_id
    """),
        {
            "order_id": order_id,
            "store_id": store_id,
            "sender_role": current_user.role.value,
            "sender_id": current_user.id,
        },
    )
    session.commit()
    return _message_payload(row, order_id, store_id)


@router.put("/orders/{order_id}/stores/{store_id}/typing")
def set_typing(
    order_id: UUID,
    store_id: UUID,
    request: TypingInput,
    current_user: AuthenticatedUser = CurrentChatUser,
    session: Session = Depends(get_db_session),
) -> dict:
    _conversation_access(session, current_user, order_id, store_id)
    if request.typing:
        session.execute(
            text("""
            INSERT INTO order_chat_typing (order_id,store_id,sender_role,sender_id,expires_at)
            VALUES (:order_id,:store_id,:sender_role,:sender_id,now() + interval '4 seconds')
            ON CONFLICT (order_id,store_id,sender_role,sender_id)
            DO UPDATE SET expires_at=EXCLUDED.expires_at
        """),
            {
                "order_id": order_id,
                "store_id": store_id,
                "sender_role": current_user.role.value,
                "sender_id": current_user.id,
            },
        )
    else:
        session.execute(
            text("""
            DELETE FROM order_chat_typing
            WHERE order_id=:order_id AND store_id=:store_id AND sender_role=:sender_role AND sender_id=:sender_id
        """),
            {
                "order_id": order_id,
                "store_id": store_id,
                "sender_role": current_user.role.value,
                "sender_id": current_user.id,
            },
        )
    session.commit()
    return {"typing": request.typing}


@router.post(
    "/orders/{order_id}/stores/{store_id}/delivery-alert", status_code=status.HTTP_201_CREATED
)
def send_delivery_alert(
    order_id: UUID,
    store_id: UUID,
    request: DeliveryAlertInput,
    current_user: AuthenticatedUser = CurrentChatUser,
    session: Session = Depends(get_db_session),
) -> dict:
    if current_user.role != AccountRole.business_owner:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the business owner can send delivery alerts."
        )
    conversation = _conversation_access(session, current_user, order_id, store_id)
    message = ALERT_LABELS[request.alert]
    if (request.note or "").strip():
        message = f"{message} {(request.note or '').strip()}"
    row = session.execute(
        text("""
        INSERT INTO order_chat_messages
          (order_id,store_id,sender_role,sender_id,sender_name,message_type,body)
        VALUES (:order_id,:store_id,'business_owner',:sender_id,:sender_name,'delivery_alert',:body)
        RETURNING id,sender_role,sender_name,message_type,body,attachment_name,
                  attachment_content_type,attachment_data,created_at
    """),
        {
            "order_id": order_id,
            "store_id": store_id,
            "sender_id": current_user.id,
            "sender_name": current_user.name,
            "body": message,
        },
    ).one()
    title = f"Delivery update from {conversation.store_name}"
    create_notification(
        session,
        user_id=conversation.user_id,
        category="delivery",
        title=title,
        message=message,
        source_key=f"chat-delivery-alert:{row.id}",
        action_path=f"/marketplace/chat?orderId={order_id}&storeId={store_id}",
        metadata={"order_id": str(order_id), "store_id": str(store_id), "alert": request.alert},
    )
    session.commit()
    send_push_notification(
        session,
        user_id=conversation.user_id,
        title=title,
        message=message,
        action_path=f"/marketplace/chat?orderId={order_id}&storeId={store_id}",
    )
    return _message_payload(row, order_id, store_id)


@router.get("/orders/{order_id}/stores/{store_id}/messages/{message_id}/attachment")
def get_attachment(
    order_id: UUID,
    store_id: UUID,
    message_id: UUID,
    current_user: AuthenticatedUser = CurrentChatUser,
    session: Session = Depends(get_db_session),
) -> Response:
    _conversation_access(session, current_user, order_id, store_id)
    row = session.execute(
        text("""
        SELECT attachment_data,attachment_content_type,attachment_name
        FROM order_chat_messages
        WHERE id=:message_id AND order_id=:order_id AND store_id=:store_id
    """),
        {"message_id": message_id, "order_id": order_id, "store_id": store_id},
    ).one_or_none()
    if row is None or row.attachment_data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found.")
    safe_name = (row.attachment_name or "attachment").replace('"', "")
    return Response(
        content=bytes(row.attachment_data),
        media_type=row.attachment_content_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )
