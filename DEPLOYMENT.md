# Deployment

Pericles runs as **two deploys**:

- **Frontend** (`frontend/`, Next.js 16) → **Vercel** (native).
- **Backend** (`backend/`, Express API + socket.io WebSocket in one process) →
  a **persistent container host** (Coolify / Render / Fly / a VM). It is *not*
  serverless — it holds WebSocket connections and an in-memory position-feed
  clock, so it needs a long-running process. Vercel serverless cannot host it.

A hosted **PostgreSQL** (Neon / Supabase / Vercel Postgres / self-hosted) backs
both. The backend needs two databases: `pericles` and `mastra`.

---

## Backend → Coolify (Docker)

The repo ships a verified `backend/Dockerfile` (builds, runs
`prisma migrate deploy`, then starts the server on port **4112**, serving both
`/api/*` and the `/ws/workflow` WebSocket). A `backend/.dockerignore` keeps any
local `.env*` out of the image (the server self-loads `.env.local` with
`override:true`, so a stray copy would clobber the real container env).

### 1. Database
Provision Postgres and create the `pericles` and `mastra` databases. Grab the
connection string(s).

### 2. Create the application in Coolify
- **New Resource → Application →** your Git repo.
- **Build pack:** Dockerfile. **Base directory:** `backend/`. **Dockerfile:** `Dockerfile`.
- **Port:** `4112`. **Health check path:** `/health`.
- Assign a domain (e.g. `api.yourdomain.com`); Coolify/Traefik issues TLS and
  upgrades WebSockets automatically, so you get `https://` + `wss://` for free.

### 3. Environment variables (Coolify → app → Environment)
Set these as container env vars (never commit them; see `.claude/rules/14-env-files.md`):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | pericles DB (pooled if serverless Postgres) |
| `MASTRA_DATABASE_URL` | mastra DB |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | distinct, long random strings |
| `OPENAI_API_KEY` | required |
| `CORS_ORIGINS` | `https://<your-frontend>.vercel.app` (comma-separated; also gates socket.io) |
| `FRONTEND_URL` | `https://<your-frontend>.vercel.app` (OAuth redirects) |
| `GOOGLE_MAPS_API_KEY` | BOL geocoding |
| `APIFY_TOKEN` | BOL onboarding pulls |
| `THENEWSAPI_API_KEY`, `TWITTERAPIIO_API_KEY`, `OPENWEATHER_API_KEY` | monitoring feeds (optional) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google SSO (optional) |

Full list: `.env.example`.

### 4. Deploy
Deploy. The container `CMD` runs `prisma migrate deploy` then starts the server.
Seed once if you want demo data: run `npm run prisma:seed` locally against the
prod `DATABASE_URL`, or a one-off in the container.

### 5. Automation
- **Ongoing deploys are automatic:** connect the repo so Coolify redeploys on
  push to the deploy branch, or use the app's **deploy webhook** from CI
  (`curl -X POST "$COOLIFY_DEPLOY_WEBHOOK"`).
- **Scripted setup:** `scripts/deploy-coolify.mjs` automates project + app +
  env + deploy via the Coolify v4 API. **Run it from a host that can reach
  Coolify** (the server or its LAN — not from outside):
  ```bash
  # introspect (read-only): prints servers/projects/apps + UUIDs
  COOLIFY_URL=http://localhost:8000 COOLIFY_TOKEN=xxxxx node scripts/deploy-coolify.mjs
  # apply: create/ensure app, sync env from a file, deploy
  COOLIFY_URL=... COOLIFY_TOKEN=... COOLIFY_SERVER_UUID=<uuid> ENV_FILE=./coolify.env \
    node scripts/deploy-coolify.mjs --apply
  ```
  For a **private** repo, connect it once in the Coolify UI (or pass
  `COOLIFY_GITHUB_APP_UUID`), then re-run with `APP_UUID=<app>` to just sync env
  + deploy. The token never passes through anything but your shell.

### Optional: live monitoring agent
The `auth-server` serves everything the frontend/Atlas/WebSockets need. The
monitoring **agent loop** is a separate long-running process — add a **second
Coolify service** from the same repo with start command
`npm run monitoring:start` (or `tsx src/monitoring/start.ts`) if you want live
event detection.

---

## Frontend → Vercel

1. **New Project →** repo, **Root Directory:** `frontend/`. Next 16 builds natively.
2. **Environment variables:**
   - `NEXT_PUBLIC_API_URL` = your backend URL (e.g. `https://api.yourdomain.com`)
     — the browser uses this for both `/api/*` and `wss://…/ws/workflow`.
   - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` = a key with the **Maps JavaScript API**
     enabled and an HTTP-referrer allow rule for the Vercel domain.
   - (`next.config.ts` loads `../.env.local` for local dev only — harmless no-op
     on Vercel, which injects env vars.)
3. Deploy. Then add the Vercel domain to the backend's `CORS_ORIGINS` /
   `FRONTEND_URL`.

---

## Verified
The backend image was built and smoke-tested locally: `docker build` succeeds,
the container runs `prisma migrate deploy`, boots the API + WebSocket on 4112,
and `/health` returns `200`, reading all config from container env vars.

## Why not Vercel for the backend
WebSockets (`/ws/workflow`, used by the Plans workflow collaboration) require a
persistent server — Vercel serverless functions cannot host one. The Atlas live
vessel layer polls (no WS) but relies on the in-process position-feed singleton,
which serverless cold starts would reset. A persistent host avoids both issues
and keeps the current architecture intact.
