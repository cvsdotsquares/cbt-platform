# Deploy CBT Platform — Correct Way

Render free tier works for **API + Database**. Next.js web builds often **fail on Render free** (512 MB RAM). Use **Vercel for the web app**.

---

## Recommended: Render (API + DB) + Vercel (Web)

### Part 1 — Render: Database + API (keep what you have)

You already have:
- `cbt-db` — Oregon — Available
- `cbt-api` — Oregon — needs redeploy with latest fix

#### 1. Push latest code (if not already)
```bash
git pull origin main
```

#### 2. Delete failed **cbt-web** on Render (optional — not needed for this setup)
Render Dashboard → **cbt-web** → Settings → Delete Web Service

You only need **cbt-db** + **cbt-api** on Render.

#### 3. Redeploy API
- **cbt-api** → **Manual Deploy** → Deploy latest commit
- Wait until status is **Live**
- Check logs for: `CBT API running on`

#### 4. Seed database (first time)
**cbt-api** → **Shell**:
```bash
cd apps/api && npx prisma db seed
```

#### 5. Test API
Open: `https://cbt-api.onrender.com/api/v1/health`  
Should return: `{"status":"ok",...}`

---

### Part 2 — Vercel: Web frontend (free, built for Next.js)

#### 1. Go to [vercel.com](https://vercel.com) → Sign up with GitHub

#### 2. New Project → Import `kirtimewara20/cbt-app`

#### 3. Configure project:

| Setting | Value |
|---------|-------|
| **Root Directory** | `apps/web` |
| **Framework** | Next.js (auto-detected) |

#### 4. **Important — enable monorepo support**

After first import (or in **Project Settings → General**):

- Turn **ON**: **"Include source files outside of the Root Directory in the Build Step"**

Without this, Vercel cannot access `packages/shared` and the build fails.

#### 5. Environment variables:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://cbt-api-ktkr.onrender.com/api/v1` |
| `NEXT_PUBLIC_WS_URL` | `wss://cbt-api-ktkr.onrender.com` |

#### 6. Click **Deploy** (~3–5 min)

#### 7. Update API CORS on Render
After Vercel gives you a URL (e.g. `https://cbt-app.vercel.app`):

Render → **cbt-api** → **Environment** → set:
```
APP_URL=https://YOUR-VERCEL-URL.vercel.app
```
→ **Save** → **Manual Deploy**

#### 7. Open your app
Visit your Vercel URL → Login: `admin@cbt-platform.com` / `Admin@123`

---

## Architecture

```
Browser
   │
   ├── Vercel (cbt-web)     → Next.js UI
   │
   └── Render (cbt-api)     → NestJS API + WebSocket
          │
          └── Render (cbt-db) → PostgreSQL
```

---

## All on Render (alternative — costs $7/mo for web)

If you want everything on Render:

1. **cbt-api** — Free plan (Oregon) — works after start-path fix
2. **cbt-web** — **Starter plan ($7/mo)** — required for Next.js build memory
3. Set `APP_URL=https://cbt-web.onrender.com` on API
4. Redeploy both

Add cbt-web back to `render.yaml` only if using this path.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| API deploy failed | Check logs — should use `node dist/src/main.js` (fixed in latest commit) |
| Login works locally but not deployed | Set `APP_URL` to your Vercel URL on cbt-api |
| API slow first request | Render free tier sleeps after 15 min — normal |
| Database empty | Run seed in cbt-api Shell |

---

## Quick checklist

- [ ] cbt-db Available (Oregon)
- [ ] cbt-api Live (Oregon)
- [ ] Database seeded
- [ ] Vercel web deployed
- [ ] APP_URL on API = Vercel URL
- [ ] Login tested
