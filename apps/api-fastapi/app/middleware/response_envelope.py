from datetime import datetime, timezone
import json
from uuid import uuid4

from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class ResponseEnvelopeMiddleware:
    """
    Wrap JSON responses in the standard CBT envelope.
    Implemented as pure ASGI middleware (BaseHTTPMiddleware deadlocks async DB on Windows).
    """

    EXCLUDED_PATHS = {"/docs", "/redoc", "/openapi.json"}

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        path = request.url.path
        if path in self.EXCLUDED_PATHS or path.startswith(("/docs", "/redoc")):
            await self.app(scope, receive, send)
            return

        body_chunks: list[bytes] = []
        status_code = 200
        response_headers: list[tuple[bytes, bytes]] = []
        more_body = True

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code, more_body
            if message["type"] == "http.response.start":
                status_code = message["status"]
                response_headers[:] = list(message.get("headers") or [])
                return
            if message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                if chunk:
                    body_chunks.append(chunk)
                more_body = bool(message.get("more_body"))
                if more_body:
                    return

                body_bytes = b"".join(body_chunks)
                request_id = (
                    scope.get("state", {}).get("request_id")
                    or _header_value(response_headers, b"x-request-id")
                    or str(uuid4())
                )
                now_iso = datetime.now(timezone.utc).isoformat()

                content_type = _header_value(response_headers, b"content-type") or ""
                if "application/json" not in content_type.lower():
                    await send(
                        {
                            "type": "http.response.start",
                            "status": status_code,
                            "headers": response_headers,
                        }
                    )
                    await send({"type": "http.response.body", "body": body_bytes, "more_body": False})
                    return

                if status_code == 204:
                    await send(
                        {
                            "type": "http.response.start",
                            "status": 204,
                            "headers": response_headers,
                        }
                    )
                    await send({"type": "http.response.body", "body": b"", "more_body": False})
                    return

                try:
                    data = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
                except Exception:
                    data = body_bytes.decode("utf-8", errors="ignore")

                if 200 <= status_code < 300:
                    if (
                        isinstance(data, dict)
                        and "success" in data
                        and "data" in data
                        and "timestamp" in data
                    ):
                        envelope = dict(data)
                        envelope["requestId"] = request_id
                    else:
                        envelope = {
                            "success": True,
                            "data": data,
                            "timestamp": now_iso,
                            "requestId": request_id,
                        }
                    new_body = json.dumps(envelope).encode("utf-8")
                elif status_code >= 400:
                    if isinstance(data, dict):
                        error_payload = dict(data)
                        if "detail" in data and "message" not in data:
                            error_payload["message"] = data["detail"]
                        if "message" not in error_payload:
                            error_payload["message"] = str(data.get("detail", "An error occurred"))
                        error_payload["statusCode"] = status_code
                        error_payload["error"] = error_payload.get("error", status_code)
                        error_payload["requestId"] = request_id
                    else:
                        error_payload = {
                            "statusCode": status_code,
                            "message": str(data),
                            "error": str(status_code),
                            "requestId": request_id,
                        }
                    new_body = json.dumps(error_payload).encode("utf-8")
                else:
                    await send(
                        {
                            "type": "http.response.start",
                            "status": status_code,
                            "headers": response_headers,
                        }
                    )
                    await send({"type": "http.response.body", "body": body_bytes, "more_body": False})
                    return

                headers = MutableHeaders(raw=response_headers)
                headers["content-type"] = "application/json"
                headers["content-length"] = str(len(new_body))
                headers["X-Request-ID"] = request_id

                await send(
                    {
                        "type": "http.response.start",
                        "status": status_code,
                        "headers": headers.raw,
                    }
                )
                await send({"type": "http.response.body", "body": new_body, "more_body": False})
                return

            await send(message)

        await self.app(scope, receive, send_wrapper)


def _header_value(headers: list[tuple[bytes, bytes]], name: bytes) -> str | None:
    for key, value in headers:
        if key.lower() == name:
            return value.decode("latin-1")
    return None
