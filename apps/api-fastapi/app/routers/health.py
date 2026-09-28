from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("", summary="Health check endpoint")
async def health_check():
    """
    Basic health check returning API status and current UTC timestamp.
    """
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@router.get("/ready", summary="Readiness check with database connection test")
async def readiness_check(db: AsyncSession = Depends(get_db)):
    """
    Readiness check testing database connection via SELECT 1.
    """
    try:
        result = await db.execute(text("SELECT 1"))
        result.scalar()
        return {
            "status": "ready",
            "database": "connected",
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "status": "not_ready",
                "database": "disconnected",
                "reason": str(exc),
            },
        )
