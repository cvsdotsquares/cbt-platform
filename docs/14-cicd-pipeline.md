# 14. CI/CD Pipeline

## Overview

| Layer | Tooling | Notes |
|-------|---------|--------|
| **CI** | GitHub Actions [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, typecheck, unit/e2e tests, build |
| **CD** | GitHub Actions + SSH → company server | **No Docker** — see [SERVER-DEPLOY.md](./SERVER-DEPLOY.md) |

Legacy AWS/EKS/Docker sketches below are superseded by the company-server path unless you explicitly switch back.

## Branch → deploy

```
feature/* ──PR──► CI
                 │
main ─────────────► deploy (/var/www/cbt/app)
```

## CD workflow

- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

The job SSHs to `DEPLOY_HOST` and runs:

```bash
export CBT_APP_ROOT=...   # DEPLOY_PATH secret
bash scripts/deploy/remote-deploy.sh <git-sha>
```

That script pulls the commit, then [`scripts/deploy/deploy.sh`](../scripts/deploy/deploy.sh):

1. `pnpm install --frozen-lockfile`
2. Build shared + API + Web
3. `prisma migrate deploy`
4. `pm2 startOrReload` (`infra/deploy/pm2/ecosystem.cjs`)
5. Local health check on the API port

## Required GitHub secrets

| Secret | Purpose |
|--------|---------|
| `DEPLOY_HOST` | Server IP/hostname |
| `DEPLOY_USER` | SSH user |
| `DEPLOY_SSH_KEY` | Private key |
| `DEPLOY_SSH_PORT` | SSH port (often `22`) |
| `DEPLOY_PATH` | Absolute path to the app checkout |

Optional variable: `API_HEALTH_URL` for post-deploy public smoke check.

## Process layout (PM2)

Config: `infra/deploy/pm2/ecosystem.cjs`

| Service | Default port |
|---------|----------------|
| API | 4010 |
| Web | 3010 |

Override with `CBT_API_PORT` / `CBT_WEB_PORT`. Nginx terminates HTTP(S) and proxies to those localhost ports — see `infra/deploy/nginx/cbt.conf.example`.

## Database migrations

- Run automatically on every deploy via `prisma migrate deploy`
- Prefer backward-compatible migrations
- Avoid destructive changes shortly before scheduled exams

## Full admin guide

Step-by-step server bootstrap, env files, Nginx, TLS, and rollback: **[SERVER-DEPLOY.md](./SERVER-DEPLOY.md)**.
