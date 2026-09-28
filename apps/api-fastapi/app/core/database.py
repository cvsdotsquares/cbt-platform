import asyncio
import contextlib
import os
import sys

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.config import settings
from app.models.base import Base

_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "10"))
_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "20"))

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

# Create async engine (use async driver URL)
_db_url = settings.ASYNC_DATABASE_URL or settings.DATABASE_URL
engine = create_async_engine(
    _db_url,
    echo=False,
    future=True,
    pool_pre_ping=True,
    pool_size=_POOL_SIZE,
    max_overflow=_MAX_OVERFLOW,
    pool_timeout=30,
    pool_recycle=1800,
    pool_reset_on_return="rollback",
    # Avoid psycopg pipeline/prepared-statement issues when requests are cancelled (uvicorn --reload).
    connect_args={"connect_timeout": 10, "prepare_threshold": None},
)

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncSession:
    """Dependency for getting database session."""
    session = AsyncSessionLocal()
    try:
        yield session
        await session.commit()
    except asyncio.CancelledError:
        with contextlib.suppress(Exception):
            await session.rollback()
        raise
    except Exception:
        with contextlib.suppress(Exception):
            await session.rollback()
        raise
    finally:
        with contextlib.suppress(Exception):
            await session.close()


async def dispose_engine() -> None:
    """Release pool connections on app shutdown (clean uvicorn --reload / SIGINT)."""
    await engine.dispose()