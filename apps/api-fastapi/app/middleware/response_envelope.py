from datetime import datetime, timezone
import json
from uuid import uuid4
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response


class ResponseEnvelopeMiddleware(BaseHTTPMiddleware):
    """
    Middleware that formats successful JSON responses into standard CBT response envelope:
    {
      "success": true,
      "data": { ... },
      "timestamp": "2026-08-11T17:00:15.123456Z",
      "requestId": "..."
    }
    And formats error responses with message and statusCode fields.
    """

    EXCLUDED_PATHS = {"/docs", "/redoc", "/openapi.json"}

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Pass documentation and OpenAPI endpoints through unwrapped
        if request.url.path in self.EXCLUDED_PATHS or request.url.path.startswith(
            ("/docs", "/redoc")
        ):
            return await call_next(request)

        response = await call_next(request)

        content_type = response.headers.get("content-type", "")
        if "application/json" not in content_type:
            return response

        # Consume body
        body_bytes = b""
        async for chunk in response.body_iterator:
            body_bytes += chunk

        request_id = getattr(
            request.state,
            "request_id",
            response.headers.get("X-Request-ID") or str(uuid4()),
        )
        now_iso = datetime.now(timezone.utc).isoformat()

        try:
            data = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            data = body_bytes.decode("utf-8", errors="ignore")

        # 2xx Success responses
        if 200 <= response.status_code < 300:
            if response.status_code == 204:
                return Response(status_code=204, headers=dict(response.headers))

            if (
                isinstance(data, dict)
                and "success" in data
                and "data" in data
                and "timestamp" in data
            ):
                envelope = data
                envelope["requestId"] = request_id
            else:
                envelope = {
                    "success": True,
                    "data": data,
                    "timestamp": now_iso,
                    "requestId": request_id,
                }

            new_body = json.dumps(envelope).encode("utf-8")
            headers = dict(response.headers)
            headers["content-length"] = str(len(new_body))
            headers["content-type"] = "application/json"
            headers["X-Request-ID"] = request_id

            return Response(
                content=new_body,
                status_code=response.status_code,
                headers=headers,
                media_type="application/json",
            )

        # 4xx and 5xx Error responses
        if response.status_code >= 400:
            error_payload = {}
            if isinstance(data, dict):
                error_payload = dict(data)
                if "detail" in data and "message" not in data:
                    error_payload["message"] = data["detail"]
                if "message" not in error_payload:
                    error_payload["message"] = str(data.get("detail", "An error occurred"))
                error_payload["statusCode"] = response.status_code
                error_payload["error"] = error_payload.get("error", response.status_code)
                error_payload["requestId"] = request_id
            else:
                error_payload = {
                    "statusCode": response.status_code,
                    "message": str(data),
                    "error": str(response.status_code),
                    "requestId": request_id,
                }

            new_body = json.dumps(error_payload).encode("utf-8")
            headers = dict(response.headers)
            headers["content-length"] = str(len(new_body))
            headers["content-type"] = "application/json"
            headers["X-Request-ID"] = request_id

            return Response(
                content=new_body,
                status_code=response.status_code,
                headers=headers,
                media_type="application/json",
            )

        return response
