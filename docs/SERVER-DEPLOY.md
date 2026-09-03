# Company Server Deploy (no Docker)

Placeholder-based CI/CD for **dev / staging / production** on your company Linux server.

| Branch | Environment | Default ports (API / Web) | Suggested path |
|--------|-------------|---------------------------|----------------|
| `dev` | development | 4010 / 3010 | `/var/www/cbt/dev` |
| `develop` | staging | 4020 / 3020 | `/var/www/cbt/staging` |
| `main` | production | 4030 / 3030 | `/var/www/cbt/prod` |

CI (lint / test / build) still runs from [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).  
CD workflows SSH into the server and run [`scripts/deploy/remote-deploy.sh`](../scripts/deploy/remote-deploy.sh).

---

## 1. One-time server bootstrap (IT / admin)

Assumes Ubuntu/Debian. Adjust if needed.

```bash
# System packages
sudo apt update
sudo apt install -y curl git nginx postgresql postgresql-contrib

# Node 20 + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
sudo corepack prepare pnpm@9.15.4 --activate

# Process manager
sudo npm i -g pm2

# App user (example)
sudo useradd -m -s /bin/bash cbt || true
sudo mkdir -p /var/www/cbt/{dev,staging,prod}
sudo chown -R cbt:cbt /var/www/cbt
```

### Postgres databases

```bash
sudo -u postgres psql <<'SQL'
CREATE USER cbt_user WITH PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE cbt_dev OWNER cbt_user;
CREATE DATABASE cbt_staging OWNER cbt_user;
CREATE DATABASE cbt_prod OWNER cbt_user;
SQL
```

### Clone once per environment

```bash
sudo -u cbt -i
cd /var/www/cbt
git clone git@github.com:YOUR_ORG/cbt-app.git dev
git clone git@github.com:YOUR_ORG/cbt-app.git staging
git clone git@github.com:YOUR_ORG/cbt-app.git prod

cd /var/www/cbt/dev && git checkout dev
cd /var/www/cbt/staging && git checkout develop
cd /var/www/cbt/prod && git checkout main
```

Use a **deploy key** (read-only) or a machine user so the server can `git fetch`.

### Env files (never commit real values)

For each checkout:

```bash
# Dev example
cp infra/deploy/env/api.dev.env.example apps/api/.env
cp infra/deploy/env/web.dev.env.example apps/web/.env.production
# Edit both files: domains, DATABASE_URL, JWT secrets
```

Generate JWT secrets:

```bash
openssl rand -base64 48
```

`JWT_ACCESS_SECRET` must be **identical** in `apps/api/.env` and `apps/web/.env.production`.

### Nginx + TLS

```bash
sudo cp /var/www/cbt/prod/infra/deploy/nginx/cbt.conf.example /etc/nginx/sites-available/cbt.conf
# Replace DEV_* / STAGING_* / PROD_* host placeholders
sudo ln -sf /etc/nginx/sites-available/cbt.conf /etc/nginx/sites-enabled/cbt.conf
sudo nginx -t && sudo systemctl reload nginx
# After DNS points here:
# sudo certbot --nginx -d PROD_WEB_HOST -d PROD_API_HOST
```

### First manual deploy

```bash
export CBT_APP_ROOT=/var/www/cbt/staging
cd "$CBT_APP_ROOT"
./scripts/deploy/deploy.sh staging
pm2 startup   # follow the printed systemd command
pm2 save
```

---

## 2. GitHub configuration

### Environments

Create environments: `development`, `staging`, `production`.  
For **production**, enable **Required reviewers** (manual approval before deploy).

### Secrets (repository or environment)

| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | Server hostname or IP |
| `DEPLOY_USER` | SSH user (e.g. `cbt`) |
| `DEPLOY_SSH_KEY` | Private key content for that user |
| `DEPLOY_SSH_PORT` | Optional; defaults to 22 if empty |
| `DEPLOY_PATH_DEV` | e.g. `/var/www/cbt/dev` |
| `DEPLOY_PATH_STAGING` | e.g. `/var/www/cbt/staging` |
| `DEPLOY_PATH_PRODUCTION` | e.g. `/var/www/cbt/prod` |

### Variables (optional)

| Variable | Description |
|----------|-------------|
| `PROD_API_HEALTH_URL` | e.g. `https://PROD_API_HOST/api/v1/health` |

### SSH key on server

```bash
# On your laptop: generate a dedicated deploy key (no passphrase for CI)
ssh-keygen -t ed25519 -f cbt-deploy -C "github-actions-cbt"
# Put cbt-deploy.pub in server ~/.ssh/authorized_keys for DEPLOY_USER
# Put private key contents into GitHub secret DEPLOY_SSH_KEY
```

---

## 3. Day-to-day flow

```
feature/*  → PR → CI
             ↓
           develop  → auto deploy staging
             ↓
            main    → approve → deploy production
             ↓
            tags v*  (optional: release notes; prod already tracks main)
```

Also: push to `dev` → deploy development.

Manual re-deploy: GitHub Actions → **Deploy Staging** / **Deploy Production** → **Run workflow**.

---

## 4. Rollback

```bash
export CBT_APP_ROOT=/var/www/cbt/prod
cd "$CBT_APP_ROOT"
git fetch --tags
git checkout --force -B deploy/production v1.2.3   # or a previous commit SHA
./scripts/deploy/deploy.sh production
```

Or re-run an older successful production workflow on the previous commit.

---

## 5. Placeholder checklist (fill when known)

- [ ] `DEPLOY_HOST` / `DEPLOY_USER` / SSH key
- [ ] Paths: `DEPLOY_PATH_DEV` / `_STAGING` / `_PRODUCTION`
- [ ] Domains: `DEV_*` `STAGING_*` `PROD_*` web + API
- [ ] Postgres passwords + 3 databases created
- [ ] JWT secrets per env (web + api matched)
- [ ] GitHub Environments + required reviewers on production
- [ ] Create `dev` / `develop` / `main` branches if missing
