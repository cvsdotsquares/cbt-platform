# Company Server Deploy (no Docker)

Single-environment CI/CD on your company Linux server.

| Branch | Default ports (API / Web) | Suggested path |
|--------|---------------------------|----------------|
| `main` | 4010 / 3010 | `/var/www/cbt/app` |

CI (lint / test / build) runs from [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).  
After CI succeeds on `main`, [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) SSHs into the server and runs [`scripts/deploy/remote-deploy.sh`](../scripts/deploy/remote-deploy.sh).

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
sudo mkdir -p /var/www/cbt/app
sudo chown -R cbt:cbt /var/www/cbt
```

### Postgres database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER cbt_user WITH PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE cbt OWNER cbt_user;
SQL
```

### Clone the app

```bash
sudo -u cbt -i
cd /var/www/cbt
git clone git@github.com:YOUR_ORG/cbt-app.git app
cd /var/www/cbt/app && git checkout main
```

Use a **deploy key** (read-only) or a machine user so the server can `git fetch`.

### Env files (never commit real values)

```bash
cp infra/deploy/env/api.env.example apps/api/.env
cp infra/deploy/env/web.env.example apps/web/.env.production
# Edit both files: domains, DATABASE_URL, JWT secrets
```

Generate JWT secrets:

```bash
openssl rand -base64 48
```

`JWT_ACCESS_SECRET` must be **identical** in `apps/api/.env` and `apps/web/.env.production`.

### Nginx + TLS

```bash
sudo cp /var/www/cbt/app/infra/deploy/nginx/cbt.conf.example /etc/nginx/sites-available/cbt.conf
# Replace WEB_HOST / API_HOST placeholders
sudo ln -sf /etc/nginx/sites-available/cbt.conf /etc/nginx/sites-enabled/cbt.conf
sudo nginx -t && sudo systemctl reload nginx
# After DNS points here:
# sudo certbot --nginx -d WEB_HOST -d API_HOST
```

### First manual deploy

```bash
export CBT_APP_ROOT=/var/www/cbt/app
cd "$CBT_APP_ROOT"
./scripts/deploy/deploy.sh
pm2 startup   # follow the printed systemd command
pm2 save
```

---

## 2. GitHub configuration

### Secrets (repository)

| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | Server hostname or IP |
| `DEPLOY_USER` | SSH user (e.g. `cbt`) |
| `DEPLOY_SSH_KEY` | Private key content for that user |
| `DEPLOY_SSH_PORT` | Optional; defaults to 22 if empty |
| `DEPLOY_PATH` | e.g. `/var/www/cbt/app` |

If you previously used `DEPLOY_PATH_PRODUCTION`, rename it to `DEPLOY_PATH`.

### Variables (optional)

| Variable | Description |
|----------|-------------|
| `API_HEALTH_URL` | e.g. `https://API_HOST/api/v1/health` (post-deploy smoke check) |

Legacy name `PROD_API_HEALTH_URL` is still read if `API_HEALTH_URL` is unset.

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
            main  → CI success → auto deploy
```

Manual re-deploy: GitHub Actions → **Deploy** → **Run workflow**.

---

## 4. Rollback

```bash
export CBT_APP_ROOT=/var/www/cbt/app
cd "$CBT_APP_ROOT"
git fetch --tags
git checkout --force -B deploy/main v1.2.3   # or a previous commit SHA
./scripts/deploy/deploy.sh
```

Or re-run an older successful Deploy workflow on the previous commit.

---

## 5. Placeholder checklist (fill when known)

- [ ] `DEPLOY_HOST` / `DEPLOY_USER` / SSH key
- [ ] `DEPLOY_PATH`
- [ ] Domains: `WEB_HOST` + `API_HOST`
- [ ] Postgres password + database created
- [ ] JWT secrets (web + api matched)
