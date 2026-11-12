import base64
import binascii
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.core.config import get_settings
from app.services.recipe_ingredient_validation import ingredient_quantity_issues
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.recipes import RecipeCalorieEstimate, RecipeCalorieEstimateInput, RecipeCatalogueQuery, RecipeCreate, RecipeDetail, RecipeEditLog, RecipeImageUpload, RecipeImageUploadResult, RecipeIngredient, RecipeList, RecipeNutrition, RecipeReportInput, RecipeReview, RecipeReviewInput, RecipeFeedbackFlagInput, RecipeSafetyProfile, RecipeScheduleInput, RecipeSummary, recipe_safety_warnings

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


@router.post("/validate-ingredients")
def validate_recipe_ingredients(request: RecipeCalorieEstimateInput, current_user: AuthenticatedUser = CurrentConsumer) -> dict:
    return {"issues": ingredient_quantity_issues(request.ingredients, request.servings)}


@router.post("/images", response_model=RecipeImageUploadResult, status_code=status.HTTP_201_CREATED)
def upload_recipe_image(
    payload: RecipeImageUpload,
    current_user: AuthenticatedUser = CurrentConsumer,
    session: Session = Depends(get_db_session),
) -> RecipeImageUploadResult:
    try:
        image_bytes = base64.b64decode(payload.data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The selected image could not be read.") from error
    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Recipe images must be smaller than 8 MB.")
    image_id = uuid4()
    session.execute(
        text("INSERT INTO recipe_images (id, uploaded_by, content_type, image_data) VALUES (:id, :uploaded_by, :content_type, :image_data)"),
        {"id": image_id, "uploaded_by": current_user.id, "content_type": payload.content_type, "image_data": image_bytes},
    )
    session.commit()
    public_url = f"{get_settings().api_prefix}/recipes/images/{image_id}"
    return RecipeImageUploadResult(image_url=public_url)


@router.get("/images/{image_id}", response_class=Response)
def get_recipe_image(image_id: UUID, session: Session = Depends(get_db_session)) -> Response:
    image = session.execute(
        text("SELECT content_type, image_data FROM recipe_images WHERE id = :image_id"),
        {"image_id": image_id},
    ).mappings().one_or_none()
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe image not found.")
    return Response(
        content=bytes(image["image_data"]),
        media_type=image["content_type"],
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.post("/estimate-calories", response_model=RecipeCalorieEstimate)
def estimate_recipe_calories(request: RecipeCalorieEstimateInput, current_user: AuthenticatedUser = CurrentConsumer) -> RecipeCalorieEstimate:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Gemini calorie estimation is not configured. Add GEMINI_API_KEY to apps/api/.env and restart the API.")
    ingredient_lines = "\n".join(f"- {item.quantity} {item.name}" for item in request.ingredients)
    prompt = f"""Estimate calories for this complete recipe using typical edible portions and common preparation assumptions.
Ingredients:
{ingredient_lines}
Servings: {request.servings}
Return the total recipe calories, calories per serving, a confidence of low/medium/high, and short assumptions. Do not claim medical precision."""
    schema = {"type":"OBJECT","properties":{"calories_per_serving":{"type":"INTEGER"},"total_calories":{"type":"INTEGER"},"confidence":{"type":"STRING","enum":["low","medium","high"]},"assumptions":{"type":"ARRAY","items":{"type":"STRING"}}},"required":["calories_per_serving","total_calories","confidence","assumptions"]}
    payload = json.dumps({"contents":[{"parts":[{"text":prompt}]}],"generationConfig":{"temperature":0.2,"responseMimeType":"application/json","responseSchema":schema}}).encode("utf-8")
    api_request = UrlRequest(f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent", data=payload, headers={"Content-Type":"application/json","x-goog-api-key":settings.gemini_api_key}, method="POST")
    try:
        with urlopen(api_request, timeout=25) as response:
            body = json.loads(response.read().decode("utf-8"))
        text_output = body["candidates"][0]["content"]["parts"][0]["text"]
        return RecipeCalorieEstimate.model_validate_json(text_output)
    except HTTPError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Gemini rejected the estimation request (HTTP {error.code}).") from error
    except (URLError, TimeoutError) as error:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Gemini did not respond in time. Please try again.") from error
    except (KeyError, IndexError, json.JSONDecodeError, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Gemini returned an invalid calorie estimate. Please try again.") from error


@router.post("", response_model=RecipeDetail, status_code=status.HTTP_201_CREATED)
def create_recipe(request: RecipeCreate, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> RecipeDetail:
    recipe_id = session.execute(text("""
        INSERT INTO recipes (user_id, title, summary, image_url, instructions, prep_time, cook_time, servings, cuisine, nutrition, dietary_tags, allergen_tags, is_published)
        VALUES (:user_id, :title, :summary, :image_url, :instructions, :prep_time, :cook_time, :servings, :cuisine, CAST(:nutrition AS jsonb), :dietary_tags, :allergen_tags, :is_published) RETURNING id
    """), {"user_id": current_user.id, "title": request.title, "summary": request.summary, "image_url": request.image_url, "instructions": "\n".join(request.instructions), "prep_time": request.prep_time, "cook_time": request.cook_time, "servings": request.servings, "cuisine": request.cuisine, "nutrition": json.dumps(request.nutrition.model_dump(exclude_none=True)), "dietary_tags": request.dietary_tags, "allergen_tags": request.allergen_tags, "is_published": request.is_published}).scalar_one()
    for ingredient in request.ingredients:
        ingredient_id = session.execute(text("SELECT id FROM ingredients WHERE lower(ingredient_name) = lower(:name) ORDER BY id LIMIT 1"), {"name": ingredient.name}).scalar_one_or_none()
        if ingredient_id is None:
            ingredient_id = session.execute(text("INSERT INTO ingredients (ingredient_name, ingredient_type) VALUES (:name, 'recipe') RETURNING id"), {"name": ingredient.name}).scalar_one()
        session.execute(text("""
            INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity)
            VALUES (:recipe_id, :ingredient_id, :quantity)
            ON CONFLICT (recipe_id, ingredient_id)
            DO UPDATE SET quantity = EXCLUDED.quantity
        """), {"recipe_id": recipe_id, "ingredient_id": ingredient_id, "quantity": ingredient.quantity})
    session.commit()
    return get_recipe(recipe_id, current_user, session)


@router.put("/{recipe_id}", response_model=RecipeDetail)
def update_recipe(recipe_id: UUID, request: RecipeCreate, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> RecipeDetail:
    existing = session.execute(text("SELECT * FROM recipes WHERE id = :recipe_id"), {"recipe_id": recipe_id}).mappings().one_or_none()
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found.")
    if existing["user_id"] != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the recipe owner can edit this recipe.")
    old_ingredients = [(row.name, row.quantity) for row in session.execute(text("SELECT lower(i.ingredient_name) AS name, ri.quantity FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = :recipe_id ORDER BY name, ri.quantity"), {"recipe_id": recipe_id}).all()]
    new_ingredients = sorted((item.name.lower(), item.quantity) for item in request.ingredients)
    subjects: list[str] = []
    if existing["title"] != request.title or existing["summary"] != request.summary or existing["image_url"] != request.image_url:
        subjects.append("Basic information")
    if old_ingredients != new_ingredients:
        subjects.append("Ingredients")
    if [step.strip() for step in existing["instructions"].splitlines() if step.strip()] != request.instructions:
        subjects.append("Cooking steps")
    if existing["cook_time"] != request.cook_time or existing["prep_time"] != request.prep_time or existing["servings"] != request.servings or dict(existing["nutrition"] or {}) != request.nutrition.model_dump(exclude_none=True):
        subjects.append("Recipe details")
    if list(existing["dietary_tags"] or []) != request.dietary_tags or list(existing["allergen_tags"] or []) != request.allergen_tags:
        subjects.append("Tags")
    if existing["is_published"] != request.is_published:
        subjects.append("Visibility")
    session.execute(text("""
        UPDATE recipes SET title=:title, summary=:summary, image_url=:image_url,
            instructions=:instructions, prep_time=:prep_time, cook_time=:cook_time,
            servings=:servings, cuisine=:cuisine, nutrition=CAST(:nutrition AS jsonb),
            dietary_tags=:dietary_tags, allergen_tags=:allergen_tags,
            is_published=:is_published
        WHERE id=:recipe_id
    """), {"recipe_id": recipe_id, "title": request.title, "summary": request.summary, "image_url": request.image_url, "instructions": "\n".join(request.instructions), "prep_time": request.prep_time, "cook_time": request.cook_time, "servings": request.servings, "cuisine": request.cuisine, "nutrition": json.dumps(request.nutrition.model_dump(exclude_none=True)), "dietary_tags": request.dietary_tags, "allergen_tags": request.allergen_tags, "is_published": request.is_published})
    session.execute(text("DELETE FROM recipe_ingredients WHERE recipe_id = :recipe_id"), {"recipe_id": recipe_id})
    for ingredient in request.ingredients:
        ingredient_id = session.execute(text("SELECT id FROM ingredients WHERE lower(ingredient_name) = lower(:name) ORDER BY id LIMIT 1"), {"name": ingredient.name}).scalar_one_or_none()
        if ingredient_id is None:
            ingredient_id = session.execute(text("INSERT INTO ingredients (ingredient_name, ingredient_type) VALUES (:name, 'recipe') RETURNING id"), {"name": ingredient.name}).scalar_one()
        session.execute(text("INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity) VALUES (:recipe_id, :ingredient_id, :quantity) ON CONFLICT (recipe_id, ingredient_id) DO UPDATE SET quantity=EXCLUDED.quantity"), {"recipe_id": recipe_id, "ingredient_id": ingredient_id, "quantity": ingredient.quantity})
    if subjects:
        session.execute(text("INSERT INTO recipe_edit_logs (recipe_id, subjects) VALUES (:recipe_id, :subjects)"), {"recipe_id": recipe_id, "subjects": subjects})
    session.commit()
    return get_recipe(recipe_id, current_user, session)


def _profile(session: Session, user_id: UUID) -> RecipeSafetyProfile:
    row = session.execute(text("SELECT COALESCE(allergies, '{}') AS allergies, COALESCE(dietary_restrictions, '{}') AS dietary_restrictions FROM user_preferences WHERE user_id = :user_id"), {"user_id": user_id}).mappings().one_or_none()
    return RecipeSafetyProfile(**row) if row else RecipeSafetyProfile()


def _edit_logs(session: Session, recipe_id: UUID) -> list[RecipeEditLog]:
    rows = session.execute(text("SELECT edited_at, subjects FROM recipe_edit_logs WHERE recipe_id = :recipe_id ORDER BY edited_at DESC LIMIT 3"), {"recipe_id": recipe_id}).mappings().all()
    return [RecipeEditLog(**row) for row in rows]


def _smart_matches(session: Session, user_id: UUID) -> dict[UUID, list[str]]:
    rows = session.execute(text("""
        SELECT ri.recipe_id, array_agg(DISTINCT ingredient.ingredient_name) AS ingredient_names
        FROM ingredient_inventories inventory
        JOIN ingredient_inventory_items item ON item.ingredient_inventory_id = inventory.id
        JOIN ingredients ingredient ON ingredient.id = item.ingredient_id
        JOIN ingredients recipe_ingredient ON lower(recipe_ingredient.ingredient_name) = lower(ingredient.ingredient_name)
        JOIN recipe_ingredients ri ON ri.ingredient_id = recipe_ingredient.id
        WHERE inventory.user_id = :user_id
          AND (item.expiry_date AT TIME ZONE 'Asia/Kuala_Lumpur')::date
              BETWEEN (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
                  AND (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 3
        GROUP BY ri.recipe_id
    """), {"user_id": user_id}).mappings().all()
    return {row["recipe_id"]: sorted(row["ingredient_names"], key=str.casefold) for row in rows}


def _summary(row: object, profile: RecipeSafetyProfile, current_user_id: UUID, session: Session, smart_match_ingredients: list[str] | None = None) -> RecipeSummary:
    dietary_tags = list(row.dietary_tags or [])
    allergen_tags = list(row.allergen_tags or [])
    return RecipeSummary(id=row.id, title=row.title, summary=row.summary, image_url=row.image_url, cuisine=row.cuisine, difficulty=row.difficulty, prep_time=row.prep_time, cook_time=row.cook_time, total_time=(row.prep_time or 0) + (row.cook_time or 0), servings=row.servings, dietary_tags=dietary_tags, allergen_tags=allergen_tags, average_rating=float(row.average_rating) if row.average_rating is not None else None, is_favourite=row.is_favourite, safety_warnings=recipe_safety_warnings(allergen_tags, dietary_tags, profile), is_owner=row.user_id == current_user_id, is_published=row.is_published, edit_log=_edit_logs(session, row.id) if row.user_id == current_user_id else [], smart_match_ingredients=smart_match_ingredients or [])


@router.get("", response_model=RecipeList)
def list_recipes(search: str | None = Query(default=None, max_length=100), cuisine: str | None = Query(default=None, max_length=50), dietary_tag: str | None = Query(default=None, max_length=50), tags: list[str] = Query(default=[]), max_total_time: int | None = Query(default=None, ge=1, le=1440), favourites_only: bool = False, mine_only: bool = False, community_only: bool = False, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> RecipeList:
    query = RecipeCatalogueQuery(search=search, cuisine=cuisine, dietary_tag=dietary_tag, max_total_time=max_total_time, favourites_only=favourites_only, mine_only=mine_only, community_only=community_only)
    filter_tags = sorted({tag.strip().lower() for tag in tags if tag.strip()})
    rows = session.execute(text("""
        SELECT r.id, r.user_id, r.title, r.summary, r.image_url, r.cuisine, r.difficulty, r.prep_time, r.cook_time, r.servings, r.dietary_tags, r.allergen_tags, r.is_published, AVG(f.rating)::numeric(3,2) AS average_rating, (fav.user_id IS NOT NULL) AS is_favourite
        FROM recipes r
        LEFT JOIN recipe_feedback f ON f.recipe_id = r.id AND f.removed_at IS NULL AND f.eligibility_verified
        LEFT JOIN recipe_favourites fav ON fav.recipe_id = r.id AND fav.user_id = :user_id
        WHERE (r.is_published OR r.user_id = :user_id)
          AND (CAST(:search AS text) IS NULL OR lower(r.title) LIKE '%' || CAST(:search AS text) || '%' OR lower(COALESCE(r.summary, '')) LIKE '%' || CAST(:search AS text) || '%')
          AND (CAST(:cuisine AS text) IS NULL OR lower(r.cuisine) = CAST(:cuisine AS text))
          AND (CAST(:dietary_tag AS text) IS NULL OR CAST(:dietary_tag AS text) = ANY(r.dietary_tags))
          AND (cardinality(CAST(:filter_tags AS text[])) = 0 OR r.dietary_tags && CAST(:filter_tags AS text[]))
          AND (CAST(:max_total_time AS integer) IS NULL OR COALESCE(r.prep_time, 0) + COALESCE(r.cook_time, 0) <= CAST(:max_total_time AS integer))
          AND (NOT :favourites_only OR fav.user_id IS NOT NULL)
          AND (NOT :mine_only OR r.user_id = :user_id)
          AND (NOT :community_only OR r.user_id <> :user_id)
        GROUP BY r.id, fav.user_id ORDER BY (fav.user_id IS NOT NULL) DESC, r.date_created DESC, lower(r.title)
    """), {"user_id": current_user.id, "filter_tags": filter_tags, **query.model_dump()}).all()
    profile = _profile(session, current_user.id)
    smart_matches = _smart_matches(session, current_user.id)
    items = [_summary(row, profile, current_user.id, session, smart_matches.get(row.id)) for row in rows]
    return RecipeList(items=items, total=len(items))


def _feedback_visibility_status(feedback: object | None) -> str | None:
    if feedback is None:
        return None
    if feedback.removed_at:
        return "removed"
    if feedback.status:
        return feedback.status
    return "unverified" if not feedback.eligibility_verified else None


@router.get("/{recipe_id}", response_model=RecipeDetail)
def get_recipe(recipe_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> RecipeDetail:
    row = session.execute(text("""
        SELECT r.id, r.user_id, r.title, r.summary, r.image_url, r.cuisine, r.difficulty, r.prep_time, r.cook_time, r.servings, r.dietary_tags, r.allergen_tags, r.instructions, r.nutrition, r.is_published, r.date_created, u.name AS author_name, AVG(f.rating)::numeric(3,2) AS average_rating, (fav.user_id IS NOT NULL) AS is_favourite
        FROM recipes r JOIN users u ON u.id = r.user_id
        LEFT JOIN recipe_feedback f ON f.recipe_id = r.id AND f.removed_at IS NULL AND f.eligibility_verified
        LEFT JOIN recipe_favourites fav ON fav.recipe_id = r.id AND fav.user_id = :user_id
        WHERE r.id = :recipe_id AND (r.is_published OR r.user_id = :user_id OR EXISTS (
          SELECT 1 FROM meal_plan_recipes entry
          JOIN meal_plans plan ON plan.id = entry.meal_plan_id
          JOIN group_members viewer ON viewer.group_id = entry.shared_group_id AND viewer.user_id = :user_id AND viewer.status = 'active'
          JOIN group_members author ON author.group_id = entry.shared_group_id AND author.user_id = plan.user_id AND author.status = 'active'
          WHERE entry.recipe_id = r.id AND entry.shared_group_id IS NOT NULL
        )) GROUP BY r.id, u.name, fav.user_id
    """), {"recipe_id": recipe_id, "user_id": current_user.id}).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found.")
    ingredients = session.execute(text("SELECT i.ingredient_name AS name, ri.quantity, i.icon FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = :recipe_id ORDER BY lower(i.ingredient_name)"), {"recipe_id": recipe_id}).mappings().all()
    reviews = session.execute(text("""
        SELECT f.id, f.user_id, u.name AS user_name, f.rating, f.comment, f.date_submitted,
               f.user_id = :user_id AS is_mine,
               r.user_id = :user_id AND flag.id IS NULL AS can_flag,
               flag.status AS flag_status,
               CASE WHEN r.user_id = :user_id OR f.user_id = :user_id THEN flag.resolution_note END AS flag_resolution
        FROM recipe_feedback f JOIN users u ON u.id = f.user_id
        JOIN recipes r ON r.id = f.recipe_id
        LEFT JOIN recipe_feedback_flags flag ON flag.feedback_id = f.id
        WHERE f.recipe_id = :recipe_id AND f.removed_at IS NULL AND f.eligibility_verified ORDER BY f.date_submitted DESC
    """), {"recipe_id": recipe_id, "user_id": current_user.id}).mappings().all()
    can_review = row.user_id != current_user.id and session.execute(text("""
        SELECT 1 FROM recipe_review_eligibility WHERE recipe_id = :recipe_id AND user_id = :user_id
    """), {"recipe_id": recipe_id, "user_id": current_user.id}).scalar_one_or_none() is not None
    my_moderation = session.execute(text("""
        SELECT f.removed_at, f.eligibility_verified, f.rating, f.comment, flag.status, flag.resolution_note FROM recipe_feedback f
        LEFT JOIN recipe_feedback_flags flag ON flag.feedback_id = f.id
        WHERE f.recipe_id = :recipe_id AND f.user_id = :user_id
    """), {"recipe_id": recipe_id, "user_id": current_user.id}).one_or_none()
    my_status = _feedback_visibility_status(my_moderation)
    if my_status in {"pending", "dismissed", "removed"}:
        can_review = False
    eligibility_reason = ("Your feedback is being reviewed by a moderator." if my_status == "pending" else
                          "Your feedback has a moderation decision and cannot be changed." if my_status in {"dismissed", "removed"} else
                          "Your earlier feedback is saved privately. Use Cook Now or schedule this recipe, then resubmit it to publish it." if my_status == "unverified" else
                          "Use Cook Now or add this recipe to your schedule before leaving feedback.")
    summary = _summary(row, _profile(session, current_user.id), current_user.id, session, _smart_matches(session, current_user.id).get(row.id))
    shared_group_ids = session.execute(text("""
        SELECT DISTINCT entry.shared_group_id FROM meal_plan_recipes entry
        JOIN meal_plans plan ON plan.id = entry.meal_plan_id
        JOIN group_members viewer ON viewer.group_id = entry.shared_group_id AND viewer.user_id = :user_id AND viewer.status = 'active'
        JOIN group_members author ON author.group_id = entry.shared_group_id AND author.user_id = plan.user_id AND author.status = 'active'
        WHERE entry.recipe_id = :recipe_id AND entry.shared_group_id IS NOT NULL
    """), {"recipe_id": recipe_id, "user_id": current_user.id}).scalars().all()
    nutrition_data = row.nutrition if isinstance(row.nutrition, dict) else json.loads(row.nutrition or "{}")
    return RecipeDetail(**summary.model_dump(), shared_group_ids=shared_group_ids, instructions=[step.strip() for step in row.instructions.splitlines() if step.strip()], ingredients=[RecipeIngredient(**ingredient) for ingredient in ingredients], nutrition=RecipeNutrition(**nutrition_data), author_name=row.author_name, date_created=row.date_created, can_review=can_review, review_eligibility_reason=None if can_review else eligibility_reason, my_feedback_status=my_status, my_feedback_resolution=my_moderation.resolution_note if my_moderation else None, my_feedback_rating=my_moderation.rating if my_moderation else None, my_feedback_comment=my_moderation.comment if my_moderation else None, reviews=[RecipeReview(**review) for review in reviews])


@router.put("/{recipe_id}/favourite", status_code=status.HTTP_204_NO_CONTENT)
def favourite_recipe(recipe_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    if session.execute(text("SELECT 1 FROM recipes WHERE id = :recipe_id AND (is_published OR user_id = :user_id)"), {"recipe_id": recipe_id, "user_id": current_user.id}).scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found.")
    session.execute(text("INSERT INTO recipe_favourites (recipe_id, user_id) VALUES (:recipe_id, :user_id) ON CONFLICT (recipe_id, user_id) DO NOTHING"), {"recipe_id": recipe_id, "user_id": current_user.id})
    session.commit()


@router.delete("/{recipe_id}/favourite", status_code=status.HTTP_204_NO_CONTENT)
def unfavourite_recipe(recipe_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    session.execute(text("DELETE FROM recipe_favourites WHERE recipe_id = :recipe_id AND user_id = :user_id"), {"recipe_id": recipe_id, "user_id": current_user.id})
    session.commit()


@router.post("/{recipe_id}/schedule", status_code=status.HTTP_204_NO_CONTENT)
def schedule_recipe(recipe_id: UUID, request: RecipeScheduleInput, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    if session.execute(text("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'meal_plan_recipes_slot_idx'")).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The schedule database needs an update before meals can be saved. Please apply migration 0050.")
    if session.execute(text("""
        SELECT 1 FROM recipes recipe WHERE recipe.id = :recipe_id AND
          (recipe.is_published OR recipe.user_id = :user_id OR EXISTS (
            SELECT 1 FROM meal_plan_recipes entry
            JOIN meal_plans plan ON plan.id = entry.meal_plan_id
            JOIN group_members viewer ON viewer.group_id = entry.shared_group_id AND viewer.user_id = :user_id AND viewer.status = 'active'
            JOIN group_members author ON author.group_id = entry.shared_group_id AND author.user_id = plan.user_id AND author.status = 'active'
            WHERE entry.recipe_id = recipe.id AND entry.shared_group_id IS NOT NULL
              AND entry.shared_group_id = CAST(:group_id AS uuid)
          ))
    """), {"recipe_id": recipe_id, "user_id": current_user.id, "group_id": request.shared_group_id}).scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found.")
    if request.shared_group_id is not None:
        session.execute(text("SELECT id FROM user_groups WHERE id=:group FOR UPDATE"), {"group":request.shared_group_id}).all()
        if session.execute(text("SELECT 1 FROM group_members WHERE group_id=:group AND user_id=:me AND status='active'"),
                           {"group":request.shared_group_id,"me":current_user.id}).scalar_one_or_none() is None:
            raise HTTPException(403,"Join this group before sharing a schedule with it.")
    meal_plan_id = session.execute(text("SELECT id FROM meal_plans WHERE user_id = :user_id ORDER BY id LIMIT 1"), {"user_id": current_user.id}).scalar_one_or_none()
    if meal_plan_id is None:
        meal_plan_id = session.execute(text("INSERT INTO meal_plans (user_id) VALUES (:user_id) RETURNING id"), {"user_id": current_user.id}).scalar_one()
    conflict_target = (
        "(meal_plan_id, recipe_id, scheduled_date, meal_slot) WHERE shared_group_id IS NULL"
        if request.shared_group_id is None else
        "(meal_plan_id, recipe_id, scheduled_date, meal_slot, shared_group_id) WHERE shared_group_id IS NOT NULL"
    )
    session.execute(text(f"""
        INSERT INTO meal_plan_recipes (meal_plan_id, recipe_id, scheduled_date, meal_slot, scheduled_time, shared_group_id)
        VALUES (:meal_plan_id, :recipe_id, CAST(:scheduled_date AS date), :meal_slot, CAST(:scheduled_time AS time), :shared_group_id)
        ON CONFLICT {conflict_target}
        DO UPDATE SET scheduled_time = EXCLUDED.scheduled_time
    """), {"meal_plan_id": meal_plan_id, "recipe_id": recipe_id, **request.model_dump()})
    _record_review_eligibility(session, recipe_id, current_user.id, "schedule_later")
    session.commit()


@router.post("/{recipe_id}/report", status_code=status.HTTP_204_NO_CONTENT)
def report_recipe(recipe_id: UUID, request: RecipeReportInput, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    # Older mobile clients enter the same grouped moderation queue as the new composer.
    from app.api.v1.endpoints.reports import submit_report
    from app.schemas.reports import ContentReportInput

    category = {"inappropriate": "inappropriate_content", "misleading": "misinformation", "unsafe": "other"}.get(request.reason, "other")
    submit_report(ContentReportInput(subject_type="recipe", subject_id=recipe_id, category=category,
                  description=f"Recipe report from an earlier app version: {request.reason}."), current_user, session)



def _record_review_eligibility(session: Session, recipe_id: UUID, user_id: UUID, action: str) -> None:
    session.execute(text("""
        INSERT INTO recipe_review_eligibility (recipe_id, user_id, first_action)
        VALUES (:recipe_id, :user_id, :action)
        ON CONFLICT (recipe_id, user_id) DO UPDATE SET last_action_at = now()
    """), {"recipe_id": recipe_id, "user_id": user_id, "action": action})


@router.post("/{recipe_id}/cook-now", status_code=status.HTTP_204_NO_CONTENT)
def start_recipe_cooking(recipe_id: UUID, current_user: AuthenticatedUser = CurrentConsumer,
                         session: Session = Depends(get_db_session)) -> None:
    if session.execute(text("SELECT 1 FROM recipes WHERE id = :recipe_id AND (is_published OR user_id = :user_id)"),
                       {"recipe_id": recipe_id, "user_id": current_user.id}).scalar_one_or_none() is None:
        raise HTTPException(404, "Recipe not found.")
    _record_review_eligibility(session, recipe_id, current_user.id, "cook_now")
    session.commit()


@router.put("/{recipe_id}/review", response_model=RecipeReview)
def review_recipe(recipe_id: UUID, request: RecipeReviewInput, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> RecipeReview:
    recipe = session.execute(text("SELECT user_id FROM recipes WHERE id = :recipe_id AND is_published"), {"recipe_id": recipe_id}).mappings().one_or_none()
    if recipe is None:
        raise HTTPException(404, "Recipe not found.")
    if recipe.user_id == current_user.id:
        raise HTTPException(400, "You cannot review your own recipe.")
    eligible = session.execute(text("SELECT 1 FROM recipe_review_eligibility WHERE recipe_id = :recipe_id AND user_id = :user_id"),
                               {"recipe_id": recipe_id, "user_id": current_user.id}).scalar_one_or_none()
    if eligible is None:
        raise HTTPException(403, "Use Cook Now or schedule this recipe before leaving feedback.")
    # Serialize feedback editing and author flagging, keeping the moderator's evidence stable.
    session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"recipe-review:{recipe_id}:{current_user.id}"})
    existing = session.execute(text("""
        SELECT f.removed_at, flag.id AS flag_id FROM recipe_feedback f
        LEFT JOIN recipe_feedback_flags flag ON flag.feedback_id = f.id
        WHERE f.recipe_id = :recipe_id AND f.user_id = :user_id
    """), {"recipe_id": recipe_id, "user_id": current_user.id}).one_or_none()
    if existing and (existing.removed_at is not None or existing.flag_id is not None):
        raise HTTPException(409, "This feedback is part of a moderation decision and cannot be changed.")
    review = session.execute(text("""
        INSERT INTO recipe_feedback (recipe_id, user_id, rating, comment, eligibility_verified)
        VALUES (:recipe_id, :user_id, :rating, :comment, true)
        ON CONFLICT (recipe_id, user_id)
        DO UPDATE SET rating=EXCLUDED.rating, comment=EXCLUDED.comment, date_submitted=now(), eligibility_verified=true
        RETURNING id, user_id, rating, comment, date_submitted
    """), {"recipe_id": recipe_id, "user_id": current_user.id, **request.model_dump()}).mappings().one()
    session.commit()
    return RecipeReview(**review, user_name=current_user.name, is_mine=True)


@router.post("/{recipe_id}/reviews/{feedback_id}/flag", status_code=status.HTTP_201_CREATED)
def flag_recipe_feedback(recipe_id: UUID, feedback_id: UUID, request: RecipeFeedbackFlagInput,
                         current_user: AuthenticatedUser = CurrentConsumer,
                         session: Session = Depends(get_db_session)) -> dict:
    feedback = session.execute(text("""
        SELECT f.user_id, r.user_id AS author_id FROM recipe_feedback f
        JOIN recipes r ON r.id = f.recipe_id
        WHERE f.id = :feedback_id AND f.recipe_id = :recipe_id AND f.removed_at IS NULL AND f.eligibility_verified
    """), {"feedback_id": feedback_id, "recipe_id": recipe_id}).one_or_none()
    if feedback is None:
        raise HTTPException(404, "Feedback not found.")
    if feedback.author_id != current_user.id:
        raise HTTPException(403, "Only the recipe author can flag this feedback.")
    session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"recipe-review:{recipe_id}:{feedback.user_id}"})
    row = session.execute(text("""
        INSERT INTO recipe_feedback_flags(feedback_id, author_id, description)
        VALUES (:feedback_id, :author_id, :description)
        ON CONFLICT(feedback_id) DO NOTHING RETURNING id, status, created_at
    """), {"feedback_id": feedback_id, "author_id": current_user.id, "description": request.description}).mappings().one_or_none()
    if row is None:
        raise HTTPException(409, "This feedback has already been flagged for moderation.")
    session.commit()
    return dict(row)
