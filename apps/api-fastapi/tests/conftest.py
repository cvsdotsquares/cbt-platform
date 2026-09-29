import pytest
import subprocess
import sys
from pathlib import Path

from httpx import ASGITransport, AsyncClient
from app.main import app
import app.routers.auth as _auth_mod


@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    """Run alembic upgrade head once before the whole test session."""
    project_root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(project_root),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        combined = f"{result.stdout}\n{result.stderr}"
        # Local dev DB is often created by Prisma first; stamp Alembic to head then continue.
        if "already exists" in combined or "DuplicateTable" in combined:
            subprocess.run(
                [sys.executable, "-m", "alembic", "stamp", "head"],
                cwd=str(project_root),
                check=True,
            )
        else:
            raise subprocess.CalledProcessError(
                result.returncode,
                result.args,
                result.stdout,
                result.stderr,
            )
    yield


@pytest.fixture(scope="session", autouse=True)
def disable_rate_limiting():
    """Disable the in-process login rate limiter for the test session.

    Without this, running 80+ login calls from the same IP (testserver)
    inside 60 seconds triggers the 429 guard and breaks unrelated tests.
    """
    _auth_mod._RATE_LIMITING_DISABLED = True
    yield
    _auth_mod._RATE_LIMITING_DISABLED = False


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c
