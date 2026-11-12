from uuid import UUID

from datetime import datetime

from pydantic import BaseModel


class SocialUser(BaseModel):
    id: UUID
    name: str
    profile_picture_url: str | None = None


class SocialState(BaseModel):
    requests: list[SocialUser]
    pending: list[SocialUser]
    friends: list[SocialUser]
    suggestions: list[SocialUser]
    blocked: list[SocialUser]


class SocialProfile(BaseModel):
    id: UUID
    name: str
    profile_picture_url: str | None
    member_since: datetime
    details_visible: bool
    relationship: str
    mutual_friends: int
    mutual_friend_users: list[SocialUser]
    bio: str | None = None
    dietary_restrictions: list[str] | None = None
    allergies: list[str] | None = None
    food_dislikes: list[str] | None = None
    food_saved_kg: float | None = None
    eco_points: int | None = None
    recipes: int | None = None
