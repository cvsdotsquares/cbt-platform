# CBT Platform — FastAPI Backend

Enterprise Computer-Based Test (CBT) Examination Management Backend built with FastAPI, Python, PostgreSQL, SQLAlchemy 2.0, and Alembic.

## Features (Phase 1 Foundation)

- **FastAPI 0.110+**: Asynchronous ASGI framework.
- **SQLAlchemy 2.0 Async ORM**: Declarative models with timezone-aware UTC timestamps and UUID primary keys.
- **Alembic Migrations**: Explicit database schema migrations.
- **Pydantic v2 Settings**: Environment validation via `pydantic-settings`.
- **Request ID Middleware**: Propagates `X-Request-ID` across all requests.
- **Response Envelope**: Wraps responses in standard `{ "success": true, "data": ..., "timestamp": ..., "requestId": ... }`.
- **Global Error Handling**: Standardized error responses matching frontend expectations.

## Directory Structure

```text
app/
  main.py                # Application entrypoint & middleware setup
  core/
    config.py            # Pydantic environment configuration
    database.py          # SQLAlchemy 2.0 async engine & session factory
    security.py          # Security and JWT helper utilities
  models/
    base.py              # Declarative base & TimestampMixin
  schemas/
    common.py            # ResponseEnvelope & ErrorResponse
    health.py            # Health schemas
  routers/
    health.py            # Health check endpoints (/api/v1/health)
  services/              # Domain business logic layer
  repositories/          # Query repositories layer
  middleware/
    request_id.py        # Request ID generator/propagator
    response_envelope.py # Standard response envelope wrapper
alembic/                 # Alembic database migration scripts
tests/                   # Pytest async test suite
.env.example
requirements.txt
README.md
```

## Quick Start

### 1. Environment & Setup

```bash
cd apps/api-fastapi
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

### 2. Run Development Server

```bash
uvicorn app.main:app --reload --port 4000
```

- API Docs: `http://localhost:4000/docs`
- Health Check: `http://localhost:4000/api/v1/health`

### 3. Database Migrations

```bash
alembic current
alembic revision --autogenerate -m "description"
alembic upgrade head
```

### 4. Run Tests

```bash
pytest
```
