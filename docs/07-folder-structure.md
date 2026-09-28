# 7. Folder Structure

```
cbt-platform/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Lint, test, build
│       ├── cd-staging.yml            # Deploy to staging
│       ├── cd-production.yml         # Deploy to production
│       └── security-scan.yml         # SAST, dependency audit
│
├── apps/
│   ├── api/                          # NestJS Backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # Database schema
│   │   │   ├── seed.ts               # Seed data
│   │   │   └── migrations/           # Migration history
│   │   ├── src/
│   │   │   ├── main.ts               # Application entry
│   │   │   ├── app.module.ts         # Root module
│   │   │   ├── common/
│   │   │   │   ├── decorators/       # Custom decorators
│   │   │   │   ├── filters/          # Exception filters
│   │   │   │   ├── guards/           # Auth, RBAC, tenant guards
│   │   │   │   ├── interceptors/     # Logging, transform, audit
│   │   │   │   ├── pipes/            # Validation pipes
│   │   │   │   ├── middleware/        # Tenant, rate-limit middleware
│   │   │   │   └── utils/            # Encryption, fingerprint
│   │   │   ├── config/               # Configuration modules
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.module.ts
│   │   │   │   │   ├── auth.controller.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── strategies/   # JWT, refresh strategies
│   │   │   │   │   ├── dto/          # Login, register DTOs
│   │   │   │   │   └── mfa/          # MFA service
│   │   │   │   ├── tenants/
│   │   │   │   ├── users/
│   │   │   │   ├── candidates/
│   │   │   │   ├── questions/
│   │   │   │   ├── exams/
│   │   │   │   ├── exam-engine/
│   │   │   │   ├── proctoring/
│   │   │   │   ├── security/
│   │   │   │   ├── coding/
│   │   │   │   ├── results/
│   │   │   │   ├── analytics/
│   │   │   │   ├── notifications/
│   │   │   │   ├── audit/
│   │   │   │   └── health/
│   │   │   ├── gateways/             # WebSocket gateways
│   │   │   │   ├── exam.gateway.ts
│   │   │   │   ├── proctoring.gateway.ts
│   │   │   │   └── monitoring.gateway.ts
│   │   │   └── prisma/               # Prisma service
│   │   ├── test/                     # E2E tests
│   │   ├── Dockerfile
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                          # Next.js Frontend
│       ├── public/
│       │   ├── fonts/
│       │   └── images/
│       ├── src/
│       │   ├── app/                  # App Router
│       │   │   ├── (auth)/
│       │   │   │   ├── login/page.tsx
│       │   │   │   ├── register/page.tsx
│       │   │   │   ├── forgot-password/page.tsx
│       │   │   │   └── mfa/page.tsx
│       │   │   ├── (dashboard)/
│       │   │   │   ├── layout.tsx    # Dashboard layout
│       │   │   │   ├── page.tsx      # Dashboard home
│       │   │   │   ├── exams/
│       │   │   │   ├── questions/
│       │   │   │   ├── candidates/
│       │   │   │   ├── results/
│       │   │   │   ├── analytics/
│       │   │   │   ├── monitoring/
│       │   │   │   ├── settings/
│       │   │   │   └── audit/
│       │   │   ├── (exam)/
│       │   │   │   ├── exam/[sessionId]/
│       │   │   │   │   ├── page.tsx  # Exam interface
│       │   │   │   │   ├── layout.tsx
│       │   │   │   │   └── components/
│       │   │   │   └── instructions/[examId]/
│       │   │   ├── (candidate)/
│       │   │   │   ├── dashboard/
│       │   │   │   ├── profile/
│       │   │   │   ├── admit-card/
│       │   │   │   └── results/
│       │   │   ├── layout.tsx        # Root layout
│       │   │   ├── globals.css
│       │   │   └── providers.tsx
│       │   ├── components/
│       │   │   ├── ui/               # Shadcn UI components
│       │   │   ├── layout/           # Sidebar, header, footer
│       │   │   ├── exam/             # Exam-specific components
│       │   │   ├── proctoring/       # Proctoring components
│       │   │   ├── monitoring/       # Live monitoring
│       │   │   ├── analytics/        # Charts, reports
│       │   │   └── shared/           # Common components
│       │   ├── hooks/                # Custom React hooks
│       │   ├── lib/                  # Utilities, API client
│       │   ├── stores/               # Zustand stores
│       │   ├── types/                # TypeScript types
│       │   └── services/             # API service layer
│       ├── Dockerfile
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── shared/                       # Shared package
│       ├── src/
│       │   ├── types/                # Shared TypeScript types
│       │   ├── constants/            # Enums, constants
│       │   ├── rbac/                 # Permissions, roles
│       │   ├── validation/           # Shared validation schemas
│       │   └── utils/                # Shared utilities
│       ├── package.json
│       └── tsconfig.json
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml        # Dev environment
│   │   ├── docker-compose.prod.yml
│   │   └── nginx/
│   │       └── nginx.conf
│   └── k8s/
│       ├── base/                     # Kustomize base
│       │   ├── namespace.yaml
│       │   ├── api/
│       │   ├── web/
│       │   ├── redis/
│       │   └── ingress/
│       ├── overlays/
│       │   ├── staging/
│       │   └── production/
│       └── helm/                     # Helm charts (optional)
│
├── docs/                             # Architecture documentation
│   ├── 01-system-architecture.md
│   ├── 02-high-level-architecture.md
│   └── ...
│
├── .env.example
├── .gitignore
├── package.json                      # Root workspace
├── pnpm-workspace.yaml
├── turbo.json                        # Turborepo config (optional)
└── README.md
```
