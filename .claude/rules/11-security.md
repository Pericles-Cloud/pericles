---
paths:
  - "backend/**/*.ts"
  - "frontend/**/*.tsx"
  - "packages/**/*.ts"
---

# Security Coding Standards

## Security by Design Principles

1. **Defense in Depth** - Multiple security layers
2. **Least Privilege** - Minimal permissions required
3. **Fail Secure** - Default to secure state on errors
4. **Zero Trust** - Verify all requests regardless of origin

## Input Validation

```typescript
import { z } from 'zod';

// ALWAYS validate untrusted input with Zod schemas
const UserInputSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(100).regex(/^[\w\s-]+$/),
  organization_id: z.string().uuid(),
});

// Validate at system boundaries
export async function handleRequest(body: unknown) {
  const validated = UserInputSchema.parse(body); // Throws on invalid
  return processValidatedInput(validated);
}
```

### Validation Rules

| Data Type | Validation |
|-----------|------------|
| Email | `z.string().email().max(254)` |
| UUID | `z.string().uuid()` |
| URL | `z.string().url()` |
| Integer | `z.number().int().min(0).max(MAX)` |
| String | `z.string().min(1).max(limit).regex(pattern)` |

## Output Encoding

```typescript
// HTML context - use framework auto-escaping
// React handles this automatically with JSX

// JSON context - use JSON.stringify()
const safeJson = JSON.stringify(userInput);

// URL context - use encodeURIComponent()
const safeUrl = `https://api.example.com?q=${encodeURIComponent(query)}`;
```

## Password Security (NIST SP 800-63B)

```typescript
import bcrypt from 'bcrypt';

// Requirements:
// - Minimum 8 characters
// - Allow up to 64+ characters
// - NO arbitrary composition rules (uppercase, special char, etc.)
// - Block compromised passwords (check against HIBP)
// - Use modern KDF (Argon2id preferred, bcrypt acceptable)

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  // Validate length only
  if (password.length < 8) throw new Error('Password too short');
  if (password.length > 72) throw new Error('Password too long for bcrypt');

  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

### Password Anti-Patterns (NEVER DO)

```typescript
// WRONG - arbitrary composition rules
if (!/[A-Z]/.test(password)) throw new Error('Need uppercase');
if (!/[0-9]/.test(password)) throw new Error('Need number');

// WRONG - periodic rotation requirements
if (daysSinceChange > 90) forcePasswordChange();

// WRONG - password hints
storePasswordHint(userHint);
```

## Cryptographic Standards

| Use Case | Algorithm | Key Size |
|----------|-----------|----------|
| Symmetric encryption | AES-256-GCM | 256-bit |
| Password hashing | Argon2id / bcrypt | N/A |
| Digital signatures | RSA-PSS / Ed25519 | 2048+ / 256 |
| Key exchange | ECDH (P-256) | 256-bit |
| Hashing | SHA-256 / SHA-3 | 256-bit |

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

// Generate secure random values
const key = randomBytes(32); // 256 bits
const iv = randomBytes(12);  // GCM IV

// AES-256-GCM encryption
function encrypt(plaintext: string, key: Buffer): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}
```

## Secret Management

```typescript
// CORRECT - secrets from environment
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error('API_KEY not configured');

// CORRECT - validate secret format
const ApiKeySchema = z.string().min(32).max(128);
const validatedKey = ApiKeySchema.parse(process.env.API_KEY);

// WRONG - hardcoded secrets
const apiKey = 'sk-1234567890abcdef'; // NEVER!

// WRONG - secrets in logs
logger.info({ apiKey }, 'Calling API'); // NEVER!
```

## Error Handling (Security)

```typescript
// CORRECT - generic error to user, detailed log internally
try {
  await authenticateUser(credentials);
} catch (error) {
  logger.error({ error, userId: credentials.email }, 'Auth failed');
  throw new APIError('Authentication failed', 401, 'AUTH_FAILED');
  // NOT: 'Invalid password for user john@example.com'
}

// CORRECT - sanitize error responses
return Response.json({
  success: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid request', // Generic
  },
}, { status: 400 });
```

## SQL Injection Prevention

```typescript
// CORRECT - Prisma parameterized queries (automatic)
const user = await prisma.user.findUnique({
  where: { email: userInput }, // Safe - parameterized
});

// CORRECT - raw queries with parameters
const results = await prisma.$queryRaw`
  SELECT * FROM users WHERE email = ${userInput}
`; // Safe - template literal parameterization

// WRONG - string concatenation
const query = `SELECT * FROM users WHERE email = '${userInput}'`; // VULNERABLE!
```

## XSS Prevention

```typescript
// React auto-escapes by default - this is safe:
return <div>{userInput}</div>;

// DANGEROUS - bypasses escaping:
return <div dangerouslySetInnerHTML={{ __html: userInput }} />; // AVOID!

// If HTML is needed, sanitize first:
import DOMPurify from 'dompurify';
const sanitized = DOMPurify.sanitize(userInput);
return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
```

## Audit Logging

```typescript
// Log security-relevant events (never PII in logs)
audit({
  action: 'USER_LOGIN',
  actor_id: user.id,          // Internal ID, not email
  resource_type: 'session',
  resource_id: session.id,
  tenant_id: user.organization_id,
  ip_address: request.ip,     // Useful for security
  timestamp: new Date().toISOString(),
  result: 'success',
});

// Required audit events:
// - Authentication (login, logout, failed attempts)
// - Authorization (access granted, denied)
// - Data access (sensitive data reads)
// - Data modification (create, update, delete)
// - Admin actions (user management, config changes)
```

## SAST/DAST Integration

### Pre-commit Checks
```bash
# package.json scripts
"scripts": {
  "security:audit": "npm audit --audit-level=high",
  "security:lint": "eslint --config .eslintrc.security.js",
  "security:secrets": "gitleaks detect --source ."
}
```

### CI/CD Pipeline
```yaml
# Run on every PR
security:
  - npm audit --audit-level=high
  - eslint --config .eslintrc.security.js
  - gitleaks detect --source .
  - trivy fs --severity HIGH,CRITICAL .
```

## Security Checklist

Before merging any PR:

- [ ] Input validation on all user-supplied data
- [ ] Output encoding appropriate to context
- [ ] No hardcoded secrets or credentials
- [ ] No sensitive data in logs
- [ ] Parameterized queries (no string concatenation)
- [ ] Proper error handling (no stack traces to users)
- [ ] Authentication/authorization checks present
- [ ] Rate limiting on sensitive endpoints
