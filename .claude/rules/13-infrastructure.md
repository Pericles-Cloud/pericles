---
paths:
  - "backend/Dockerfile"
  - "backend/.dockerignore"
  - "scripts/deploy-coolify.mjs"
  - "frontend/next.config.ts"
  - "**/cache/**/*.ts"
---

# Infrastructure Standards

## Where things run

Pericles is **two deploys with two different providers**. Do not mix them up:

| Component | Path | Host | Shape |
|---|---|---|---|
| Frontend (Next.js/React) | `frontend/` | **Vercel** | Native Next.js build |
| Backend (Express API + socket.io) | `backend/` | **Coolify** | Long-running Docker container, port `4112` |
| Monitoring cycle | `backend/` | **Coolify** | Scheduled Task on the backend app (cron), or a second persistent service |
| PostgreSQL (`pericles` + `mastra`) | — | Hosted / self-hosted | — |

**The backend is not serverless.** It holds socket.io WebSocket connections
(`/ws/workflow`) and an in-process position-feed singleton for the Atlas live
vessel layer. Both need a persistent process, which is why it runs as a
container on Coolify and not as Vercel functions. The Mastra dev server
(port 4111) is a *local development* tool — it is not a deployment target.

`DEPLOYMENT.md` is the step-by-step runbook. For driving Coolify itself —
triggering deploys, watching builds, syncing env vars — use the
`coolify-deploy` skill (`.claude/skills/coolify-deploy/`), which wraps the
Coolify REST API.

## Backend Deployment (Coolify)

### Application configuration

Configured in the Coolify UI (or via `scripts/deploy-coolify.mjs`), not in a
committed provider config file:

- **Build pack:** Dockerfile · **Base directory:** `backend/` · **Dockerfile:** `Dockerfile`
- **Port:** `4112` · **Health check path:** `/health`
- **Domain:** e.g. `api.yourdomain.com` — Coolify/Traefik terminates TLS and
  upgrades WebSockets, giving `https://` and `wss://` without extra config.

The container `CMD` runs `prisma migrate deploy` before starting the server, so
migrations ship with the deploy. `backend/.dockerignore` keeps local `.env*`
files out of the image — the server self-loads `.env.local` with
`override: true`, so a stray copy would clobber the real container env.

### Environment variables

Set as container env vars in **Coolify → app → Environment**. Never commit them
(see `.claude/rules/14-env-files.md`). Env var changes do **not** redeploy
automatically — trigger a deploy after editing them.

`CORS_ORIGINS` and `FRONTEND_URL` must list the **Vercel** frontend origin;
`CORS_ORIGINS` also gates socket.io. Leaving `CORS_ORIGINS` unset falls back to
`http://localhost:3000,http://localhost:4111`, which will reject the deployed
frontend on every non-GET request.

Full list: `.env.example`.

### Long-running process patterns

Because the process persists between requests, the serverless habits do not
apply — there are no cold starts to amortise and no per-invocation time limit:

```typescript
// Module-scope singletons are safe and expected here: they live for the
// lifetime of the container, not a single request.
const prisma = getPrismaClient();

// External calls still need an explicit timeout — a hung upstream would
// otherwise occupy the process indefinitely.
const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
```

Do not reach for `@vercel/node` types (`VercelRequest`/`VercelResponse`) in new
backend code. The deployed server is Express — use `Request`/`Response` from
`express`.

### Scheduled work

Cron-style jobs are **Coolify Scheduled Tasks** on the backend app — a command
run inside the running container, not an HTTP endpoint poked by an external
scheduler. There is no `vercel.json` `crons` array any more.

Because the command executes in the container, it must resolve against the
image's `WORKDIR` and use what the image installs. The image runs TypeScript via
`tsx`, so schedule `npx tsx src/…/job.ts` — **not** `npm run <script>` for
scripts that wrap `dotenv -e ../.env.local`, since `.env*` files are excluded
from the image. Make the entry point exit non-zero on failure; the exit code is
how Coolify reports a failed run.

Cron granularity bottoms out at one minute. Anything faster (the monitoring
loop's 15s default) belongs in a persistent service with its own loop.

### Deployment workflow

```bash
# Ongoing deploys: Coolify redeploys on push to the deploy branch, or
curl -X POST "$COOLIFY_DEPLOY_WEBHOOK"

# Scripted setup (run from a host that can reach Coolify):
COOLIFY_URL=... COOLIFY_TOKEN=... node scripts/deploy-coolify.mjs            # introspect
COOLIFY_URL=... COOLIFY_TOKEN=... COOLIFY_SERVER_UUID=<uuid> ENV_FILE=./coolify.env \
  node scripts/deploy-coolify.mjs --apply                                    # apply
```

## Frontend Deployment (Vercel)

Vercel hosts the Next.js app only — **root directory `frontend/`**.

```bash
vercel                # preview deployment
vercel --prod         # production
vercel env pull .env.local
```

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | The Coolify backend URL. The browser uses it for `/api/*` and `wss://…/ws/workflow` |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Needs Maps JavaScript API enabled **and** an HTTP-referrer rule covering the Vercel domain |

`NEXT_PUBLIC_*` values are inlined into the client bundle **at build time** — a
changed key needs a rebuild, not just an env edit. After deploying, add the
Vercel domain to the backend's `CORS_ORIGINS` and `FRONTEND_URL`.

## Redis Caching

### Client Configuration

```typescript
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableOfflineQueue: false,
  lazyConnect: true,
});

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

export { redis };
```

### Caching Patterns

```typescript
interface CacheOptions {
  ttl?: number;      // Time to live in seconds
  namespace?: string;
}

const DEFAULT_TTL = 3600; // 1 hour

export async function cacheGet<T>(
  key: string,
  options: CacheOptions = {}
): Promise<T | null> {
  const fullKey = buildKey(key, options.namespace);
  const value = await redis.get(fullKey);
  return value ? JSON.parse(value) : null;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  options: CacheOptions = {}
): Promise<void> {
  const fullKey = buildKey(key, options.namespace);
  const ttl = options.ttl || DEFAULT_TTL;
  await redis.setex(fullKey, ttl, JSON.stringify(value));
}

export async function cacheDelete(
  key: string,
  options: CacheOptions = {}
): Promise<void> {
  const fullKey = buildKey(key, options.namespace);
  await redis.del(fullKey);
}

function buildKey(key: string, namespace?: string): string {
  return namespace ? `${namespace}:${key}` : key;
}
```

### Cache-Aside Pattern

```typescript
export async function getWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  // Try cache first
  const cached = await cacheGet<T>(key, options);
  if (cached !== null) {
    return cached;
  }

  // Fetch from source
  const data = await fetcher();

  // Store in cache
  await cacheSet(key, data, options);

  return data;
}

// Usage
const orgContext = await getWithCache(
  `org:${organizationId}:context`,
  () => fetchOrgContext(organizationId),
  { ttl: 300, namespace: 'erp' }
);
```

### Cache Invalidation

```typescript
// Invalidate by pattern
export async function invalidatePattern(pattern: string): Promise<number> {
  const keys = await redis.keys(pattern);
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}

// Invalidate organization cache
export async function invalidateOrgCache(orgId: string): Promise<void> {
  await invalidatePattern(`erp:org:${orgId}:*`);
  await invalidatePattern(`events:org:${orgId}:*`);
}

// Tag-based invalidation
export async function cacheSetWithTags<T>(
  key: string,
  value: T,
  tags: string[],
  options: CacheOptions = {}
): Promise<void> {
  const pipeline = redis.pipeline();
  const fullKey = buildKey(key, options.namespace);

  // Store value
  pipeline.setex(fullKey, options.ttl || DEFAULT_TTL, JSON.stringify(value));

  // Associate with tags
  for (const tag of tags) {
    pipeline.sadd(`tag:${tag}`, fullKey);
    pipeline.expire(`tag:${tag}`, 86400); // Tags expire in 24h
  }

  await pipeline.exec();
}

export async function invalidateByTag(tag: string): Promise<number> {
  const keys = await redis.smembers(`tag:${tag}`);
  if (keys.length === 0) return 0;

  const pipeline = redis.pipeline();
  keys.forEach(key => pipeline.del(key));
  pipeline.del(`tag:${tag}`);

  await pipeline.exec();
  return keys.length;
}
```

### TTL Guidelines

| Data Type | TTL | Reason |
|-----------|-----|--------|
| ERP context | 5 min | Changes infrequently, stale OK |
| Event dedup hashes | 1 hour | Prevent duplicate processing |
| API responses | 1-5 min | Fresh data important |
| User sessions | 30 min | Security requirement |
| Static config | 24 hours | Rarely changes |

### Health Check

```typescript
export async function checkRedisHealth(): Promise<{
  connected: boolean;
  latencyMs: number;
}> {
  const start = Date.now();
  try {
    await redis.ping();
    return {
      connected: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: -1,
    };
  }
}
```

## Docker Development

### Service Configuration

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: pericles
      POSTGRES_PASSWORD: pericles
      POSTGRES_DB: pericles
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pericles"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

### Local Development Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f postgres redis

# Stop services
docker-compose down

# Reset data
docker-compose down -v
```
