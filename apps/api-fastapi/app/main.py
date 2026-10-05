import asyncio
import contextlib
import logging
import sys

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)
logging.getLogger("app.services.material_indexing").setLevel(logging.INFO)

# Psycopg async requires SelectorEventLoop on Windows (Python 3.14+ defaults to Proactor).
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import dispose_engine
from app.services.material_indexing import (
    indexing_watchdog_loop,
    resync_full_book_syllabi_from_text,
    resume_stuck_indexing_jobs,
)
from app.services.material_storage import pymupdf_available
from app.routers import auth, exam, role, user, tenant, permission, role_permission, role_matrix, question, health, stubs, curriculum, batches, materials, candidates, ai, analytics, onboarding, results, learning, exam_sessions, proctoring
from app.middleware import RequestIDMiddleware, ResponseEnvelopeMiddleware


# ============================================================
# APPLICATION
# ============================================================


async def _deferred_resume_stuck_indexing() -> None:
    """Resume stuck jobs after startup so health checks and first requests are not starved."""
    try:
        await asyncio.sleep(0.25)
        await resume_stuck_indexing_jobs()
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Deferred resume of stuck material indexing failed")


async def _background_full_book_syllabus_resync() -> None:
    try:
        # Let fresh uploads index first; resync re-reads every full-book PDF.
        await asyncio.sleep(600)
        await resync_full_book_syllabi_from_text()
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Background full-book syllabus resync failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not pymupdf_available():
        logger.warning(
            "PyMuPDF is not installed — PDF indexing will use slow pypdf fallback. "
            "Run: pip install pymupdf"
        )
    resume_task = asyncio.create_task(_deferred_resume_stuck_indexing())
    resync_task = asyncio.create_task(_background_full_book_syllabus_resync())
    watchdog = asyncio.create_task(indexing_watchdog_loop())
    try:
        yield
    finally:
        for task in (resume_task, resync_task, watchdog):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        with contextlib.suppress(Exception):
            await dispose_engine()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


# ============================================================
# CORS & MIDDLEWARE
# ============================================================

app.add_middleware(ResponseEnvelopeMiddleware)
app.add_middleware(RequestIDMiddleware)

_cors_kwargs: dict = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if settings.ENVIRONMENT.lower() == "development":
    # Local dev: web on :3002 uploads directly to FastAPI :8000 (LAN + localhost).
    _cors_kwargs["allow_origin_regex"] = (
        r"https?://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?"
    )
else:
    _cors_kwargs["allow_origins"] = settings.CORS_ORIGINS

app.add_middleware(CORSMiddleware, **_cors_kwargs)


# ============================================================
# ROUTERS
# ============================================================

app.include_router(
    auth.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    exam.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    role.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    user.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    tenant.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    permission.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    role_permission.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    role_matrix.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    question.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    health.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    curriculum.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    batches.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    materials.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    candidates.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    ai.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    analytics.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    onboarding.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    results.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    learning.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    exam_sessions.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    proctoring.router,
    prefix=settings.API_V1_STR,
)

app.include_router(
    stubs.router,
    prefix=settings.API_V1_STR,
)


# ============================================================
# ROOT
# ============================================================

@app.get("/")
async def root():
    return {
        "message": "CBT Platform API",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
async def health():
    return {
        "status": "healthy",
    }