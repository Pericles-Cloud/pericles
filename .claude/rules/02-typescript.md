---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript Standards

## Configuration

- TypeScript 5.9+ with strict mode
- ES Modules (ESM) - use `import`/`export`
- Target: ES2022

## Type Safety

### Explicit Types
- Explicit return types on exported functions
- No `any` type - use `unknown` and narrow with type guards
- Prefer interfaces for object shapes, types for unions

```typescript
// CORRECT
export function processEvent(event: Event): ProcessedEvent {
  return { ...event, processed: true };
}

// INCORRECT
export function processEvent(event) {
  return { ...event, processed: true };
}
```

### Zod Schema Patterns
```typescript
import { z } from 'zod';

// Define schema with descriptive fields
const EventSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  severity: z.number().min(0).max(1),
  organization_id: z.string().uuid(),
  created_at: z.string().datetime(),
});

// Infer TypeScript type from schema
type Event = z.infer<typeof EventSchema>;

// Validate at runtime
const validated = EventSchema.parse(input);
```

## Error Handling

```typescript
// Typed custom errors
class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// Handle errors explicitly
try {
  await riskyOperation();
} catch (error) {
  if (error instanceof APIError) {
    logger.error({ error, status: error.status }, 'API error');
    throw error;
  }
  throw new Error('Unexpected error', { cause: error });
}
```

## Async Patterns

- Always use `async`/`await` over raw Promises
- Handle Promise rejections explicitly
- Use `Promise.all` for concurrent independent operations
- Add timeouts to external calls

```typescript
// Timeout pattern for external calls
const fetchWithTimeout = async (url: string, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};
```

## Module Organization

- Use barrel exports (`index.ts`) sparingly
- Prefer direct imports for tree-shaking
- Co-locate types with implementation
