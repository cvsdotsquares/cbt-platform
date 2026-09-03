import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_health_check_returns_envelope(client: AsyncClient):
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    
    payload = response.json()
    assert payload["success"] is True
    assert "data" in payload
    assert payload["data"]["status"] == "ok"
    assert "timestamp" in payload
    assert "requestId" in payload
    assert response.headers.get("X-Request-ID") == payload["requestId"]


@pytest.mark.anyio
async def test_request_id_propagation(client: AsyncClient):
    custom_id = "custom-req-12345"
    response = await client.get("/api/v1/health", headers={"X-Request-ID": custom_id})
    assert response.status_code == 200
    
    payload = response.json()
    assert payload["requestId"] == custom_id
    assert response.headers.get("X-Request-ID") == custom_id


@pytest.mark.anyio
async def test_docs_and_openapi(client: AsyncClient):
    docs_res = await client.get("/docs")
    assert docs_res.status_code == 200

    openapi_res = await client.get("/openapi.json")
    assert openapi_res.status_code == 200
    openapi_json = openapi_res.json()
    assert openapi_json["info"]["title"] == "CBT Platform API"
