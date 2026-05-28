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
