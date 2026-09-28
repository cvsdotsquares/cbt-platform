# 14. CI/CD Pipeline

## Overview

| Layer | Tooling | Notes |
|-------|---------|--------|
| **CI** | GitHub Actions [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, typecheck, unit/e2e tests, build |
| **CD** | GitHub Actions + SSH → company server | **No Docker** — see [SERVER-DEPLOY.md](./SERVER-DEPLOY.md) |

Legacy AWS/EKS/Docker sketches below are superseded by the company-server path unless you explicitly switch back.

## Branch → environment

```
feature/* ──PR──► CI
                 │
dev ─────────────► development  (/var/www/cbt/dev)
develop ──────────► staging       (/var/www/cbt/staging)
main ─────────────► production    (/var/www/cbt/prod)  [manual approval]
tags v* ──────────► release marker (optional); prod tracks main
```

## CD workflows (placeholders)

- [`.github/workflows/deploy-dev.yml`](../.github/workflows/deploy-dev.yml)
- [`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml)
- [`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml)

Each job SSHs to `DEPLOY_HOST` and runs:

```bash
export CBT_APP_ROOT=...   # DEPLOY_PATH_*
bash scripts/deploy/remote-deploy.sh <env> <git-sha>
```

That script pulls the commit, then [`scripts/deploy/deploy.sh`](../scripts/deploy/deploy.sh):

1. `pnpm install --frozen-lockfile`
2. Build shared + API + Web
3. `prisma migrate deploy`
4. `pm2 startOrReload` for that env
5. Local health check on the API port

## Required GitHub secrets

| Secret | Purpose |
|--------|---------|
| `DEPLOY_HOST` | Server IP/hostname |
| `DEPLOY_USER` | SSH user |
| `DEPLOY_SSH_KEY` | Private key |
| `DEPLOY_SSH_PORT` | SSH port (often `22`) |
| `DEPLOY_PATH_DEV` | Absolute path to dev checkout |
| `DEPLOY_PATH_STAGING` | Absolute path to staging checkout |
| `DEPLOY_PATH_PRODUCTION` | Absolute path to prod checkout |

Optional variable: `PROD_API_HEALTH_URL` for post-deploy public smoke check.

## Process layout (PM2)

Configs under `infra/deploy/pm2/`:

| Env | API port | Web port |
|-----|----------|----------|
| dev | 4010 | 3010 |
| staging | 4020 | 3020 |
| production | 4030 | 3030 |

Nginx terminates HTTP(S) and proxies to those localhost ports — see `infra/deploy/nginx/cbt.conf.example`.

## Database migrations

- Run automatically on every deploy via `prisma migrate deploy`
- Prefer backward-compatible migrations
- Avoid destructive changes shortly before scheduled exams

## Full admin guide

Step-by-step server bootstrap, env files, Nginx, TLS, and rollback: **[SERVER-DEPLOY.md](./SERVER-DEPLOY.md)**.
