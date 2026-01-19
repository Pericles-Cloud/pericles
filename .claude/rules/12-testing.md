---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/*.test.tsx"
  - "**/*.spec.tsx"
  - "**/vitest.config.ts"
  - "**/test/**/*.ts"
---

# Testing Standards (Vitest)

## Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // or 'jsdom' for frontend
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.mastra'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/*.d.ts', '**/types/**', 'test/**'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

## Test Setup

```typescript
// test/setup.ts
import { beforeAll, afterAll, afterEach, vi } from 'vitest';

// Mock environment variables
beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.OPENAI_API_KEY = 'test-key';
});

// Reset mocks between tests
afterEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
});

// Cleanup
afterAll(() => {
  vi.restoreAllMocks();
});
```

## Test Structure

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MonitoringAgent', () => {
  // Setup shared across tests in this block
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when detecting weather events', () => {
    it('should return events within radius', async () => {
      // Arrange
      const input = { organization_id: 'uuid', radius_km: 100 };

      // Act
      const result = await weatherTool.execute({ context: input });

      // Assert
      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(3);
    });

    it('should handle API errors gracefully', async () => {
      // Arrange
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(weatherTool.execute({ context: input }))
        .rejects.toThrow('Network error');
    });
  });
});
```

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Unit test | `*.test.ts` | `weather-tool.test.ts` |
| Integration | `*.integration.test.ts` | `monitoring.integration.test.ts` |
| E2E | `*.e2e.test.ts` | `api.e2e.test.ts` |

## Mocking

### Function Mocks

```typescript
import { vi, Mock } from 'vitest';

// Mock a function
const mockFn = vi.fn();
mockFn.mockReturnValue(42);
mockFn.mockResolvedValue({ data: 'async result' });

// Mock implementation
mockFn.mockImplementation((x) => x * 2);

// Verify calls
expect(mockFn).toHaveBeenCalledWith('expected-arg');
expect(mockFn).toHaveBeenCalledTimes(1);
```

### Module Mocks

```typescript
// Mock entire module
vi.mock('@/integrations/sap/client', () => ({
  sapClient: {
    fetchPlants: vi.fn().mockResolvedValue([{ id: '1', name: 'Plant A' }]),
    fetchSuppliers: vi.fn().mockResolvedValue([]),
  },
}));

// Partial mock - keep original implementation for some exports
vi.mock('@/utils/logger', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logger: { info: vi.fn(), error: vi.fn() },
  };
});
```

### Spy on Methods

```typescript
import { vi } from 'vitest';
import { prisma } from '@/db';

// Spy without changing behavior
const spy = vi.spyOn(prisma.event, 'create');

// Spy with mock implementation
vi.spyOn(prisma.event, 'findMany').mockResolvedValue([]);

// Verify spy was called
expect(spy).toHaveBeenCalledWith({
  data: expect.objectContaining({ title: 'Test Event' }),
});
```

### API Mocking with MSW

```typescript
// test/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('https://api.weather.gov/alerts', () => {
    return HttpResponse.json({
      features: [
        { properties: { event: 'Tornado Warning', severity: 'Extreme' } },
      ],
    });
  }),

  http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json({
      choices: [{ message: { content: 'Mocked response' } }],
    });
  }),
];

// test/setup.ts
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Testing Async Code

```typescript
// Async/await
it('should fetch data', async () => {
  const result = await fetchData();
  expect(result).toBeDefined();
});

// Promises
it('should resolve correctly', () => {
  return expect(fetchData()).resolves.toEqual({ data: 'value' });
});

// Rejections
it('should reject on error', () => {
  return expect(failingFetch()).rejects.toThrow('Error message');
});

// Timers
it('should debounce calls', async () => {
  vi.useFakeTimers();
  const callback = vi.fn();

  debouncedCall(callback);
  debouncedCall(callback);

  vi.advanceTimersByTime(500);
  expect(callback).toHaveBeenCalledTimes(1);

  vi.useRealTimers();
});
```

## Testing Mastra Tools

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { weatherDisasterTool } from '@/mastra/tools/weather-disaster-monitor-tool';

describe('weatherDisasterTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should require organization_id', async () => {
    const context = { radius_km: 100 }; // Missing org_id

    await expect(
      weatherDisasterTool.execute({ context })
    ).rejects.toThrow('organization_id required');
  });

  it('should return structured output matching schema', async () => {
    const context = {
      organization_id: '123e4567-e89b-12d3-a456-426614174000',
      radius_km: 500,
    };

    const result = await weatherDisasterTool.execute({ context });

    expect(result).toMatchObject({
      success: expect.any(Boolean),
      events: expect.any(Array),
      metadata: {
        fetched_at: expect.any(String),
        source_count: expect.any(Number),
      },
    });
  });

  it('should timeout after 30 seconds', async () => {
    vi.useFakeTimers();

    const slowFetch = vi.spyOn(global, 'fetch').mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 60000))
    );

    const promise = weatherDisasterTool.execute({
      context: { organization_id: 'uuid', radius_km: 100 },
    });

    vi.advanceTimersByTime(30001);

    await expect(promise).rejects.toThrow();
    vi.useRealTimers();
  });
});
```

## Testing Prisma Queries

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/db';
import { createEvent } from '@/services/event-service';

// Mock Prisma client
vi.mock('@/db', () => ({
  prisma: {
    event: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

describe('EventService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create event with hash', async () => {
    const mockEvent = { id: '1', title: 'Test', hash: 'abc123' };
    vi.mocked(prisma.event.create).mockResolvedValue(mockEvent);

    const result = await createEvent({
      title: 'Test',
      organization_id: 'org-uuid',
    });

    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Test',
        organization_id: 'org-uuid',
      }),
    });
    expect(result.id).toBe('1');
  });
});
```

## Performance Benchmarking

```typescript
import { bench, describe } from 'vitest';

describe('Performance', () => {
  bench('hash computation', () => {
    computeContentHash('test|source|type|hour');
  }, { iterations: 1000 });

  bench('event filtering', async () => {
    await filterEventsByProximity(events, location, 500);
  }, { iterations: 100 });
});
```

## CI/CD Integration

```yaml
# .github/workflows/test.yml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - run: npm ci
    - run: npm run test:ci
    - run: npm run test:coverage

    - uses: codecov/codecov-action@v4
      with:
        files: ./coverage/coverage-final.json
```

```json
// package.json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:ci": "vitest run --reporter=junit --outputFile=test-results.xml",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest --watch"
  }
}
```

## Test Quality Checklist

- [ ] Tests are independent (no shared mutable state)
- [ ] Tests are deterministic (same result every run)
- [ ] Async code properly awaited
- [ ] Mocks reset between tests
- [ ] Edge cases covered (empty arrays, nulls, boundaries)
- [ ] Error paths tested
- [ ] No hardcoded delays (`setTimeout` in tests)
- [ ] Coverage thresholds met (80%+ lines)
