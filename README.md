# CBT Platform — Enterprise Examination Management System

A production-grade, multi-tenant Computer Based Test (CBT) platform designed for government, university, recruitment, and certification examinations at scale (1M+ concurrent users).

## Architecture

```
cbt-platform/
├── apps/
│   ├── api/          # NestJS backend (REST + WebSocket)
│   └── web/          # Next.js frontend
├── packages/
│   └── shared/       # Shared types, constants, RBAC
├── infra/
│   ├── docker/       # Docker Compose (dev)
│   └── k8s/          # Kubernetes manifests (prod)
└── docs/             # Architecture & design documents
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose
- PostgreSQL 16+ (or use Docker)

### Development

```bash
# Install dependencies
pnpm install

# Start infrastructure (PostgreSQL, Redis)
pnpm docker:up

# Copy environment variables
cp .env.example .env

# Run database migrations
pnpm db:migrate

# Seed initial data
pnpm db:seed

# Start dev servers (API :4000, Web :3000)
pnpm dev
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| Web     | 3000 | Next.js frontend |
| API     | 4000 | NestJS REST + Socket.IO |
| PostgreSQL | 5432 | Primary database |
| Redis   | 6379 | Cache, sessions, pub/sub |
| AI Proctoring | 5000 | ML inference service |
| Code Sandbox | 5001 | Isolated code execution |

## Documentation

| Document | Description |
|----------|-------------|
| [System Architecture](docs/01-system-architecture.md) | Complete system design |
| [Database Schema](docs/04-database-schema.md) | ER diagram, indexing, partitioning |
| [API Structure](docs/06-api-structure.md) | REST endpoints & WebSocket events |
| [RBAC Matrix](docs/08-rbac-permissions.md) | Role-based permissions |
| [Security Architecture](docs/09-security-architecture.md) | OWASP, encryption, audit |
| [Deployment](docs/13-deployment-architecture.md) | AWS, K8s, Cloudflare |
| [Roadmap](docs/15-development-roadmap.md) | Phased delivery plan |

## Technology Stack

- **Frontend:** Next.js 15, React, TypeScript, Tailwind CSS, Shadcn UI, Zustand, React Query
- **Backend:** NestJS, Prisma, PostgreSQL, Redis, Socket.IO
- **Infrastructure:** Docker, Kubernetes, AWS, Cloudflare, Nginx
- **Security:** JWT, MFA, RBAC, AES-256, device fingerprinting, audit logging

## License

Proprietary — All rights reserved.
# cbt-app
