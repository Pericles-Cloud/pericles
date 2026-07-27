---
paths:
  - "backend/src/server/**/*.ts"
---

# API Development Standards

> The HTTP surface is `backend/src/server/auth-server.ts` — Express routes on a
> Coolify container. The examples below are written against the Web `Request`/
> `Response` API; translate them to Express handlers
> (`app.get(path, (req, res) => …)`, `res.status(...).json(...)`). The
> substance — Zod validation, the `{success, data, metadata}` envelope, and
> validating `organization_id` server-side on every route — applies unchanged.
>
> (These paths used to point at `backend/api/**`, the deleted Vercel serverless
> tree, and at `backend/src/api/**`, which never existed.)

## Request Validation

```typescript
import { z } from 'zod';

const TriggerMonitoringSchema = z.object({
  organization_id: z.string().uuid(),
  risk_types: z.array(z.enum([
    'WEATHER', 'POLITICAL', 'CYBER', 'ECONOMIC', 'NEWS',
    'MARITIME', 'LABOR', 'REGULATORY', 'PANDEMIC', 'GEOPOLITICAL',
  ])).optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }).optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const validated = TriggerMonitoringSchema.parse(body);
  // Proceed with validated input
}
```

## Response Format

```typescript
// Success response
return Response.json({
  success: true,
  data: result,
  metadata: {
    timestamp: new Date().toISOString(),
    request_id: requestId,
  },
});

// Error response
return Response.json({
  success: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid organization_id',
    details: zodError.errors,
  },
}, { status: 400 });
```

## Tenant Context Validation

```typescript
async function requireTenantContext(request: Request) {
  const orgId = request.headers.get('x-organization-id');

  if (!orgId) {
    throw new APIError('Missing organization context', 401, 'MISSING_TENANT');
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, settings: true },
  });

  if (!org) {
    throw new APIError('Invalid organization', 403, 'INVALID_TENANT');
  }

  return org;
}
```

## Error Handling

```typescript
export async function POST(request: Request) {
  try {
    const org = await requireTenantContext(request);
    const body = await request.json();
    const validated = RequestSchema.parse(body);

    const result = await processRequest(validated, org);

    return Response.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', details: error.errors },
      }, { status: 400 });
    }

    if (error instanceof APIError) {
      return Response.json({
        success: false,
        error: { code: error.code, message: error.message },
      }, { status: error.status });
    }

    logger.error({ error }, 'Unhandled API error');
    return Response.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    }, { status: 500 });
  }
}
```

## Rate Limiting Guidelines

| Endpoint Type | Limit |
|--------------|-------|
| Monitoring triggers | 10/minute per org |
| Query endpoints | 100/minute per org |
| Webhook endpoints | 1000/minute per org |
