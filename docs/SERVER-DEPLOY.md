# Company Server Deploy (no Docker)

Single-environment CI/CD on your company Linux server.

| Item | Production value (example) |
|------|----------------------------|
| SSH user | `cbtplatform` |
| App checkout (**`DEPLOY_PATH`**) | `/home/cbtplatform/cbt-platform` |
| API (FastAPI / uvicorn) | `127.0.0.1:4010` |
| Web (Next.js) | `127.0.0.1:3010` |
| Legacy clone (do **not** use) | `/home/cbtplatform/cbt-app` (old Nest `apps/api`) |

CI runs from [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).  
After CI succeeds on `main`, [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) SSHs to the server and runs [`scripts/deploy/remote-deploy.sh`](../scripts/deploy/remote-deploy.sh).

---

## 0. One canonical clone (fix duplicate `cbt-app` / `cbt-platform`)

Production must use **only** `/home/cbtplatform/cbt-platform`.

On the server:

```bash
cd /home/cbtplatform/cbt-platform
git pull origin main
bash scripts/deploy/server-retire-cbt-app.sh
# Edit env files (see below), then:
./scripts/deploy/deploy.sh
```

When satisfied, retire the old tree:

```bash
mv /home/cbtplatform/cbt-app /home/cbtplatform/cbt-app.retired.$(date +%Y%m%d)
```

GitHub secret **`DEPLOY_PATH`** must be exactly:

```text
/home/cbtplatform/cbt-platform
```

PM2 (`cbt-api`, `cbt-web`) and nginx upstreams (`4010` / `3010`) must all come from this checkout—not `cbt-app`.

---

## 1. One-time server bootstrap (IT / admin)

Assumes Ubuntu/Debian. Adjust if needed.

```bash
sudo apt update
sudo apt install -y curl git nginx postgresql postgresql-contrib python3 python3-venv python3-pip

# Node 20 + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
sudo corepack prepare pnpm@9.15.4 --activate

sudo npm i -g pm2
```

### Postgres

```bash
sudo -u postgres psql <<'SQL'
CREATE USER cbt_user WITH PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE cbt OWNER cbt_user;
SQL
```

### Clone (once)

```bash
sudo useradd -m -s /bin/bash cbtplatform 2>/dev/null || true
sudo -u cbtplatform -i
cd ~
git clone https://github.com/cvsdotsquares/cbt-platform.git cbt-platform
cd ~/cbt-platform && git checkout main
```

Use a **deploy key** or token so `git fetch` works from CI.

### Env files (never commit real values)

```bash
cd /home/cbtplatform/cbt-platform
cp infra/deploy/env/api.env.example apps/api-fastapi/.env
cp infra/deploy/env/web.env.example apps/web/.env.production
# Edit both: domains, DATABASE_URL (postgresql+psycopg://...), JWT_SECRET, NEXT_PUBLIC_*
```

Generate a strong JWT secret:

```bash
openssl rand -base64 48
```

Put the result in `apps/api-fastapi/.env` as **`JWT_SECRET`** (32+ characters).

### Nginx + TLS

```bash
sudo cp /home/cbtplatform/cbt-platform/infra/deploy/nginx/cbt.conf.example /etc/nginx/sites-available/cbt.conf
# Replace WEB_HOST / API_HOST placeholders; upstreams stay 127.0.0.1:3010 and :4010
sudo ln -sf /etc/nginx/sites-available/cbt.conf /etc/nginx/sites-enabled/cbt.conf
sudo nginx -t && sudo systemctl reload nginx
```

### First manual deploy

```bash
export CBT_APP_ROOT=/home/cbtplatform/cbt-platform
cd "$CBT_APP_ROOT"
./scripts/deploy/deploy.sh
pm2 startup   # run the command it prints
pm2 save
```

---

## 2. GitHub configuration

### Secrets

| Secret | Example |
|--------|---------|
| `DEPLOY_HOST` | `192.168.1.47` (must be reachable from the runner—see note below) |
| `DEPLOY_USER` | `cbtplatform` |
| `DEPLOY_SSH_KEY` | Private deploy key (PEM) |
| `DEPLOY_SSH_PORT` | `22` |
| `DEPLOY_PATH` | `/home/cbtplatform/cbt-platform` |

### Variables (optional)

| Variable | Example |
|----------|---------|
| `API_HEALTH_URL` | `http://192.168.1.47/api/v1/health` or public URL |

### SSH key

Generate on your laptop, add `.pub` to `~/.ssh/authorized_keys` on the server, put private key in `DEPLOY_SSH_KEY`.

### Private LAN (`192.168.x.x`) and GitHub-hosted runners

Default GitHub runners run on the public internet and **cannot** SSH to a private office IP. Use one of:

- **Self-hosted Actions runner** on a machine that can reach `192.168.1.47`, or  
- VPN / Tailscale, or  
- A public hostname / tunnel to the server.

---

## 3. Day-to-day flow

```
feature/* → PR → CI
main      → CI success → Deploy (if SSH reachable)
```

Manual: Actions → **Deploy** → **Run workflow**.

---

## 4. Rollback

```bash
export CBT_APP_ROOT=/home/cbtplatform/cbt-platform
cd "$CBT_APP_ROOT"
git fetch --all
git checkout --force -B deploy/main <commit-sha>
./scripts/deploy/deploy.sh
```

---

## 5. Checklist

- [ ] Only **`cbt-platform`** clone in use; **`cbt-app`** retired or renamed
- [ ] `DEPLOY_PATH=/home/cbtplatform/cbt-platform`
- [ ] `apps/api-fastapi/.env` and `apps/web/.env.production` on server
- [ ] `pm2 list` shows `cbt-api` / `cbt-web` with cwd under `cbt-platform`
- [ ] `curl -s http://127.0.0.1:4010/api/v1/health` on server
- [ ] Runner can reach `DEPLOY_HOST` (if using cloud Actions)
