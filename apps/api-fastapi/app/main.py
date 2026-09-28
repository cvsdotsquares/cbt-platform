import asyncio
import contextlib
import sys

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
from app.services.material_indexing import indexing_watchdog_loop, resume_stuck_indexing_jobs
from app.routers import auth, exam, role, user, tenant, permission, role_permission, role_matrix, question, health, stubs, curriculum, batches, materials, candidates, ai, analytics, onboarding, results, learning, exam_sessions, proctoring
from app.middleware import RequestIDMiddleware, ResponseEnvelopeMiddleware


# ============================================================
# APPLICATION
# ============================================================


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await resume_stuck_indexing_jobs()
    watchdog = asyncio.create_task(indexing_watchdog_loop())
    try:
        yield
    finally:
        watchdog.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watchdog
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