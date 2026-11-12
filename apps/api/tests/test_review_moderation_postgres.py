"""Real review/moderation journeys, restricted to a disposable audit database."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
import os
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.api.v1.endpoints import marketplace, recipes, reports
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.marketplace import MarketplaceProductReviewInput
from app.schemas.recipes import RecipeFeedbackFlagInput, RecipeReviewInput, RecipeScheduleInput
from app.schemas.reports import ContentReportInput, FeedbackFlagDecision, ReportDecision


def _consumer(connection, name):
    uid = str(uuid4())
    email = f"{uid}@example.com"
    user_id = connection.execute(text("""
        INSERT INTO users(name,email,firebase_uid) VALUES (:name,:email,:uid) RETURNING id
    """), {"name": name, "email": email, "uid": uid}).scalar_one()
    return AuthenticatedUser(id=user_id, firebase_uid=uid, name=name, email=email, role=AccountRole.consumer)


def _purchase(session, user_id, product_id, store_id, order_status="completed", payment_status="paid", captured=True):
    cart = session.execute(text("INSERT INTO carts(user_id) VALUES (:user) RETURNING id"), {"user": user_id}).scalar_one()
    order = session.execute(text("""
        INSERT INTO orders(cart_id,delivery_address,order_status,total_amount)
        VALUES (:cart,'Audit street',:status,2) RETURNING id
    """), {"cart": cart, "status": order_status}).scalar_one()
    session.execute(text("""
        INSERT INTO order_items(order_id,product_id,store_id,product_name,unit_price,quantity,line_total,discount_amount,net_amount)
        VALUES (:order,:product,:store,'Audit product',1,2,2,0,2)
    """), {"order": order, "product": product_id, "store": store_id})
    session.execute(text("""
        INSERT INTO payments(order_id,payment_method,amount,payment_status,inventory_deducted_at)
        VALUES (:order,'stripe',2,:status,CASE WHEN :captured THEN now() ELSE NULL END)
    """), {"order": order, "status": payment_status, "captured": captured})
    session.commit()
    return order


@pytest.fixture
def review_data():
    url = os.environ.get("ECOCHEF_AUDIT_DATABASE_URL")
    if not url:
        pytest.skip("Requires a fresh isolated PostgreSQL audit database")
    parsed = make_url(url)
    assert parsed.host == "127.0.0.1" and parsed.port == 55439
    assert parsed.database.startswith("ecochef_audit_")
    engine = create_engine(url)
    with engine.begin() as connection:
        author, buyer, reader, third = [_consumer(connection, name) for name in ("Recipe author", "Verified buyer", "Other reader", "Third reader")]
        owner = connection.execute(text("""
            INSERT INTO business_owners(name,email,firebase_uid)
            VALUES ('Audit owner',:email,:uid) RETURNING id
        """), {"email": f"{uuid4()}@example.com", "uid": str(uuid4())}).scalar_one()
        store = connection.execute(text("""
            INSERT INTO stores(business_owner_id,store_name,store_address,status)
            VALUES (:owner,'Review audit shop','Audit street','approved') RETURNING id
        """), {"owner": owner}).scalar_one()
        products = [connection.execute(text("""
            INSERT INTO products(store_id,product_name,price,stock_quantity,status)
            VALUES (:store,:name,1,100,'active') RETURNING id
        """), {"store": store, "name": name}).scalar_one() for name in ("Product A", "Product B")]
        recipe = connection.execute(text("""
            INSERT INTO recipes(user_id,title,instructions,prep_time,cook_time,servings,is_published)
            VALUES (:author,'Review audit lemonade','Mix and serve.',5,0,1,true) RETURNING id
        """), {"author": author.id}).scalar_one()
        moderator_id = connection.execute(text("""
            INSERT INTO administrators(access_level,name,email,firebase_uid)
            VALUES ('super_admin','Audit moderator',:email,:uid) RETURNING id
        """), {"email": f"{uuid4()}@example.com", "uid": str(uuid4())}).scalar_one()
    moderator = AuthenticatedUser(id=moderator_id,firebase_uid=str(uuid4()),name="Audit moderator",email="audit-moderator@example.com",role=AccountRole.administrator)
    with Session(engine) as session:
        completed_order = _purchase(session, buyer.id, products[0], store)
    yield SimpleNamespace(engine=engine,author=author,buyer=buyer,reader=reader,third=third,
        moderator=moderator,store=store,product_a=products[0],product_b=products[1],recipe=recipe,completed_order=completed_order)
    engine.dispose()


def test_completed_product_purchase_is_scoped_to_the_exact_product_and_buyer(review_data):
    data = review_data
    with Session(data.engine) as session:
        result = marketplace.write_product_review(data.product_a, MarketplaceProductReviewInput(rating=5,comment="Fresh and exactly as described."), data.buyer, session)
        assert result.my_review.rating == 5
        for user, product in ((data.buyer,data.product_b),(data.reader,data.product_a)):
            with pytest.raises(HTTPException) as error:
                marketplace.write_product_review(product, MarketplaceProductReviewInput(rating=1), user, session)
            assert error.value.status_code == 403
            session.rollback()
        # Updating an existing verified review does not count as another rating.
        result = marketplace.write_product_review(data.product_a, MarketplaceProductReviewInput(rating=4), data.buyer, session)
        assert result.total == 1 and result.my_review.rating == 4
        prompts = marketplace.product_review_prompts(None, None, data.buyer, session)
        assert [item.product_id for item in prompts.items] == [data.product_a]
        assert prompts.items[0].reviewed is True
        _purchase(session, data.reader.id, data.product_b, data.store)
        marketplace.write_product_review(data.product_b, MarketplaceProductReviewInput(rating=2), data.reader, session)
        store = marketplace.marketplace_store(data.store, None, None, None, data.reader, session)
        assert store.rating == Decimal("3.00") and store.review_count == 2
        store_reviews = marketplace.marketplace_reviews(data.store,data.buyer,session)
        assert {item.product_id for item in store_reviews.reviews} == {data.product_a,data.product_b}


@pytest.mark.parametrize("order_status,payment_status,captured", [
    ("pending_payment","pending",False),
    ("ready","paid",True),
    ("completed","pending",False),
    ("completed","paid",False),
])
def test_incomplete_unpaid_or_uncaptured_orders_cannot_unlock_product_reviews(review_data,order_status,payment_status,captured):
    data = review_data
    with Session(data.engine) as session:
        _purchase(session,data.buyer.id,data.product_b,data.store,order_status,payment_status,captured)
        with pytest.raises(HTTPException) as error:
            marketplace.write_product_review(data.product_b,MarketplaceProductReviewInput(rating=5),data.buyer,session)
        assert error.value.status_code == 403
        assert marketplace.product_reviews(data.product_b,data.buyer,session).can_review is False


def test_recipe_feedback_requires_cook_or_schedule_and_authors_cannot_review_themselves(review_data):
    data = review_data
    with Session(data.engine) as session:
        with pytest.raises(HTTPException) as error:
            recipes.review_recipe(data.recipe,RecipeReviewInput(rating=5),data.buyer,session)
        assert error.value.status_code == 403
        session.rollback()
        recipes.start_recipe_cooking(data.recipe,data.buyer,session)
        cooked = recipes.review_recipe(data.recipe,RecipeReviewInput(rating=5,comment="Worked well."),data.buyer,session)
        recipes.schedule_recipe(data.recipe,RecipeScheduleInput(scheduled_date=date.today()+timedelta(days=1),meal_slot="lunch"),data.reader,session)
        scheduled = recipes.review_recipe(data.recipe,RecipeReviewInput(rating=3,comment="I would use less sugar."),data.reader,session)
        assert cooked.user_id == data.buyer.id and scheduled.user_id == data.reader.id
        actions = dict(session.execute(text("SELECT user_id,first_action FROM recipe_review_eligibility WHERE recipe_id=:recipe"),{"recipe":data.recipe}).all())
        assert actions[data.buyer.id] == "cook_now" and actions[data.reader.id] == "schedule_later"
        recipes.start_recipe_cooking(data.recipe,data.author,session)
        with pytest.raises(HTTPException) as error:
            recipes.review_recipe(data.recipe,RecipeReviewInput(rating=5),data.author,session)
        assert error.value.status_code == 400


def _report(data,user,category="misinformation",subject_type="recipe"):
    return ContentReportInput(subject_type=subject_type,subject_id=data.recipe if subject_type=="recipe" else data.store,
        category=category,description=f"Specific evidence from {user.name} for moderator review.")


def test_reports_group_by_subject_and_category_without_purchase_or_recipe_eligibility(review_data):
    data = review_data
    with Session(data.engine) as session:
        submitted = [reports.submit_report(_report(data,user),user,session) for user in (data.buyer,data.reader,data.third)]
        assert len({item["issue_id"] for item in submitted}) == 1
        another = reports.submit_report(_report(data,data.reader,"other"),data.reader,session)
        assert another["issue_id"] != submitted[0]["issue_id"]
        shop = reports.submit_report(_report(data,data.third,subject_type="store"),data.third,session)
        assert shop["status"] == "pending"  # Third reader has never purchased anything.
        assert session.execute(text("SELECT count(*) FROM recipe_review_eligibility WHERE recipe_id=:recipe"),{"recipe":data.recipe}).scalar_one() == 0
        queue = reports.moderation_queue("pending",data.moderator,session)
        issue = next(item for item in queue["issues"] if item["id"] == submitted[0]["issue_id"])
        assert issue["report_count"] == 3 and len(issue["reports"]) == 3
        assert len({item["reporter_name"] for item in issue["reports"]}) == 3
        with pytest.raises(HTTPException) as duplicate:
            reports.submit_report(_report(data,data.reader),data.reader,session)
        assert duplicate.value.status_code == 409


def test_concurrent_reports_create_one_issue_and_keep_every_reporter(review_data):
    data = review_data
    barrier = Barrier(3)
    def submit(user):
        with Session(data.engine) as session:
            session.execute(text("SET LOCAL lock_timeout='5s'"))
            barrier.wait(timeout=5)
            return reports.submit_report(_report(data,user),user,session)
    with ThreadPoolExecutor(max_workers=3) as pool:
        result = list(pool.map(submit,(data.buyer,data.reader,data.third)))
    assert len({item["issue_id"] for item in result}) == 1
    with Session(data.engine) as session:
        assert session.execute(text("SELECT count(*) FROM content_reports WHERE issue_id=:issue"),{"issue":result[0]["issue_id"]}).scalar_one() == 3


def test_report_decisions_notify_reporters_and_reopening_preserves_previous_outcomes(review_data):
    data = review_data
    with Session(data.engine) as session:
        original = [reports.submit_report(_report(data,user),user,session) for user in (data.buyer,data.reader,data.third)]
        issue_id = original[0]["issue_id"]
        note = "The published statement conflicts with the evidence supplied."
        decided = reports.decide_report_issue(issue_id,ReportDecision(decision="upheld",note=note,expected_pending_count=3),data.moderator,session)
        assert decided["reports_resolved"] == 3
        for user, report in zip((data.buyer,data.reader,data.third),original):
            mine = reports.my_reports(user,session)["reports"]
            outcome = next(item for item in mine if item["id"]==report["id"])
            assert outcome["status"] == "upheld" and outcome["resolution_note"] == note
        assert session.execute(text("SELECT count(*) FROM notifications WHERE user_id IN (:one,:two,:three) AND category='moderation'"),{"one":data.buyer.id,"two":data.reader.id,"three":data.third.id}).scalar_one() == 3
        later = reports.submit_report(_report(data,data.author),data.author,session)
        assert later["issue_id"] == issue_id
        result = reports.decide_report_issue(issue_id,ReportDecision(decision="dismissed",note="The newer report does not provide evidence for its claim.",expected_pending_count=1),data.moderator,session)
        assert result["reports_resolved"] == 1
        states = session.execute(text("SELECT status,count(*) FROM content_reports WHERE issue_id=:issue GROUP BY status"),{"issue":issue_id}).all()
        assert dict(states) == {"upheld":3,"dismissed":1}
        assert session.execute(text("SELECT count(*) FROM content_report_decisions WHERE issue_id=:issue"),{"issue":issue_id}).scalar_one() == 2


@pytest.mark.parametrize("decision",["dismissed","removed"])
def test_recipe_author_flags_are_decided_by_moderator_and_outcomes_visible_to_both_users(review_data,decision):
    data = review_data
    with Session(data.engine) as session:
        for user, rating in ((data.buyer,5),(data.reader,1)):
            recipes.start_recipe_cooking(data.recipe,user,session)
            feedback = recipes.review_recipe(data.recipe,RecipeReviewInput(rating=rating,comment="This is my detailed experience."),user,session)
        assert recipes.get_recipe(data.recipe,data.reader,session).average_rating == 3
        with pytest.raises(HTTPException) as forbidden:
            recipes.flag_recipe_feedback(data.recipe,feedback.id,RecipeFeedbackFlagInput(description="I disagree with this accusation."),data.buyer,session)
        assert forbidden.value.status_code == 403
        session.rollback()
        flag = recipes.flag_recipe_feedback(data.recipe,feedback.id,RecipeFeedbackFlagInput(description="The reviewer alleges an ingredient that the recipe does not contain."),data.author,session)
        queue = reports.moderation_queue("pending",data.moderator,session)
        queued = next(item for item in queue["feedback_flags"] if item["id"]==flag["id"])
        assert queued["comment"] == feedback.comment and queued["reviewer_id"] == data.reader.id
        note = "The available recipe and feedback evidence support this moderation decision."
        reports.decide_feedback_flag(flag["id"],FeedbackFlagDecision(decision=decision,note=note),data.moderator,session)
        detail = recipes.get_recipe(data.recipe,data.reader,session)
        assert detail.my_feedback_status == decision and detail.my_feedback_resolution == note
        assert detail.average_rating == (5 if decision=="removed" else 3)
        assert (feedback.id in {item.id for item in detail.reviews}) is (decision=="dismissed")
        notices = session.execute(text("SELECT user_id,message FROM notifications WHERE source_key=:key"),{"key":f'feedback-flag-decision:{flag["id"]}'}).all()
        assert {item.user_id for item in notices} == {data.author.id,data.reader.id}
        assert all(note in item.message for item in notices)
        assert session.execute(text("SELECT count(*) FROM administrator_action_logs WHERE entity_id=:id"),{"id":flag["id"]}).scalar_one() == 1


def test_decision_cannot_cover_new_reports_moderator_has_not_seen(review_data):
    data = review_data
    with Session(data.engine) as session:
        first = reports.submit_report(_report(data,data.buyer),data.buyer,session)
        reports.submit_report(_report(data,data.reader),data.reader,session)
        with pytest.raises(HTTPException) as conflict:
            reports.decide_report_issue(first["issue_id"],ReportDecision(decision="dismissed",note="The statement needs more supporting evidence.",expected_pending_count=1),data.moderator,session)
        assert conflict.value.status_code == 409
        assert session.execute(text("SELECT count(*) FROM content_reports WHERE issue_id=:id AND status='pending'"),{"id":first["issue_id"]}).scalar_one() == 2
        session.rollback()



def test_unverified_legacy_recipe_feedback_is_private_until_authorized_resubmission(review_data):
    data = review_data
    with Session(data.engine) as session:
        session.execute(text("INSERT INTO recipe_feedback(recipe_id,user_id,rating,comment) VALUES (:recipe,:user,1,'Saved legacy feedback')"),{"recipe":data.recipe,"user":data.reader.id})
        session.commit()
        detail = recipes.get_recipe(data.recipe,data.reader,session)
        assert detail.my_feedback_status == "unverified"
        assert detail.my_feedback_comment == "Saved legacy feedback"
        assert not detail.reviews and detail.average_rating is None
        recipes.start_recipe_cooking(data.recipe,data.reader,session)
        recipes.review_recipe(data.recipe,RecipeReviewInput(rating=4,comment="Verified after using the cooking flow."),data.reader,session)
        detail = recipes.get_recipe(data.recipe,data.buyer,session)
        assert len(detail.reviews) == 1 and detail.average_rating == 4


def test_grouped_moderation_search_and_pagination_keep_correct_issue_totals(review_data):
    data = review_data
    with Session(data.engine) as session:
        tag = uuid4().hex
        session.execute(text("UPDATE recipes SET title=:name WHERE id=:id"),{"name":f"{tag} recipe","id":data.recipe})
        session.execute(text("UPDATE stores SET store_name=:name WHERE id=:id"),{"name":f"{tag} shop","id":data.store})
        session.commit()
        reports.submit_report(_report(data,data.reader),data.reader,session)
        reports.submit_report(ContentReportInput(subject_type="store",subject_id=data.store,category="other",description="A separate shop safety concern requiring review."),data.reader,session)
        page = reports.moderation_queue("pending",data.moderator,session,offset=0,limit=1,search=tag)
        assert page["issue_total"] == 2 and len(page["issues"]) == 1
        next_page = reports.moderation_queue("pending",data.moderator,session,offset=1,limit=1,search=tag)
        assert next_page["issues"][0]["id"] != page["issues"][0]["id"]
        filtered = reports.moderation_queue("pending",data.moderator,session,search=f"{tag} shop")
        assert filtered["issue_total"] == 1
        assert filtered["issues"][0]["subject_type"] == "store"


def test_moderation_notifications_load_through_the_real_inbox_endpoint(review_data):
    from app.api.v1.endpoints import notifications
    data = review_data
    with Session(data.engine) as session:
        receipt = reports.submit_report(_report(data,data.reader),data.reader,session)
        reports.decide_report_issue(receipt["issue_id"],ReportDecision(decision="upheld",note="The submitted evidence supports this report.",expected_pending_count=1),data.moderator,session)
        inbox = notifications.list_notifications(data.reader,session)
        assert any(item.category == "moderation" and item.action_path == "/reports" for item in inbox.items)



def test_optional_report_listing_is_saved_with_a_name_snapshot_and_reaches_moderators(review_data):
    data = review_data
    with Session(data.engine) as session:
        receipt = reports.submit_report(ContentReportInput(subject_type="store",subject_id=data.store,category="other",product_id=data.product_a,description="The selected listing has an issue worth reviewing."),data.reader,session)
        session.execute(text("UPDATE products SET product_name='Changed name' WHERE id=:id"),{"id":data.product_a})
        session.commit()
        mine = reports.my_reports(data.reader,session)["reports"]
        saved = next(report for report in mine if report["id"] == receipt["id"])
        assert saved["product_id"] == data.product_a and saved["product_name"] == "Product A"
        queue = reports.moderation_queue("pending",data.moderator,session,search="The selected listing has an issue")
        assert queue["issues"][0]["reports"][0]["product_name"] == "Product A"


@pytest.mark.parametrize("unavailable",["inactive","missing","wrong_shop"])
def test_report_listing_must_be_currently_active_in_the_reported_shop(review_data,unavailable):
    data = review_data
    with Session(data.engine) as session:
        product = data.product_a
        if unavailable == "inactive":
            session.execute(text("UPDATE products SET status='hidden' WHERE id=:id"),{"id":product})
            session.commit()
        elif unavailable == "missing":
            product = uuid4()
        else:
            owner=session.execute(text("INSERT INTO business_owners(name,email,firebase_uid) VALUES ('Other owner',:email,:uid) RETURNING id"),{"email":f"{uuid4()}@example.com","uid":str(uuid4())}).scalar_one()
            store=session.execute(text("INSERT INTO stores(business_owner_id,store_name,store_address,status) VALUES (:owner,'Another shop','Audit street','approved') RETURNING id"),{"owner":owner}).scalar_one()
            product=session.execute(text("INSERT INTO products(store_id,product_name,price,stock_quantity,status) VALUES (:store,'Other shop product',1,1,'active') RETURNING id"),{"store":store}).scalar_one()
            session.commit()
        with pytest.raises(HTTPException) as error:
            reports.submit_report(ContentReportInput(subject_type="store",subject_id=data.store,category="other",product_id=product,description="A report with a listing that must be validated."),data.reader,session)
        assert error.value.status_code == 422
        session.rollback()
        if unavailable == "inactive":
            assert not any(item["id"] == data.product_a for item in reports.reportable_products(data.store,data.reader,session)["products"])



@pytest.mark.parametrize("decision",["dismissed","removed"])
def test_shop_owner_can_only_flag_and_moderator_controls_product_feedback_removal(review_data,decision):
    from app.api.v1.endpoints import vendor_feedback, vendor
    data=review_data
    with Session(data.engine) as session:
        owner_id=session.execute(text("SELECT business_owner_id FROM stores WHERE id=:id"),{"id":data.store}).scalar_one()
        owner=AuthenticatedUser(id=owner_id,firebase_uid="owner-test",name="Shop owner",email="owner@example.com",role=AccountRole.business_owner)
        marketplace.write_product_review(data.product_a,MarketplaceProductReviewInput(rating=5,comment="Purchased product feedback."),data.buyer,session)
        listed=vendor_feedback.vendor_feedback(current_user=owner,session=session)
        assert listed["summary"]["rating"]==5 and listed["total"]==1
        entry=listed["feedback"][0]
        assert entry["can_flag"] is True
        tag=str(uuid4())
        flag=vendor_feedback.flag_product_feedback(entry["id"],vendor_feedback.ProductFeedbackFlagInput(description="Please investigate this feedback: "+tag),owner,session)
        assert flag["status"]=="pending"
        assert marketplace._product_reviews(session,data.product_a,data.buyer.id).total==1
        with pytest.raises(HTTPException) as editing:
            marketplace.write_product_review(data.product_a,MarketplaceProductReviewInput(rating=1),data.buyer,session)
        assert editing.value.status_code==409
        session.rollback()
        queued=reports.moderation_queue("pending",data.moderator,session,search=tag)
        assert queued["product_flag_total"]==1 and queued["product_feedback_flags"][0]["id"]==flag["id"]
        vendor_feedback.decide_product_feedback_flag(flag["id"],FeedbackFlagDecision(decision=decision,note="This is the moderator's reasoned decision."),data.moderator,session)
        public=marketplace._product_reviews(session,data.product_a,data.buyer.id)
        assert public.total==(0 if decision=="removed" else 1)
        assert public.can_review is False
        owner_view=vendor_feedback.vendor_feedback(current_user=owner,session=session)
        assert owner_view["feedback"][0]["flag_status"]==decision
        assert owner_view["summary"]["count"]==(0 if decision=="removed" else 1)
        assert vendor.dashboard(owner,session)["review_summary"]["count"]==(0 if decision=="removed" else 1)
        store=marketplace.marketplace_store(data.store,address_id=None,latitude=None,longitude=None,current_user=data.buyer,session=session)
        assert store.rating==(0 if decision=="removed" else 5)
        assert session.execute(text("SELECT COUNT(*) FROM notifications WHERE user_id=:user AND source_key=:key"),{"user":data.buyer.id,"key":f'product-feedback-decision:{flag["id"]}'}).scalar_one()==1
        with pytest.raises(HTTPException):
            vendor_feedback.flag_product_feedback(entry["id"],vendor_feedback.ProductFeedbackFlagInput(description="Try to flag the same review again."),owner,session)
        session.rollback()


def test_store_owner_cannot_flag_another_stores_feedback(review_data):
    from app.api.v1.endpoints import vendor_feedback
    data=review_data
    with Session(data.engine) as session:
        marketplace.write_product_review(data.product_a,MarketplaceProductReviewInput(rating=4),data.buyer,session)
        feedback_id=session.execute(text("SELECT id FROM product_reviews WHERE product_id=:id"),{"id":data.product_a}).scalar_one()
        owner_id=session.execute(text("INSERT INTO business_owners(name,email,firebase_uid) VALUES ('Other owner',:email,:uid) RETURNING id"),{"email":f"{uuid4()}@example.com","uid":str(uuid4())}).scalar_one()
        session.execute(text("INSERT INTO stores(business_owner_id,store_name,store_address,status) VALUES (:id,'Other shop','Audit road','approved')"),{"id":owner_id})
        session.commit()
        other=AuthenticatedUser(id=owner_id,firebase_uid="other",name="Other owner",email="other@example.com",role=AccountRole.business_owner)
        with pytest.raises(HTTPException) as denied:
            vendor_feedback.flag_product_feedback(feedback_id,vendor_feedback.ProductFeedbackFlagInput(description="This feedback belongs to a different shop."),other,session)
        assert denied.value.status_code==404


def test_owner_feedback_sorting_applies_before_pagination_and_keeps_search(review_data):
    from app.api.v1.endpoints import vendor_feedback
    d=review_data
    with Session(d.engine) as s:
        _purchase(s,d.reader.id,d.product_b,d.store)
        _purchase(s,d.third.id,d.product_a,d.store)
        for product,user,rating,comment in [(d.product_a,d.buyer,5,"Zesty produce"),(d.product_b,d.reader,1,"Average produce"),(d.product_a,d.third,3,"Fresh produce")]:
            marketplace.write_product_review(product,MarketplaceProductReviewInput(rating=rating,comment=comment),user,s)
        owner_id=s.execute(text("SELECT business_owner_id FROM stores WHERE id=:id"),{"id":d.store}).scalar_one()
        owner=AuthenticatedUser(id=owner_id,firebase_uid="sort-owner",name="Shop owner",email="sort@example.com",role=AccountRole.business_owner)
        listed=vendor_feedback.vendor_feedback(current_user=owner,session=s)["feedback"]
        vendor_feedback.flag_product_feedback(listed[0]["id"],vendor_feedback.ProductFeedbackFlagInput(description="Please review this product feedback."),owner,s)
        values={
            "product":lambda row:row["product_name"].lower(),
            "rating":lambda row:row["rating"],
            "feedback":lambda row:row["comment"].lower(),
            "submitted":lambda row:row["date_submitted"],
            "moderator":lambda row:{"pending":"Awaiting moderator","dismissed":"Flag dismissed","removed":"Feedback removed"}.get(row["flag_status"],"Not flagged"),
        }
        for column,key in values.items():
            for direction in ("asc","desc"):
                result=vendor_feedback.vendor_feedback(search="produce",current_user=owner,session=s,sort=column,direction=direction)
                actual=[key(row) for row in result["feedback"]]
                assert actual==sorted(actual,reverse=direction=="desc")
                page=vendor_feedback.vendor_feedback(search="produce",offset=1,limit=1,current_user=owner,session=s,sort=column,direction=direction)
                assert page["total"]==3 and page["feedback"][0]["id"]==result["feedback"][1]["id"]
        assert not vendor_feedback.vendor_feedback(search="no matching feedback",current_user=owner,session=s,sort="rating",direction="asc")["feedback"]
        for sort,direction in [("rating; DROP TABLE users","asc"),("rating","sideways")]:
            with pytest.raises(HTTPException) as error:
                vendor_feedback.vendor_feedback(current_user=owner,session=s,sort=sort,direction=direction)
            assert error.value.status_code==422
