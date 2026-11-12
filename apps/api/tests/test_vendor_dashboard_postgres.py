"""Vendor summaries use the same period across every module and PDF source."""
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4
from sqlalchemy import text
from sqlalchemy.orm import Session
from test_review_moderation_postgres import review_data
from app.services.vendor_dashboard import build_dashboard
NOW=datetime(2026,11,6,12,tzinfo=timezone.utc)


def _order(s,d,at,status="completed",payment_status="paid",pickup=False,reversed_amount=0,store=None,product=None):
    store=store or d.store; product=product or d.product_a
    cart=s.execute(text("INSERT INTO carts(user_id) VALUES (:user) RETURNING id"),{"user":d.buyer.id}).scalar_one()
    order=s.execute(text("INSERT INTO orders(cart_id,delivery_address,order_status,total_amount,order_date) VALUES (:cart,:address,:status,20,:at) RETURNING id"),{"cart":cart,"address":"Customer pickup directly from store" if pickup else "Test road","status":status,"at":at}).scalar_one()
    s.execute(text("INSERT INTO order_items(order_id,product_id,store_id,product_name,unit_price,quantity,line_total,net_amount) VALUES (:order,:product,:store,'Period apples',10,2,20,20)"),{"order":order,"product":product,"store":store})
    payment=s.execute(text("INSERT INTO payments(order_id,payment_method,amount,payment_status,paid_at,payment_date) VALUES (:order,'stripe',20,:status,CASE WHEN :captured THEN CAST(:at AS timestamptz) ELSE NULL END,:at) RETURNING id"),{"order":order,"status":payment_status,"captured":payment_status!="pending","at":at}).scalar_one()
    if payment_status!="pending":
        s.execute(text("INSERT INTO payment_vendor_allocations(payment_id,store_id,gross_amount,platform_fee_amount,transfer_amount,reversed_amount,transfer_status) VALUES (:pay,:store,20,2,18,:reversed,'pending')"),{"pay":payment,"store":store,"reversed":reversed_amount})
    return order


def test_all_dashboard_sections_share_calendar_period_store_and_refund_rules(review_data):
    d=review_data
    with Session(d.engine) as s:
        s.execute(text("UPDATE orders SET order_date='2024-01-01T00:00:00Z' WHERE id=:id"),{"id":d.completed_order})
        _order(s,d,"2025-01-31T15:59:59Z")
        first=_order(s,d,"2025-01-31T16:00:00Z")
        active=_order(s,d,"2025-02-04T10:00:00Z",status="preparing",payment_status="partially_refunded",pickup=True,reversed_amount=3,product=d.product_b)
        _order(s,d,"2025-02-05T10:00:00Z",payment_status="refunded",reversed_amount=18)
        _order(s,d,"2025-02-06T10:00:00Z",status="cancelled")
        _order(s,d,"2025-02-07T10:00:00Z",status="pending_payment",payment_status="pending")
        _order(s,d,"2025-02-28T16:00:00Z")
        other_owner=s.execute(text("INSERT INTO business_owners(name,email,firebase_uid) VALUES ('Another owner',:email,:uid) RETURNING id"),{"email":f"{uuid4()}@example.com","uid":str(uuid4())}).scalar_one()
        other=s.execute(text("INSERT INTO stores(business_owner_id,store_name,store_address,status) VALUES (:owner,'Other store','Test','approved') RETURNING id"),{"owner":other_owner}).scalar_one()
        _order(s,d,"2025-02-05T10:00:00Z",store=other)
        s.execute(text("INSERT INTO product_reviews(user_id,product_id,store_id,order_id,rating,comment,date_submitted) VALUES (:user,:product,:store,:order,4,'In February','2025-02-01T00:00:00Z')"),{"user":d.buyer.id,"product":d.product_a,"store":d.store,"order":first})
        s.execute(text("INSERT INTO product_reviews(user_id,product_id,store_id,order_id,rating,comment,date_submitted) VALUES (:user,:product,:store,:order,1,'Outside February','2025-03-01T00:00:00Z')"),{"user":d.reader.id,"product":d.product_a,"store":d.store,"order":first})
        s.execute(text("INSERT INTO promo_codes(store_id,code,title,description,discount_percent,status,start_date,end_date) VALUES (:store,:code,'Audit coupon','Audit description',10,'active','2025-02-01T00:00:00Z','2025-02-15T00:00:00Z')"),{"store":d.store,"code":"AUDIT-"+uuid4().hex[:20]})
        s.commit()
        result=build_dashboard(s,d.store,"month",2025,2,NOW)
        assert result["summary"]=={"revenue":Decimal(33),"sales":Decimal(40),"orders":4,"products":2,"deals":1}
        assert len(result["revenue"])==28 and sum(row["amount"] for row in result["revenue"])==Decimal(33)
        assert result["revenue"][0]["day"].isoformat()=="2025-02-01" and result["revenue"][0]["amount"]==Decimal(18)
        assert result["order_summary"]=={"completed":2,"cancelled":1,"refunded":1,"active":1,"delivery":3,"pickup":1,"customer_count":1,"items_sold":4}
        assert [row["id"] for row in result["live_orders"]]==[active]
        assert len(result["top_products"])==2 and sum(row["sold"] for row in result["top_products"])==4
        assert result["review_summary"]=={"rating":Decimal(4),"count":1}
        assert [row["comment"] for row in result["reviews"]]==["In February"]
        assert result["inventory"]["listed"]==2 and result["period"]["end_date"]=="2025-02-28"
        assert result["report_years"]==[2026,2025,2024]
        year=build_dashboard(s,d.store,"year",2025,now=NOW)
        assert len(year["revenue"])==12 and sum(row["amount"] for row in year["revenue"])==year["summary"]["revenue"]
        assert year["review_summary"]["count"]==2


def test_empty_period_has_zero_totals_zero_axis_and_current_snapshot(review_data):
    d=review_data
    with Session(d.engine) as s:
        result=build_dashboard(s,d.store,"month",2020,2,NOW)
        assert result["summary"]=={"revenue":0,"sales":0,"orders":0,"products":0,"deals":0}
        assert len(result["revenue"])==29 and all(row["amount"]==0 for row in result["revenue"])
        assert result["review_summary"]["count"]==0 and not result["reviews"] and not result["top_products"] and not result["live_orders"]
        assert result["inventory"]["listed"]==2


def test_renamed_products_rank_once_and_future_events_do_not_enter_current_period(review_data):
    d=review_data
    with Session(d.engine) as s:
        s.execute(text("UPDATE orders SET order_date='2024-01-01T00:00:00Z' WHERE id=:id"),{"id":d.completed_order})
        first=_order(s,d,"2026-11-06T10:00:00Z")
        second=_order(s,d,"2026-11-06T11:00:00Z")
        _order(s,d,"2026-11-06T12:01:00Z")  # after report generation time
        s.execute(text("UPDATE order_items SET product_name='Previous apple name' WHERE order_id=:order"),{"order":first})
        s.execute(text("UPDATE products SET product_name='Current apple name' WHERE id=:product"),{"product":d.product_a})
        s.execute(text("INSERT INTO product_reviews(user_id,product_id,store_id,order_id,rating,date_submitted) VALUES (:user,:product,:store,:order,5,'2026-11-06T12:01:00Z')"),{"user":d.buyer.id,"product":d.product_a,"store":d.store,"order":second})
        s.commit()
        for period in ("today","week","month"):
            result=build_dashboard(s,d.store,period,now=NOW)
            assert result["summary"]["orders"]==2 and result["summary"]["revenue"]==Decimal(36)
            assert len(result["top_products"])==1
            assert result["top_products"][0]["name"]=="Current apple name" and result["top_products"][0]["sold"]==4
            assert result["review_summary"]["count"]==0 and not result["reviews"]
