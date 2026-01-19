---
paths:
  - "backend/prisma/**/*"
  - "**/*prisma*"
  - "**/migrations/**/*"
---

# Database & Prisma Standards

## Prisma Client Singleton

```typescript
// backend/src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query'] : [],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

## Multi-Tenant Data Access

**Always scope queries by organization_id:**

```typescript
// CORRECT - tenant scoped
const events = await prisma.event.findMany({
  where: {
    organization_id: ctx.organizationId,
    status: 'ACTIVE',
  },
});

// INCORRECT - missing tenant scope
const events = await prisma.event.findMany({
  where: { status: 'ACTIVE' },
});
```

## Input Validation Before Database Operations

```typescript
import { z } from 'zod';

const CreateEventSchema = z.object({
  title: z.string().min(1).max(500),
  severity: z.number().min(0).max(1),
  organization_id: z.string().uuid(),
});

// CORRECT - validate then persist
const validated = CreateEventSchema.parse(input);
await prisma.event.create({ data: validated });

// INCORRECT - raw input
await prisma.event.create({ data: req.body });
```

## Transactions for Atomic Operations

```typescript
await prisma.$transaction(async (tx) => {
  const event = await tx.event.create({ data: eventData });

  await tx.eventHash.create({
    data: {
      hash: contentHash,
      event_id: event.id,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return event;
});
```

## Query Optimization

- Use `select` to fetch only needed fields
- Use `include` judiciously to avoid N+1 problems
- Add indexes for frequently queried columns

```typescript
// Optimized query
const events = await prisma.event.findMany({
  where: { organization_id: orgId },
  select: {
    id: true,
    title: true,
    severity: true,
    created_at: true,
  },
  orderBy: { created_at: 'desc' },
  take: 50,
});
```

## Migration Workflow

```bash
# Development - create migration
npm run prisma:migrate:dev -- --name add_event_hash_index

# Production - deploy migrations (CI/CD)
npm run prisma:migrate:deploy

# Generate client after schema changes
npm run prisma:generate
```

## Neon Serverless Configuration

```bash
# Production - pooled connection (for application queries)
DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require&pgbouncer=true"

# Direct connection for migrations (bypasses pooler)
DIRECT_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require"
```

### Prisma Configuration for Neon

```prisma
// prisma/schema.prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")  // For migrations
}
```

### Connection Pooling for Serverless

```typescript
import { PrismaClient } from '@prisma/client';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

// Enable WebSocket for serverless environments
neonConfig.webSocketConstructor = ws;

// Create pool with appropriate settings
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                    // Max connections in pool
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 10000,
});

// For Prisma with Neon Serverless Driver
import { PrismaNeon } from '@prisma/adapter-neon';

const adapter = new PrismaNeon(pool);
export const prisma = new PrismaClient({ adapter });
```

### Database Branching (Development)

```bash
# Create feature branch from main
neon branches create --name feature/monitoring-agent --project-id xxx

# List branches
neon branches list --project-id xxx

# Delete branch after merge
neon branches delete feature/monitoring-agent --project-id xxx
```

| Branch Type | Use Case |
|-------------|----------|
| `main` | Production data |
| `staging` | Pre-production testing |
| `feature/*` | Development branches (copy-on-write from main) |

### Row-Level Security (RLS) for Multi-Tenant

```sql
-- Enable RLS on tenant-scoped tables
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their organization's data
CREATE POLICY tenant_isolation ON events
  USING (organization_id = current_setting('app.organization_id')::uuid);

-- Set tenant context before queries
SET app.organization_id = 'org-uuid-here';
```

```typescript
// Set RLS context in Prisma
async function withTenantContext<T>(
  orgId: string,
  operation: () => Promise<T>
): Promise<T> {
  await prisma.$executeRaw`SET app.organization_id = ${orgId}`;
  try {
    return await operation();
  } finally {
    await prisma.$executeRaw`RESET app.organization_id`;
  }
}
```

## PostgreSQL Best Practices

### Indexing Strategy

```sql
-- Composite index for common queries
CREATE INDEX idx_events_org_status ON events(organization_id, status);

-- Partial index for active records only
CREATE INDEX idx_events_active ON events(organization_id)
  WHERE status = 'ACTIVE';

-- Index for timestamp-based queries
CREATE INDEX idx_events_created ON events(created_at DESC);
```

### Common Query Patterns

```typescript
// Pagination with cursor-based approach (better than offset)
const events = await prisma.event.findMany({
  where: { organization_id: orgId },
  take: 20,
  skip: 1,
  cursor: { id: lastEventId },
  orderBy: { created_at: 'desc' },
});

// Upsert for idempotent operations
await prisma.eventHash.upsert({
  where: { hash: contentHash },
  update: { updated_at: new Date() },
  create: { hash: contentHash, event_id: eventId },
});
```
