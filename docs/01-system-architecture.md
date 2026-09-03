# 1. Complete System Architecture

## Overview

The CBT Platform is a cloud-native, multi-tenant examination management system built on a **modular monolith with microservice extraction points** architecture. This hybrid approach enables rapid development while supporting independent scaling of compute-intensive services (AI proctoring, code execution) at 1M+ concurrent users.

## Architectural Principles

| Principle | Implementation |
|-----------|----------------|
| **Multi-tenancy** | Schema-per-tenant (default) or database-per-tenant (enterprise) |
| **Security-first** | Zero-trust, defense-in-depth, OWASP Top 10 compliance |
| **Event-driven** | Redis pub/sub + SQS for async proctoring, evaluation |
| **CQRS-lite** | Write to primary DB, read from replicas + Redis cache |
| **Observability** | Structured logging, distributed tracing, real-time metrics |
| **Resilience** | Circuit breakers, bulkheads, graceful degradation |

## System Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                              │
│  Next.js 15 (SSR/SSG) │ Exam Client (SPA) │ Proctor Dashboard │ Mobile  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                          Cloudflare CDN + WAF
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY LAYER                              │
│  Nginx Ingress │ Rate Limiting │ TLS Termination │ JWT Validation       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (NestJS)                       │
│  Auth │ Candidates │ Questions │ Exams │ CBT Engine │ Results │ Analytics│
│  Security │ Proctoring │ Coding │ Notifications │ Audit │ Tenant Mgmt    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌──────────────────────┬──────────────────────┬───────────────────────────┐
│   DATA LAYER         │   CACHE LAYER        │   MESSAGE LAYER           │
│   PostgreSQL 16      │   Redis Cluster      │   AWS SQS / Redis Streams │
│   (Primary + Replica)│   (Sessions, Cache)  │   (Async Events)          │
│   S3 (Documents)     │                      │                           │
└──────────────────────┴──────────────────────┴───────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                      SPECIALIZED SERVICES                               │
│  AI Proctoring (GPU) │ Code Sandbox (gVisor) │ PDF Generator │ Email    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Domain Modules

### 1. Identity & Access Management (IAM)
- JWT access tokens (15 min) + refresh tokens (7 days, rotation)
- MFA via TOTP (Google Authenticator compatible)
- Device fingerprinting + trusted device registry
- Session management with concurrent session limits
- RBAC with 8 roles and 120+ granular permissions

### 2. Tenant Management
- Organization onboarding with white-label branding
- Custom domain mapping via Cloudflare
- Tenant-scoped data isolation
- Per-tenant configuration (security policies, exam rules)

### 3. Candidate Lifecycle
- Registration → KYC → Admit Card → Exam → Result → Certificate
- Aadhaar verification integration-ready (UIDAI API adapter)
- Document management with virus scanning

### 4. Question Bank
- 8 question types with rich media support
- Version control with approval workflow
- Bulk import/export (Excel, QTI, JSON)
- Tagging, difficulty calibration, topic hierarchy

### 5. Exam Engine
- Template-based exam creation
- Adaptive testing (IRT-based item selection)
- Section-wise timing with auto-submit
- Offline recovery via IndexedDB sync
- Multi-language with RTL support

### 6. AI Proctoring
- Real-time face detection/verification (WebRTC → ML service)
- Continuous risk scoring (0-100)
- Violation classification and escalation
- Proctor intervention workflow

### 7. Security Enforcement
- Browser lockdown (SEB-compatible + custom)
- Copy/paste/right-click blocking
- DevTools, VM, VPN, proxy detection
- Dynamic watermarking with candidate ID
- Geofencing and IP allowlisting

### 8. Coding Assessment
- Monaco Editor with 6 language support
- Sandboxed execution via gVisor/Firecracker
- Hidden test cases with plagiarism detection (MOSS/JPlag)

### 9. Results & Analytics
- Auto-evaluation for objective questions
- Manual rubric-based evaluation for subjective
- Rank, percentile, cutoff management
- Multi-dimensional analytics dashboards

## Data Flow: Exam Session

```
Candidate Login → MFA → Device Verify → Admit Card Check
       │
       ▼
Pre-Exam Identity Verification (Face Match)
       │
       ▼
Browser Lockdown Init → WebRTC Stream Start
       │
       ▼
┌──────────────────────────────────────────┐
│  EXAM SESSION (WebSocket + REST)         │
│  • Answer auto-save every 5s             │
│  • Proctoring events every 2s           │
│  • Heartbeat every 10s                  │
│  • Violation alerts real-time           │
└──────────────────────────────────────────┘
       │
       ▼
Submit / Auto-Submit → Evaluation Queue → Result Publish
```

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API Framework | NestJS | Enterprise patterns, DI, guards, interceptors |
| ORM | Prisma | Type-safe, migrations, multi-schema support |
| Frontend | Next.js 15 App Router | SSR for SEO, RSC for performance |
| State | Zustand + React Query | Lightweight local state + server cache |
| Real-time | Socket.IO + Redis Adapter | Horizontal scaling of WebSocket |
| Auth | JWT + Refresh rotation | Stateless API, secure session refresh |
| File Storage | AWS S3 + CloudFront | Scalable, CDN-backed document delivery |
| Search | PostgreSQL FTS + optional Elasticsearch | Question bank search at scale |

## Non-Functional Requirements

| Metric | Target |
|--------|--------|
| Concurrent users | 1,000,000+ |
| API latency (p99) | < 200ms |
| Exam auto-save | < 100ms |
| Proctoring inference | < 500ms |
| Uptime SLA | 99.99% |
| RPO (Recovery Point) | < 1 minute |
| RTO (Recovery Time) | < 15 minutes |
| Data retention | Configurable per tenant (GDPR compliant) |
