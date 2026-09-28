"""Local dev server entrypoint (Windows-safe async PostgreSQL)."""

from __future__ import annotations

import asyncio
import os
import selectors
import subprocess
import sys
import time

DEV_PORT = 8000


def _release_port(port: int) -> None:
    """Free the dev port so only one local API instance runs (Windows uvicorn reload orphans)."""
    if sys.platform == "win32":
        script = (
            f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | "
            "ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
        )
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            check=False,
            capture_output=True,
            text=True,
        )
        time.sleep(0.5)
        return
    subprocess.run(
        ["fuser", "-k", f"{port}/tcp"],
        check=False,
        capture_output=True,
        text=True,
    )
    time.sleep(0.5)


async def _serve() -> None:
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = DEV_PORT
    reload = os.getenv("UVICORN_RELOAD", "0") not in ("0", "false", "False")

    if reload and sys.platform == "win32":
        print(
            "Warning: uvicorn --reload on Windows uses ProactorEventLoop and breaks async PostgreSQL. "
            "Running without reload. Set UVICORN_RELOAD=0 or use Linux/WSL for reload.",
            file=sys.stderr,
        )
        reload = False

    config = uvicorn.Config(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        loop="asyncio",
    )
    server = uvicorn.Server(config)
    await server.serve()


def main() -> None:
    if os.getenv("PORT") not in (None, "", str(DEV_PORT)):
        print(
            f"Note: run_dev always uses port {DEV_PORT} (ignoring PORT={os.getenv('PORT')!r}).",
            file=sys.stderr,
        )
    _release_port(DEV_PORT)
    if sys.platform == "win32":
        factory = lambda: asyncio.SelectorEventLoop(selectors.SelectSelector())
        asyncio.run(_serve(), loop_factory=factory)
        return
    asyncio.run(_serve())


if __name__ == "__main__":
    main()
