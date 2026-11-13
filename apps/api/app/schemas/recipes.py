from datetime import date, datetime, time
from enum import Enum
import unicodedata
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator
from app.services.recipe_ingredient_validation import ingredient_quantity_issues


MEAL_TAGS = {"breakfast", "brunch", "lunch", "dinner", "snack", "dessert", "drink", "teatime"}
DIETARY_FORBIDDEN = {
    "vegan": {
        "beef",
        "chicken",
        "pork",
        "lamb",
        "mutton",
        "fish",
        "salmon",
        "tuna",
        "prawn",
        "shrimp",
        "crab",
        "egg",
        "milk",
        "cheese",
        "butter",
        "cream",
        "yogurt",
        "honey",
        "gelatin",
    },
    "vegetarian": {
        "beef",
        "chicken",
        "pork",
        "lamb",
        "mutton",
        "fish",
        "salmon",
        "tuna",
        "prawn",
        "shrimp",
        "crab",
        "gelatin",
    },
    "gluten-free": {"wheat", "barley", "rye", "bread", "pasta", "noodle", "soy sauce"},
    "dairy-free": {"milk", "cheese", "butter", "cream", "yogurt", "whey", "casein"},
    "keto": {"sugar", "rice", "bread", "pasta", "potato", "flour", "corn", "oat"},
    "paleo": {
        "milk",
        "cheese",
        "butter",
        "yogurt",
        "wheat",
        "rice",
        "bread",
        "pasta",
        "bean",
        "lentil",
        "soy",
    },
    "nut-free": {
        "nut",
        "nuts",
        "peanut",
        "groundnut",
        "almond",
        "cashew",
        "walnut",
        "pecan",
        "pistachio",
        "hazelnut",
        "macadamia",
        "brazil nut",
        "nut butter",
    },
}
DIETARY_ALLERGEN_CONFLICTS = {
    "nut-free": {"nuts", "peanuts", "tree nuts"},
    "dairy-free": {"milk"},
    "gluten-free": {"wheat", "gluten"},
    "vegan": {"milk", "eggs", "fish", "shellfish"},
    "vegetarian": {"fish", "shellfish"},
}
HIGH_PROTEIN_INGREDIENTS = {
    "chicken",
    "beef",
    "pork",
    "lamb",
    "fish",
    "salmon",
    "tuna",
    "prawn",
    "shrimp",
    "egg",
    "tofu",
    "tempeh",
    "bean",
    "lentil",
    "chickpea",
    "yogurt",
    "cheese",
}


def _clean_terms(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        cleaned = " ".join(value.strip().lower().split())
        if cleaned and cleaned not in result:
            result.append(cleaned)
    return result


class RecipeDifficulty(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


class RecipeNutrition(BaseModel):
    calories_kcal: int | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbohydrates_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    fibre_g: float | None = Field(default=None, ge=0)


class RecipeIngredient(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    quantity: str = Field(min_length=1, max_length=20)
    icon: str | None = None

    @field_validator("name", "quantity")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return " ".join(unicodedata.normalize("NFC", value).strip().split())


class RecipeEditLog(BaseModel):
    edited_at: datetime
    subjects: list[str]


class RecipeReview(BaseModel):
    id: UUID
    user_id: UUID
    is_mine: bool = False
    can_flag: bool = False
    flag_status: str | None = None
    flag_resolution: str | None = None
    user_name: str
    rating: int = Field(ge=1, le=5)
    comment: str | None = None
    date_submitted: datetime


class RecipeFeedbackFlagInput(BaseModel):
    description: str = Field(min_length=10, max_length=2000)

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Explain the inaccurate accusation in at least 10 characters.")
        return value


class RecipeReviewInput(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)

    @field_validator("comment")
    @classmethod
    def normalize_comment(cls, value: str | None) -> str | None:
        cleaned = " ".join(value.strip().split()) if value else ""
        return cleaned or None


class RecipeSummary(BaseModel):
    id: UUID
    title: str
    summary: str | None = None
    image_url: str | None = None
    cuisine: str | None = None
    difficulty: RecipeDifficulty
    prep_time: int | None = None
    cook_time: int | None = None
    total_time: int
    servings: int | None = None
    dietary_tags: list[str]
    allergen_tags: list[str]
    average_rating: float | None = None
    is_favourite: bool
    safety_warnings: list[str]
    is_owner: bool = False
    is_published: bool = True
    edit_log: list[RecipeEditLog] = Field(default_factory=list)
    smart_match_ingredients: list[str] = Field(default_factory=list)


class RecipeDetail(RecipeSummary):
    shared_group_ids: list[UUID] = Field(default_factory=list)
    can_review: bool = False
    review_eligibility_reason: str | None = None
    my_feedback_status: str | None = None
    my_feedback_resolution: str | None = None
    my_feedback_rating: int | None = None
    my_feedback_comment: str | None = None
    instructions: list[str]
    ingredients: list[RecipeIngredient]
    nutrition: RecipeNutrition
    author_name: str
    date_created: datetime
    reviews: list[RecipeReview] = Field(default_factory=list)


class RecipeList(BaseModel):
    items: list[RecipeSummary]
    total: int


class RecipeCreate(BaseModel):
    title: str = Field(min_length=2, max_length=150)
    summary: str | None = Field(default=None, max_length=300)
    image_url: str | None = Field(default=None, max_length=500)
    instructions: list[str] = Field(min_length=1, max_length=30)
    ingredients: list[RecipeIngredient] = Field(min_length=1, max_length=50)
    prep_time: int | None = Field(default=None, ge=0, le=1440)
    cook_time: int | None = Field(default=None, ge=0, le=1440)
    servings: int = Field(default=2, ge=1, le=100)
    cuisine: str | None = Field(default=None, max_length=50)
    dietary_tags: list[str] = Field(default_factory=list, max_length=20)
    allergen_tags: list[str] = Field(default_factory=list, max_length=20)
    nutrition: RecipeNutrition = Field(default_factory=RecipeNutrition)
    is_published: bool = True

    @field_validator("title", "summary", "cuisine")
    @classmethod
    def normalize_recipe_text(cls, value: str | None) -> str | None:
        return " ".join(value.strip().split()) if value else None

    @field_validator("dietary_tags", "allergen_tags")
    @classmethod
    def normalize_recipe_tags(cls, values: list[str]) -> list[str]:
        return _clean_terms(values)

    @field_validator("instructions")
    @classmethod
    def normalize_instructions(cls, values: list[str]) -> list[str]:
        return [" ".join(value.strip().split()) for value in values]

    @model_validator(mode="after")
    def validate_tags_against_ingredients(self) -> "RecipeCreate":
        quantity_issues = ingredient_quantity_issues(self.ingredients, self.servings)
        if quantity_issues:
            raise ValueError("Check ingredient quantities: " + " ".join(quantity_issues))
        if len(MEAL_TAGS.intersection(self.dietary_tags)) > 1:
            raise ValueError("Choose only one meal type.")
        ingredient_names = [ingredient.name.lower() for ingredient in self.ingredients]
        for diet, forbidden in DIETARY_FORBIDDEN.items():
            if diet not in self.dietary_tags:
                continue
            conflicts = sorted(
                {name for name in ingredient_names if any(term in name for term in forbidden)}
            )
            if conflicts:
                raise ValueError(f"The {diet} tag conflicts with: {', '.join(conflicts)}.")
        selected_allergens = set(self.allergen_tags)
        for diet, forbidden_allergens in DIETARY_ALLERGEN_CONFLICTS.items():
            conflicts = sorted(selected_allergens.intersection(forbidden_allergens))
            if diet in self.dietary_tags and conflicts:
                raise ValueError(
                    f"The {diet} tag conflicts with the selected allergens: {', '.join(conflicts)}."
                )
        if "high-protein" in self.dietary_tags and not any(
            any(term in name for term in HIGH_PROTEIN_INGREDIENTS) for name in ingredient_names
        ):
            raise ValueError("The high-protein tag requires a clear protein-rich ingredient.")
        return self


class RecipeScheduleInput(BaseModel):
    shared_group_id: UUID | None = None
    scheduled_date: date
    meal_slot: str = Field(
        pattern=r"^(breakfast|brunch|lunch|dinner|snacks|dessert|drink|teatime)$"
    )
    scheduled_time: time | None = None


class RecipeReportInput(BaseModel):
    reason: str = Field(pattern=r"^(inappropriate|misleading|unsafe|copyright|other)$")


class RecipeCalorieEstimateInput(BaseModel):
    ingredients: list[RecipeIngredient] = Field(min_length=1, max_length=50)
    servings: int = Field(ge=1, le=100)


class RecipeCalorieEstimate(BaseModel):
    calories_per_serving: int = Field(ge=0, le=10000)
    total_calories: int = Field(ge=0, le=100000)
    confidence: str = Field(pattern=r"^(low|medium|high)$")
    assumptions: list[str] = Field(default_factory=list, max_length=10)


class RecipeImageUpload(BaseModel):
    data: str = Field(min_length=1)
    content_type: str = Field(pattern=r"^image/(jpeg|png|webp)$")


class RecipeImageUploadResult(BaseModel):
    image_url: str


class RecipeCatalogueQuery(BaseModel):
    search: str | None = Field(default=None, max_length=100)
    cuisine: str | None = Field(default=None, max_length=50)
    dietary_tag: str | None = Field(default=None, max_length=50)
    max_total_time: int | None = Field(default=None, ge=1, le=1440)
    favourites_only: bool = False
    mine_only: bool = False
    community_only: bool = False

    @field_validator("search", "cuisine", "dietary_tag")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = " ".join(value.strip().lower().split())
        return cleaned or None


class RecipeSafetyProfile(BaseModel):
    allergies: list[str] = Field(default_factory=list)
    dietary_restrictions: list[str] = Field(default_factory=list)

    @field_validator("allergies", "dietary_restrictions")
    @classmethod
    def normalize_terms(cls, values: list[str]) -> list[str]:
        return _clean_terms(values)


def recipe_safety_warnings(
    allergens: list[str], dietary_tags: list[str], profile: RecipeSafetyProfile
) -> list[str]:
    normalized_allergens = set(_clean_terms(allergens))
    matched = sorted(normalized_allergens.intersection(profile.allergies))
    warnings = [f"Contains {allergen}" for allergen in matched]
    suitable = set(_clean_terms(dietary_tags))
    for restriction in profile.dietary_restrictions:
        if restriction not in suitable:
            warnings.append(f"Not confirmed suitable for {restriction}")
    return warnings
