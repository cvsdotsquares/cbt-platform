from datetime import datetime, timezone
import html
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
                now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

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
                    payload = envelope
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
                    payload = error_payload
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
                if _browser_document_request(scope):
                    # Chrome's built-in JSON viewer often paints a blank page.
                    # Address-bar visits get a readable HTML view; API clients still get JSON.
                    new_body = _json_html_page(payload).encode("utf-8")
                    headers["content-type"] = "text/html; charset=utf-8"
                else:
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


def _scope_header(scope: Scope, name: bytes) -> str:
    for key, value in scope.get("headers") or []:
        if key.lower() == name:
            return value.decode("latin-1")
    return ""


def _browser_document_request(scope: Scope) -> bool:
    """True for an address-bar visit. fetch() and the Next.js proxy are not document navigations."""
    if _scope_header(scope, b"sec-fetch-dest").strip().lower() == "document":
        return True
    if _scope_header(scope, b"sec-fetch-mode").strip().lower() == "navigate":
        return True
    first = _scope_header(scope, b"accept").split(",", 1)[0].split(";", 1)[0].strip().lower()
    return first == "text/html"


def _json_html_page(payload: object) -> str:
    pretty = html.escape(json.dumps(payload, indent=2))
    return (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
        "<title>CBT Platform API</title>"
        "<style>"
        "html,body{margin:0;background:#111;color:#e8eaed}"
        "pre{margin:0;padding:16px;font:14px/1.5 Consolas,monospace;white-space:pre-wrap}"
        "</style></head><body><pre>"
        f"{pretty}</pre></body></html>"
    )
