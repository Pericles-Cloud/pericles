# Pericles Core Development Standards

These rules apply to all files in the project.

## Code Quality

**Mandatory checks after every code change:**
```bash
cd backend
npm run lint          # ESLint errors
npm run type-check    # TypeScript errors
```

Do not consider a task complete until both checks pass. Use `npm run lint:fix` for auto-fixable issues.

## Security Requirements

### Tenant Isolation (Critical)
- All data operations MUST be scoped by `organization_id`
- Never allow cross-tenant data access
- Validate tenant context before any read/write operation

### Secrets Management
- API keys stored in environment variables only
- Never log sensitive data (PII, credentials, tokens)
- External API calls must have timeouts and abort controllers

## Environment Variables

### File Hierarchy (highest to lowest priority)
1. `.env.{NODE_ENV}.local` - Local overrides for specific environment
2. `.env.local` - Local overrides (gitignored)
3. `.env.{NODE_ENV}` - Environment-specific
4. `.env` - Default values

### Type-Safe Environment Access

```typescript
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1),
  MASTRA_DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const env = envSchema.parse(process.env);
```

### Environment Variable Rules

| Category | Example | Location |
|----------|---------|----------|
| Secrets | `OPENAI_API_KEY`, `DATABASE_URL` | `.env.local` (gitignored) |
| Non-secrets | `LOG_LEVEL`, `NODE_ENV` | `.env` (committed) |
| Test-only | `TEST_DATABASE_URL` | `.env.test.local` |

```bash
# .gitignore - ALWAYS ignore secret files
.env.local
.env.*.local
```

### Input Validation
- All user inputs validated with Zod schemas
- Sanitize inputs to prevent injection attacks
- Never pass raw user input to database queries

## Git Conventions

### Commit Format
```
feat(agent): add typhoon detection tool [TICKET-123]
fix(tools): handle API timeout in weather monitor [TICKET-124]
refactor(db): optimize event query performance [TICKET-125]
```

### Branch Naming
```
feature/TICKET-123-description
fix/TICKET-124-description
refactor/TICKET-125-description
```

## Code Review Checklist

- [ ] Tenant isolation enforced on all data access
- [ ] Proper error handling with typed errors
- [ ] Timeouts on external API calls
- [ ] Zod schemas validate all inputs
- [ ] No hardcoded credentials or secrets
- [ ] Idempotency for event processing
- [ ] No PII in logs

## Architecture Patterns

### Multi-Tenancy
- Root entity is `Organization` with `organization_id`
- All child entities reference organization
- Queries always filter by organization context

### Error Handling
```typescript
class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

// Validate before operations
if (context.organization_id !== resource.organization_id) {
  throw new TenantIsolationError('Cross-tenant access denied');
}
```
