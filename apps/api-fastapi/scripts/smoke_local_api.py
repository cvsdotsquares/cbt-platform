"""Smoke-test local FastAPI against a running server (default http://127.0.0.1:8000)."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("SMOKE_API_BASE", "http://127.0.0.1:8000/api/v1").rstrip("/")
TENANT = os.environ.get("SMOKE_TENANT_ID", "17d19b56-d1d4-41f4-91c1-da9030d837bd")
EMAIL = os.environ.get("SMOKE_EMAIL", "admin@cbt-platform.com")
PASSWORD = os.environ.get("SMOKE_PASSWORD", "Admin@123")


def req(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, str]:
    url = f"{BASE}{path}"
    headers = {"Content-Type": "application/json", "X-Tenant-Id": TENANT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def main() -> int:
    failures = 0

    def check(name: str, status: int, body: str, ok: set[int] = {200}) -> None:
        nonlocal failures
        ok_str = ", ".join(str(c) for c in sorted(ok))
        if status not in ok:
            failures += 1
            print(f"FAIL {name} HTTP {status} (expected {ok_str})")
            print(body[:500])
        else:
            print(f"OK   {name} HTTP {status}")

    status, body = req("GET", "/health")
    check("health", status, body)

    status, body = req("GET", "/ai/status")
    check("ai/status", status, body)
    ai = json.loads(body).get("data") or json.loads(body)
    if not ai.get("openaiConfigured"):
        print("WARN OPENAI_API_KEY not configured — AI test create will return 503")

    status, body = req(
        "POST",
        "/auth/login",
        {"email": EMAIL, "password": PASSWORD, "deviceFingerprint": "smoke-local"},
    )
    check("auth/login", status, body, ok={200, 201})
    if status not in {200, 201}:
        return 1
    login = json.loads(body)
    data = login.get("data") or login
    token = data.get("access_token") or data.get("accessToken") or login.get("accessToken")
    if not token:
        print("FAIL no access token in login response")
        return 1

    for path in (
        "/auth/effective-permissions",
        "/batches",
        "/materials",
        "/onboarding/setup-status",
    ):
        status, body = req("GET", path, token=token)
        check(path, status, body)

    print(f"\n{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
