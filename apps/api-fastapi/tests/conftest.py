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
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(project_root),
        check=True,
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
