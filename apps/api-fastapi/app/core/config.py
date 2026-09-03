import hashlib
import logging
import warnings
from typing import Any, Union

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    # ============================================================
    # APPLICATION - UPPERCASE (from .env)
    # ============================================================

    PROJECT_NAME: str = "CBT Platform API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"
    JWT_EXPIRY_MINUTES: int = 30 

    # ============================================================
    # DATABASE - UPPERCASE (from .env)
    # ============================================================

    DATABASE_URL: str = (
        "postgresql+psycopg://postgres:postgres@localhost:5432/cbt_db"
    )

    ASYNC_DATABASE_URL: str = (
        "postgresql+psycopg://postgres:postgres@localhost:5432/cbt_db"
    )

    # ============================================================
    # JWT / SECURITY - UPPERCASE (from .env)
    # ============================================================

    JWT_SECRET: str = (
        "change-this-in-production-super-secret-key-32bytes"
    )

    JWT_ALGORITHM: str = "HS256"

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15

    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ============================================================
    # BCRYPT - UPPERCASE (from .env)
    # ============================================================

    BCRYPT_ROUNDS: int = 4

    # ============================================================
    # CORS
    # ============================================================

    CORS_ORIGINS: Union[list[str], str] = Field(
        default=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3002",
            "http://127.0.0.1:3002",
        ],
        validation_alias=AliasChoices("CORS_ORIGINS", "BACKEND_CORS_ORIGINS"),
    )

    # ============================================================
    # LOWERCASE ALIASES (so both settings.PROJECT_NAME and 
    # settings.project_name work)
    # ============================================================

    @property
    def project_name(self) -> str:
        return self.PROJECT_NAME
    
    @property
    def version(self) -> str:
        return self.VERSION
    
    @property
    def api_v1_str(self) -> str:
        return self.API_V1_STR
    
    @property
    def log_level(self) -> str:
        return self.LOG_LEVEL
    
    @property
    def async_database_url(self) -> str:
        return self.ASYNC_DATABASE_URL
    
    @property
    def access_token_expire_minutes(self) -> int:
        return self.ACCESS_TOKEN_EXPIRE_MINUTES
    
    @property
    def refresh_token_expire_days(self) -> int:
        return self.REFRESH_TOKEN_EXPIRE_DAYS
    
    @property
    def bcrypt_rounds(self) -> int:
        return self.BCRYPT_ROUNDS

    # ============================================================
    # CORS PARSER
    # ============================================================

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Any) -> list[str]:

        if isinstance(v, str):

            if v.startswith("[") and v.endswith("]"):
                import json

                try:
                    result = json.loads(v)

                    if isinstance(result, list):
                        return [
                            str(item).strip()
                            for item in result
                            if str(item).strip()
                        ]

                except Exception:
                    pass

            return [
                item.strip()
                for item in v.split(",")
                if item.strip()
            ]

        if isinstance(v, list):
            return [
                str(item).strip()
                for item in v
                if str(item).strip()
            ]

        return [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]

    # ============================================================
    # SECURITY VALIDATION
    # ============================================================

    @model_validator(mode="after")
    def validate_security(self):

        if self.JWT_ALGORITHM != "HS256":
            raise ValueError(
                "This FastAPI JWT implementation requires HS256."
            )

        if not self.JWT_SECRET:
            raise ValueError(
                "JWT_SECRET must not be empty."
            )

        if len(self.JWT_SECRET) < 32:
            raise ValueError(
                "JWT_SECRET must contain at least 32 characters."
            )

        insecure_secret = (
            "change-this" in self.JWT_SECRET.lower()
        )

        if insecure_secret:

            message = (
                "JWT_SECRET is using the development/default secret. "
                "Use a unique secret for production."
            )

            if self.ENVIRONMENT.lower() == "production":
                raise ValueError(message)

            warnings.warn(message, UserWarning)

        if self.ACCESS_TOKEN_EXPIRE_MINUTES <= 0:
            raise ValueError(
                "ACCESS_TOKEN_EXPIRE_MINUTES must be positive."
            )

        if self.REFRESH_TOKEN_EXPIRE_DAYS <= 0:
            raise ValueError(
                "REFRESH_TOKEN_EXPIRE_DAYS must be positive."
            )

        if not 4 <= self.BCRYPT_ROUNDS <= 31:
            raise ValueError(
                "BCRYPT_ROUNDS must be between 4 and 31."
            )

        return self

    # ============================================================
    # PYDANTIC SETTINGS
    # ============================================================

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


# ================================================================
# SINGLE SETTINGS INSTANCE
# ================================================================

settings = Settings()


# ================================================================
# SAFE JWT CONFIG DEBUG
# ================================================================

def jwt_secret_fingerprint() -> str:
    """
    Returns a short SHA-256 fingerprint of JWT_SECRET.

    This does NOT expose the actual secret.
    It is useful for detecting secret mismatches.
    """

    return hashlib.sha256(
        settings.JWT_SECRET.encode("utf-8")
    ).hexdigest()[:16]


print("==============================================")
print("CBT PLATFORM CONFIG LOADED")
print("==============================================")
print("JWT ALGORITHM :", settings.JWT_ALGORITHM)
print("JWT SECRET LEN:", len(settings.JWT_SECRET))
print("JWT FINGERPRINT:", jwt_secret_fingerprint())
print("JWT EXPIRY    :", settings.ACCESS_TOKEN_EXPIRE_MINUTES, "minutes")
print("==============================================") 