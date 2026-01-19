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

```
# Production connection with pooling
DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require&pgbouncer=true"

# Direct connection for migrations
DIRECT_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require"
```
