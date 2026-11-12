from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.service import require_roles
from app.schemas.auth import AccountRole, AuthenticatedUser
from app.schemas.social import SocialProfile, SocialState, SocialUser

router = APIRouter()
CurrentConsumer = Depends(require_roles(AccountRole.consumer))


class GroupNameUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("Enter a group name.")
        return name


def _lock_social_pair(session: Session, me: UUID, them: UUID) -> None:
    if me == them:
        raise HTTPException(400, "Choose another user.")
    # A stable user lock order serializes opposite-direction requests and blocks.
    targets = session.execute(text("""
        SELECT id FROM users WHERE id IN (:me, :them) ORDER BY id FOR UPDATE
    """), {"me": me, "them": them}).scalars().all()
    if them not in targets:
        raise HTTPException(404, "User not found.")


def _is_blocked(session: Session, me: UUID, them: UUID) -> bool:
    return bool(session.execute(text("""
        SELECT EXISTS(SELECT 1 FROM user_blocks WHERE
          (blocker_user_id = :me AND blocked_user_id = :them)
          OR (blocker_user_id = :them AND blocked_user_id = :me))
    """), {"me": me, "them": them}).scalar_one())


def _users(session: Session, user_id: UUID, relation: str) -> list[SocialUser]:
    if relation == "incoming":
        query = "SELECT u.id, u.name, u.profile_picture_url FROM friendships f JOIN users u ON u.id = f.user_id_1 WHERE f.user_id_2 = :user_id AND f.status = 'pending'"
    elif relation == "outgoing":
        query = "SELECT u.id, u.name, u.profile_picture_url FROM friendships f JOIN users u ON u.id = f.user_id_2 WHERE f.user_id_1 = :user_id AND f.status = 'pending'"
    else:
        query = """SELECT u.id, u.name, u.profile_picture_url FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_id_1 = :user_id THEN f.user_id_2 ELSE f.user_id_1 END
            WHERE (f.user_id_1 = :user_id OR f.user_id_2 = :user_id) AND f.status = 'accepted'"""
    rows = session.execute(text(query), {"user_id": user_id}).mappings().all()
    return [SocialUser(**row) for row in rows]


@router.get("/me", response_model=SocialState)
def get_social_state(current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> SocialState:
    incoming = _users(session, current_user.id, "incoming")
    outgoing = _users(session, current_user.id, "outgoing")
    friends = _users(session, current_user.id, "friends")
    blocked_rows = session.execute(text("SELECT u.id, u.name, u.profile_picture_url FROM user_blocks b JOIN users u ON u.id = b.blocked_user_id WHERE b.blocker_user_id = :user_id ORDER BY u.name"), {"user_id": current_user.id}).mappings().all()
    suggestions = session.execute(text("""SELECT u.id, u.name, u.profile_picture_url FROM users u WHERE u.id <> :user_id
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = :user_id AND b.blocked_user_id = u.id) OR (b.blocker_user_id = u.id AND b.blocked_user_id = :user_id))
        AND NOT EXISTS (SELECT 1 FROM friendships f WHERE (f.user_id_1 = :user_id AND f.user_id_2 = u.id) OR (f.user_id_2 = :user_id AND f.user_id_1 = u.id)) ORDER BY u.name LIMIT 20"""), {"user_id": current_user.id}).mappings().all()
    return SocialState(requests=incoming, pending=outgoing, friends=friends, suggestions=[SocialUser(**row) for row in suggestions], blocked=[SocialUser(**row) for row in blocked_rows])


@router.get("/users/{user_id}/profile", response_model=SocialProfile)
def get_social_profile(user_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> SocialProfile:
    if user_id != current_user.id and _is_blocked(session, current_user.id, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    row = session.execute(text("""
        SELECT u.id, u.name, u.profile_picture_url, u.date_joined AS member_since, u.bio,
               COALESCE(p.profile_visibility, 'public') AS profile_visibility,
               COALESCE(p.dietary_restrictions, '{}') AS dietary_restrictions,
               COALESCE(p.allergies, '{}') AS allergies,
               COALESCE(p.food_dislikes, '{}') AS food_dislikes,
               (SELECT COUNT(*) FROM recipes r WHERE r.user_id = u.id) AS recipes
        FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id
        WHERE u.id = :user_id
    """), {"user_id": user_id}).mappings().one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    accepted = bool(session.execute(text("""
        SELECT EXISTS(SELECT 1 FROM friendships WHERE status = 'accepted' AND
        ((user_id_1 = :me AND user_id_2 = :them) OR (user_id_1 = :them AND user_id_2 = :me)))
    """), {"me": current_user.id, "them": user_id}).scalar_one())
    relation = session.execute(text("""
        SELECT CASE
          WHEN EXISTS(SELECT 1 FROM user_blocks WHERE blocker_user_id = :me AND blocked_user_id = :them) THEN 'blocked'
          WHEN EXISTS(SELECT 1 FROM friendships WHERE status = 'accepted' AND ((user_id_1 = :me AND user_id_2 = :them) OR (user_id_1 = :them AND user_id_2 = :me))) THEN 'friends'
          WHEN EXISTS(SELECT 1 FROM friendships WHERE status = 'pending' AND user_id_1 = :me AND user_id_2 = :them) THEN 'request_sent'
          WHEN EXISTS(SELECT 1 FROM friendships WHERE status = 'pending' AND user_id_1 = :them AND user_id_2 = :me) THEN 'request_received'
          ELSE 'none' END
    """), {"me": current_user.id, "them": user_id}).scalar_one()
    mutual_rows = session.execute(text("""
        WITH mine AS (
          SELECT CASE WHEN user_id_1 = :me THEN user_id_2 ELSE user_id_1 END id FROM friendships
          WHERE status = 'accepted' AND (user_id_1 = :me OR user_id_2 = :me)
        ), theirs AS (
          SELECT CASE WHEN user_id_1 = :them THEN user_id_2 ELSE user_id_1 END id FROM friendships
          WHERE status = 'accepted' AND (user_id_1 = :them OR user_id_2 = :them)
        ) SELECT u.id, u.name FROM mine JOIN theirs USING (id) JOIN users u USING (id) ORDER BY u.name
    """), {"me": current_user.id, "them": user_id}).mappings().all()
    visible = user_id == current_user.id or row["profile_visibility"] == "public" or (row["profile_visibility"] == "friends_only" and accepted)
    basic = {"id": row["id"], "name": row["name"], "profile_picture_url": row["profile_picture_url"], "member_since": row["member_since"], "details_visible": visible, "relationship": relation, "mutual_friends": len(mutual_rows), "mutual_friend_users": [SocialUser(**item) for item in mutual_rows]}
    if not visible:
        return SocialProfile(**basic)
    return SocialProfile(**basic, bio=row["bio"], dietary_restrictions=row["dietary_restrictions"], allergies=row["allergies"], food_dislikes=row["food_dislikes"], food_saved_kg=0, eco_points=0, recipes=row["recipes"])


@router.post("/users/{user_id}/request", status_code=status.HTTP_204_NO_CONTENT)
def send_request(user_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    _lock_social_pair(session, current_user.id, user_id)
    if _is_blocked(session, current_user.id, user_id):
        raise HTTPException(403, "A friend request cannot be sent to this user.")
    existing = session.execute(text("""
        SELECT user_id_1, status FROM friendships WHERE
          (user_id_1 = :me AND user_id_2 = :them)
          OR (user_id_1 = :them AND user_id_2 = :me)
    """), {"me": current_user.id, "them": user_id}).all()
    if any(row.status == "accepted" or row.user_id_1 == current_user.id for row in existing):
        return
    if existing:
        raise HTTPException(409, "This user has already requested to be your friend. Accept their request instead.")
    session.execute(text("INSERT INTO friendships (user_id_1, user_id_2, status) VALUES (:me, :them, 'pending') ON CONFLICT (user_id_1, user_id_2) DO NOTHING"), {"me": current_user.id, "them": user_id}); session.commit()


@router.post("/users/{user_id}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_request(user_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    _lock_social_pair(session, current_user.id, user_id)
    if _is_blocked(session, current_user.id, user_id):
        raise HTTPException(403, "This friend request is no longer available.")
    result = session.execute(text("UPDATE friendships SET status = 'accepted' WHERE user_id_1 = :them AND user_id_2 = :me AND status = 'pending'"), {"me": current_user.id, "them": user_id})
    if result.rowcount != 1: raise HTTPException(404, "Friend request not found.")
    session.commit()


@router.delete("/users/{user_id}/relationship", status_code=status.HTTP_204_NO_CONTENT)
def remove_relationship(user_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    session.execute(text("DELETE FROM friendships WHERE (user_id_1 = :me AND user_id_2 = :them) OR (user_id_1 = :them AND user_id_2 = :me)"), {"me": current_user.id, "them": user_id}); session.commit()


@router.post("/users/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
def block_user(user_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    _lock_social_pair(session, current_user.id, user_id)
    session.execute(text("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (:me, :them) ON CONFLICT DO NOTHING"), {"me": current_user.id, "them": user_id})
    session.execute(text("DELETE FROM friendships WHERE (user_id_1 = :me AND user_id_2 = :them) OR (user_id_1 = :them AND user_id_2 = :me)"), {"me": current_user.id, "them": user_id}); session.commit()


@router.delete("/users/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
def unblock_user(user_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    session.execute(text("DELETE FROM user_blocks WHERE blocker_user_id = :me AND blocked_user_id = :them"), {"me": current_user.id, "them": user_id}); session.commit()


@router.get("/groups/me")
def my_cooking_groups(current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> dict:
    rows = session.execute(text("""
        SELECT g.id, CASE WHEN g.group_name = 'Cooking group' THEN owner.name || '''s Cooking Group' ELSE g.group_name END AS name, g.created_by_user_id AS owner_id, owner.name AS owner_name, mine.status, (g.created_by_user_id=:me) AS is_owner,
          COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'profile_picture_url', u.profile_picture_url, 'status', m.status) ORDER BY u.name)
                    FROM group_members m JOIN users u ON u.id=m.user_id
                    WHERE m.group_id=g.id AND m.status IN ('active','pending')), '[]') AS members
        FROM user_groups g JOIN group_members mine ON mine.group_id=g.id AND mine.user_id=:me
        JOIN users owner ON owner.id=g.created_by_user_id
        WHERE mine.status IN ('active','pending') ORDER BY g.created_date, g.id
    """), {"me": current_user.id}).mappings().all()
    return {"items": [dict(row) for row in rows]}


@router.put("/groups/{group_id}/name", status_code=204)
def rename_cooking_group(group_id: UUID, request: GroupNameUpdate, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    changed = session.execute(text("""
        UPDATE user_groups SET group_name = :name
        WHERE id = :group AND created_by_user_id = :owner
        RETURNING id
    """), {"name": request.name, "group": group_id, "owner": current_user.id}).scalar_one_or_none()
    if changed is None:
        raise HTTPException(404, "Cooking group not found or you cannot edit its name.")
    session.commit()


@router.post("/groups/members/{user_id}", status_code=204)
def invite_cooking_member(user_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    _lock_social_pair(session, current_user.id, user_id)
    accepted = session.execute(text("""SELECT EXISTS(SELECT 1 FROM friendships WHERE status='accepted' AND
        ((user_id_1=:me AND user_id_2=:them) OR (user_id_1=:them AND user_id_2=:me)))"""), {"me":current_user.id,"them":user_id}).scalar_one()
    if not accepted or _is_blocked(session,current_user.id,user_id):
        raise HTTPException(403,"Only unblocked friends can be invited to your cooking group.")
    group_id = session.execute(text("SELECT id FROM user_groups WHERE created_by_user_id=:me ORDER BY created_date,id LIMIT 1 FOR UPDATE"), {"me":current_user.id}).scalar_one_or_none()
    if group_id is None:
        group_id = session.execute(text("INSERT INTO user_groups(group_name,created_by_user_id) VALUES (:name,:me) RETURNING id"), {"name":f"{current_user.name}'s Cooking Group","me":current_user.id}).scalar_one()
        session.execute(text("INSERT INTO group_members(group_id,user_id,status) VALUES (:group,:me,'active')"), {"group":group_id,"me":current_user.id})
    session.execute(text("""INSERT INTO group_members(group_id,user_id,status) VALUES (:group,:them,'pending')
        ON CONFLICT(group_id,user_id) DO NOTHING"""), {"group":group_id,"them":user_id})
    session.commit()


@router.post("/groups/{group_id}/members/{user_id}", status_code=204)
def invite_member_to_cooking_group(group_id: UUID, user_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    _lock_social_pair(session, current_user.id, user_id)
    owner = session.execute(text("SELECT created_by_user_id FROM user_groups WHERE id=:group FOR UPDATE"), {"group": group_id}).scalar_one_or_none()
    if owner != current_user.id:
        raise HTTPException(403, "Only the group host can invite members.")
    accepted = session.execute(text("""SELECT EXISTS(SELECT 1 FROM friendships WHERE status='accepted' AND
        ((user_id_1=:me AND user_id_2=:them) OR (user_id_1=:them AND user_id_2=:me)))"""), {"me": current_user.id, "them": user_id}).scalar_one()
    if not accepted or _is_blocked(session, current_user.id, user_id):
        raise HTTPException(403, "Only unblocked friends can be invited to your cooking group.")
    session.execute(text("""INSERT INTO group_members(group_id,user_id,status) VALUES (:group,:them,'pending')
        ON CONFLICT(group_id,user_id) DO NOTHING"""), {"group": group_id, "them": user_id})
    session.commit()


@router.delete("/groups/members/{user_id}", status_code=204)
def remove_cooking_member(user_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    session.execute(text("SELECT id FROM user_groups WHERE created_by_user_id=:me FOR UPDATE"), {"me":current_user.id}).all()
    session.execute(text("""DELETE FROM group_members m USING user_groups g
        WHERE m.group_id=g.id AND g.created_by_user_id=:me AND m.user_id=:them AND m.user_id<>:me"""), {"me":current_user.id,"them":user_id})
    session.commit()


@router.post("/groups/{group_id}/join", status_code=204)
def join_cooking_group(group_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    owner = session.execute(text("SELECT created_by_user_id FROM user_groups WHERE id=:group FOR UPDATE"), {"group":group_id}).scalar_one_or_none()
    if owner is None or _is_blocked(session,current_user.id,owner):
        raise HTTPException(404,"Group invitation not found.")
    joined = session.execute(text("""UPDATE group_members SET status='active' WHERE group_id=:group
        AND user_id=:me AND status IN ('pending','active') RETURNING user_id"""), {"group":group_id,"me":current_user.id}).scalar_one_or_none()
    if joined is None:
        raise HTTPException(403,"An invitation is required to join this group.")
    session.commit()


@router.delete("/groups/{group_id}/membership", status_code=204)
def leave_cooking_group(group_id: UUID, current_user: AuthenticatedUser = CurrentConsumer, session: Session = Depends(get_db_session)) -> None:
    owner = session.execute(text("SELECT created_by_user_id FROM user_groups WHERE id=:group FOR UPDATE"), {"group":group_id}).scalar_one_or_none()
    if owner == current_user.id:
        raise HTTPException(409,"Remove members individually from the group you created.")
    session.execute(text("DELETE FROM group_members WHERE group_id=:group AND user_id=:me"), {"group":group_id,"me":current_user.id})
    session.commit()
