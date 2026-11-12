from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from the API's untracked .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = Field(default="development", validation_alias="ECOCHEF_ENV")
    log_level: str = Field(default="INFO", validation_alias="ECOCHEF_LOG_LEVEL")
    api_prefix: str = Field(default="/api/v1", validation_alias="ECOCHEF_API_PREFIX")
    database_url: str = Field(validation_alias="DATABASE_URL")
    firebase_project_id: str = Field(validation_alias="FIREBASE_PROJECT_ID")
    gemini_api_key: str | None = Field(default=None, validation_alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-3.5-flash-lite", validation_alias="GEMINI_MODEL")
    ingredient_detection_api_url: str | None = Field(
        default=None, validation_alias="INGREDIENT_DETECTION_API_URL"
    )
    freshness_model_api_url: str | None = Field(
        default=None, validation_alias="FRESHNESS_MODEL_API_URL"
    )
    geoapify_api_key: str | None = Field(default=None, validation_alias="GEOAPIFY_API_KEY")
    stripe_api_key: SecretStr | None = Field(default=None, validation_alias="STRIPE_API_KEY")
    stripe_webhook_secret: SecretStr | None = Field(
        default=None, validation_alias="STRIPE_WEBHOOK_SECRET"
    )
    stripe_api_version: str = Field(
        default="2026-09-30.endive", validation_alias="STRIPE_API_VERSION"
    )
    stripe_currency: str = Field(default="myr", validation_alias="STRIPE_CURRENCY")
    stripe_simulated_payments_enabled: bool = Field(
        default=False, validation_alias="STRIPE_SIMULATED_PAYMENTS_ENABLED"
    )
    stripe_mobile_return_url: str = Field(
        default="ecochef://marketplace/cart", validation_alias="STRIPE_MOBILE_RETURN_URL"
    )
    stripe_connect_refresh_url: str = Field(
        default="http://localhost:3000/vendor/store?stripe=refresh",
        validation_alias="STRIPE_CONNECT_REFRESH_URL",
    )
    stripe_connect_return_url: str = Field(
        default="http://localhost:3000/vendor/store?stripe=complete",
        validation_alias="STRIPE_CONNECT_RETURN_URL",
    )
    expo_push_access_token: SecretStr | None = Field(
        default=None, validation_alias="EXPO_PUSH_ACCESS_TOKEN"
    )
    firebase_credentials_path: str | None = Field(
        default=None, validation_alias="FIREBASE_CREDENTIALS_PATH"
    )
    firebase_credentials_json: SecretStr | None = Field(
        default=None, validation_alias="FIREBASE_CREDENTIALS_JSON"
    )
    cors_allowed_origins: str = Field(
        default=(
            "http://localhost:3000,http://127.0.0.1:3000,"
            "http://localhost:3001,http://127.0.0.1:3001"
        ),
        validation_alias="ECOCHEF_CORS_ALLOWED_ORIGINS",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
