from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import marketplace
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.marketplace import MarketplaceProductReviewInput, MarketplaceProductReviewList


def consumer():
    return AuthenticatedUser(id=uuid4(),firebase_uid="review-user",name="Buyer",email="buyer@example.com",role=AccountRole.consumer)


@pytest.mark.parametrize("rating", [0,6,True,1.5,"5"])
def test_rating_must_be_a_whole_star_from_one_to_five(rating):
    with pytest.raises(ValidationError):
        MarketplaceProductReviewInput(rating=rating)


def test_rating_comment_limits_and_whitespace():
    assert MarketplaceProductReviewInput(rating=5,comment="  helpful feedback  ").comment == "helpful feedback"
    assert MarketplaceProductReviewInput(rating=5,comment="   ").comment is None
    with pytest.raises(ValidationError):
        MarketplaceProductReviewInput(rating=5,comment="x"*2001)


def test_review_is_rejected_without_completed_purchase_of_exact_product():
    session, user, product = Mock(), consumer(), uuid4()
    session.execute.return_value.one_or_none.return_value = None
    with pytest.raises(HTTPException) as error:
        marketplace.write_product_review(product,MarketplaceProductReviewInput(rating=4),user,session)
    assert error.value.status_code == 403
    session.commit.assert_not_called()
    assert session.execute.call_count == 1
    statement, params = session.execute.call_args.args
    assert params == {"user_id":user.id,"product_id":product}
    assert "item.product_id = :product_id" in str(statement)
    assert "cart.user_id = :user_id" in str(statement)
    assert "o.order_status = 'completed'" in str(statement)
    assert "payment.payment_status = 'paid'" in str(statement)
    assert "payment.inventory_deducted_at IS NOT NULL" in str(statement)
    assert "FOR UPDATE OF o, payment" in str(statement)


def test_review_store_and_order_are_derived_from_verified_purchase(monkeypatch):
    session, user, product, store, order = Mock(), consumer(), uuid4(), uuid4(), uuid4()
    session.execute.return_value.one_or_none.return_value = SimpleNamespace(order_id=order,store_id=store,product_name="Apple")
    result = MarketplaceProductReviewList(reviews=[],total=0,rating=Decimal(0),can_review=True)
    monkeypatch.setattr(marketplace,"_product_reviews",lambda *_args:result)
    monkeypatch.setattr(marketplace,"_product_review_state",lambda *_args,**_kwargs:None)
    assert marketplace.write_product_review(product,MarketplaceProductReviewInput(rating=3,comment=" fair "),user,session) is result
    statement, params = session.execute.call_args.args
    assert params == {"user_id":user.id,"product_id":product,"store_id":store,"order_id":order,"rating":3,"comment":"fair"}
    assert "ON CONFLICT (user_id, product_id) DO UPDATE" in str(statement)
    session.commit.assert_called_once_with()


def test_review_prompt_is_scoped_to_consumer_and_completed_paid_items():
    session, user, order, store = Mock(), consumer(), uuid4(), uuid4()
    session.execute.return_value.mappings.return_value.all.return_value = []
    result = marketplace.product_review_prompts(order,store,user,session)
    assert result.items == []
    statement, params = session.execute.call_args.args
    assert params == {"user_id":user.id,"order_id":order,"store_id":store}
    assert "o.order_status='completed'" in str(statement)
    assert "payment.payment_status='paid'" in str(statement)
    assert "payment.inventory_deducted_at IS NOT NULL" in str(statement)
    assert "review.user_id=cart.user_id" in str(statement)
