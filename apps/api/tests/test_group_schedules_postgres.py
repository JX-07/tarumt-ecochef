"""Real group sharing and permission checks in the isolated audit database."""
from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from test_review_moderation_postgres import review_data
from app.api.v1.endpoints import social, recipes, meal_plans
from app.schemas.recipes import RecipeScheduleInput
from app.schemas.meal_plans import MealPlanEntryUpdate


def _invite(session, data):
    session.execute(text("INSERT INTO friendships(user_id_1,user_id_2,status) VALUES (:one,:two,'accepted')"), {"one":data.author.id,"two":data.reader.id})
    session.commit()
    social.invite_cooking_member(data.reader.id,data.author,session)
    return social.my_cooking_groups(data.author,session)["items"][0]["id"]


def test_private_schedule_stays_private_and_pending_invite_cannot_share(review_data):
    d=review_data
    with Session(d.engine) as s:
        group=_invite(s,d)
        recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="dinner"),d.author,s)
        assert len(meal_plans.get_my_meal_plan(date(2026,11,10),1,d.reader,s).items)==0
        with pytest.raises(HTTPException) as error:
            recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="dinner",shared_group_id=group),d.reader,s)
        assert error.value.status_code==403
        s.rollback()
        with pytest.raises(HTTPException) as error:
            social.join_cooking_group(group,d.buyer,s)
        assert error.value.status_code==403
        s.rollback()


def test_joined_members_see_shared_entry_and_author_updates_propagate(review_data):
    d=review_data
    with Session(d.engine) as s:
        group=_invite(s,d)
        social.join_cooking_group(group,d.reader,s)
        recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="dinner",scheduled_time="18:00",shared_group_id=group),d.author,s)
        own=meal_plans.get_my_meal_plan(date(2026,11,10),1,d.author,s).items
        shared=meal_plans.get_my_meal_plan(date(2026,11,10),1,d.reader,s).items
        assert len(shared)==1 and shared[0].id==own[0].id
        assert shared[0].shared_group_id==group and shared[0].added_by_name==d.author.name
        assert shared[0].can_edit is False and own[0].can_edit is True
        assert not meal_plans.get_my_meal_plan(date(2026,11,10),1,d.buyer,s).items
        for action in [lambda: meal_plans.delete_meal_plan_entry(shared[0].id,d.reader,s),lambda: meal_plans.update_meal_plan_entry(shared[0].id,MealPlanEntryUpdate(scheduled_date="2026-11-11",meal_slot="lunch"),d.reader,s)]:
            with pytest.raises(HTTPException) as error: action()
            assert error.value.status_code==404
            s.rollback()
        updated=meal_plans.update_meal_plan_entry(own[0].id,MealPlanEntryUpdate(scheduled_date="2026-11-11",meal_slot="lunch"),d.author,s)
        assert updated.shared_group_id==group
        assert not meal_plans.get_my_meal_plan(date(2026,11,10),1,d.reader,s).items
        assert len(meal_plans.get_my_meal_plan(date(2026,11,11),1,d.reader,s).items)==1
        meal_plans.delete_meal_plan_entry(own[0].id,d.author,s)
        assert not meal_plans.get_my_meal_plan(date(2026,11,11),1,d.reader,s).items


def test_same_recipe_can_be_planned_for_group_and_self(review_data):
    d=review_data
    with Session(d.engine) as s:
        group=_invite(s,d)
        social.join_cooking_group(group,d.reader,s)
        private=RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="drink",scheduled_time="12:00")
        shared=RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="drink",scheduled_time="13:00",shared_group_id=group)
        recipes.schedule_recipe(d.recipe,shared,d.author,s)
        recipes.schedule_recipe(d.recipe,private,d.author,s)
        own=meal_plans.get_my_meal_plan(date(2026,11,10),1,d.author,s).items
        member=meal_plans.get_my_meal_plan(date(2026,11,10),1,d.reader,s).items
        assert len(own)==2
        assert {item.shared_group_id for item in own}=={None,group}
        assert len(member)==1 and member[0].shared_group_id==group
        recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="drink",scheduled_time="14:00"),d.author,s)
        own=meal_plans.get_my_meal_plan(date(2026,11,10),1,d.author,s).items
        assert len(own)==2
        assert {item.shared_group_id:item.scheduled_time for item in own}[group]==member[0].scheduled_time


def test_leaving_group_revokes_visibility_and_sharing_rights(review_data):
    d=review_data
    with Session(d.engine) as s:
        group=_invite(s,d)
        social.join_cooking_group(group,d.reader,s)
        recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="dinner",shared_group_id=group),d.author,s)
        social.leave_cooking_group(group,d.reader,s)
        assert not meal_plans.get_my_meal_plan(date(2026,11,10),1,d.reader,s).items
        with pytest.raises(HTTPException) as error:
            recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="lunch",shared_group_id=group),d.reader,s)
        assert error.value.status_code==403
        s.rollback()
        assert len(meal_plans.get_my_meal_plan(date(2026,11,10),1,d.author,s).items)==1


def test_shared_ingredients_enter_member_shopping_list_and_removed_members_lose_access(review_data):
    d=review_data
    with Session(d.engine) as s:
        group=_invite(s,d)
        social.join_cooking_group(group,d.reader,s)
        ingredient=s.execute(text("INSERT INTO ingredients(ingredient_name,ingredient_type) VALUES (:name,'food') RETURNING id"),{"name":str(uuid4())}).scalar_one()
        s.execute(text("INSERT INTO recipe_ingredients(recipe_id,ingredient_id,quantity) VALUES (:recipe,:ingredient,'2')"),{"recipe":d.recipe,"ingredient":ingredient})
        s.commit()
        recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="dinner",shared_group_id=group),d.author,s)
        assert len(meal_plans.get_my_shopping_list(date(2026,11,10),date(2026,11,10),d.reader,s).items)==1
        social.remove_cooking_member(d.reader.id,d.author,s)
        assert not meal_plans.get_my_shopping_list(date(2026,11,10),date(2026,11,10),d.reader,s).items
        s.execute(text("UPDATE recipes SET is_published=false WHERE id=:recipe"),{"recipe":d.recipe});s.commit()
        recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-11",meal_slot="dinner",shared_group_id=group),d.author,s)
        assert not meal_plans.get_my_meal_plan(date(2026,11,11),1,d.reader,s).items


def test_private_group_recipe_visible_in_plan_and_detail_only_to_members(review_data):
    d=review_data
    with Session(d.engine) as s:
        group=_invite(s,d)
        social.join_cooking_group(group,d.reader,s)
        s.execute(text("UPDATE recipes SET is_published=false WHERE id=:recipe"),{"recipe":d.recipe});s.commit()
        recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-10",meal_slot="dinner",shared_group_id=group),d.author,s)
        assert len(meal_plans.get_my_meal_plan(date(2026,11,10),1,d.reader,s).items)==1
        assert not meal_plans.get_my_meal_plan(date(2026,11,10),1,d.buyer,s).items
        detail=recipes.get_recipe(d.recipe,d.reader,s)
        assert detail.id==d.recipe and detail.shared_group_ids==[group]
        recipes.schedule_recipe(d.recipe,RecipeScheduleInput(scheduled_date="2026-11-11",meal_slot="lunch",shared_group_id=group),d.reader,s)
        assert len(meal_plans.get_my_meal_plan(date(2026,11,11),1,d.author,s).items)==1
        assert len(meal_plans.get_my_meal_plan(date(2026,11,11),1,d.reader,s).items)==1
        with pytest.raises(HTTPException) as error:
            recipes.get_recipe(d.recipe,d.buyer,s)
        assert error.value.status_code==404
        s.rollback()
