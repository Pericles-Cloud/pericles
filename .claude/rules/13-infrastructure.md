---
paths:
  - "vercel.json"
  - "**/cache/**/*.ts"
  - "**/redis/**/*.ts"
  - ".vercel/**/*"
---

# Infrastructure Standards

## Vercel Deployment

### Project Configuration

```json
// vercel.json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": null,
  "regions": ["iad1"],
  "functions": {
    "api/**/*.ts": {
      "memory": 1024,
      "maxDuration": 30
    }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

### Environment Variables

```bash
# Vercel CLI
vercel env add DATABASE_URL production
vercel env add OPENAI_API_KEY production

# Pull env vars for local development
vercel env pull .env.local
```

| Environment | Purpose |
|-------------|---------|
| `production` | Live deployment |
| `preview` | PR preview deployments |
| `development` | Local development |

### Serverless Function Optimization

```typescript
// api/monitoring/trigger.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Initialize outside handler for connection reuse
const prisma = getPrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Set appropriate cache headers
  res.setHeader('Cache-Control', 's-maxage=0, stale-while-revalidate');

  try {
    const result = await processRequest(req);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

export const config = {
  maxDuration: 30, // Max 30 seconds for hobby, 60 for pro
};
```

### Deployment Workflow

```bash
# Preview deployment (PR)
vercel

# Production deployment
vercel --prod

# Check deployment status
vercel ls

# View logs
vercel logs <deployment-url>
```

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
