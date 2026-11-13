from fastapi import APIRouter

from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.meta import router as meta_router
from app.api.v1.endpoints.profiles import router as profiles_router
from app.api.v1.endpoints.social import router as social_router
from app.api.v1.endpoints.orders import router as orders_router
from app.api.v1.endpoints.promos import router as promos_router
from app.api.v1.endpoints.inventory import router as inventory_router
from app.api.v1.endpoints.recipes import router as recipes_router
from app.api.v1.endpoints.meal_plans import router as meal_plans_router
from app.api.v1.endpoints.marketplace import router as marketplace_router
from app.api.v1.endpoints.vendor import router as vendor_router
from app.api.v1.endpoints.admin import router as admin_router
from app.api.v1.endpoints.stripe import router as stripe_router
from app.api.v1.endpoints.notifications import router as notifications_router
from app.api.v1.endpoints.scans import router as scans_router
from app.api.v1.endpoints.fridge_sensors import router as fridge_sensors_router
from app.api.v1.endpoints.chat import router as chat_router
from app.api.v1.endpoints.reports import router as reports_router

api_router = APIRouter()
api_router.include_router(meta_router, tags=["meta"])
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(auth_router, prefix="/auth", tags=["authentication"])
api_router.include_router(profiles_router, prefix="/profile", tags=["profile"])
api_router.include_router(social_router, prefix="/social", tags=["social"])
api_router.include_router(orders_router, prefix="/orders", tags=["orders"])
api_router.include_router(promos_router, prefix="/promos", tags=["promotions"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["inventory"])
api_router.include_router(recipes_router, prefix="/recipes", tags=["recipes"])
api_router.include_router(meal_plans_router, prefix="/meal-plans", tags=["meal-plans"])
api_router.include_router(marketplace_router, prefix="/marketplace", tags=["marketplace"])
api_router.include_router(vendor_router, prefix="/vendor", tags=["vendor"])
api_router.include_router(admin_router, prefix="/admin", tags=["administrator"])
api_router.include_router(stripe_router, prefix="/stripe", tags=["stripe"])
api_router.include_router(notifications_router, prefix="/notifications", tags=["notifications"])
api_router.include_router(scans_router, prefix="/scans", tags=["scans"])
api_router.include_router(fridge_sensors_router, prefix="/fridge-sensors", tags=["fridge sensors"])
api_router.include_router(chat_router, prefix="/chats", tags=["paid order chat"])

api_router.include_router(reports_router, prefix="/reports", tags=["reports and moderation"])

from app.api.v1.endpoints.vendor_feedback import (
    router as vendor_feedback_router,
    moderator_router as product_feedback_moderator_router,
)

api_router.include_router(vendor_feedback_router, prefix="/vendor", tags=["vendor feedback"])
api_router.include_router(
    product_feedback_moderator_router, prefix="/reports", tags=["feedback moderation"]
)
