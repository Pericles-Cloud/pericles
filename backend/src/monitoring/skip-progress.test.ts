/**
 * #72: an org with no provider key is a configuration skip, not a failure.
 * The cycle must emit no progress 'error' (the stream's terminal event
 * reports the skip, see cycle-outcome.ts) and still throw MissingApiKeyError
 * so callers log at WARN and the stream says outcome 'skipped'.
 *
 * Mocks: db-client (customer org, not root) and resolveModel (throws the
 * missing-key error, as config.ts does when the org has no key).
 */
import { describe, it, expect, vi } from 'vitest';
import type * as ConfigModule from './config.js';
import type { MonitoringConfig } from './config.js';
import type { ProgressUpdate } from './index.js';

vi.mock('./db-client.js', () => ({
  getPrismaClient: () => ({ organization: { findUnique: () => Promise.resolve({ is_root: false }) } }),
  getPostgresStore: () => undefined,
}));

vi.mock('./config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>();
  return {
    ...actual,
    resolveModel: () => {
      const error = new Error('No openrouter API key configured for this organization');
      error.name = 'MissingApiKeyError';
      return Promise.reject(error);
    },
  };
});

import { runMonitoringCycle } from './index.js';

describe('runMonitoringCycle — missing API key (#72)', () => {
  it("emits no 'error' progress and rethrows MissingApiKeyError", async () => {
    const updates: ProgressUpdate[] = [];
    const config = {
      organizationId: '11111111-1111-1111-1111-111111111111',
      enabledSources: {},
      observability: { enableAuditLog: false },
    } as unknown as MonitoringConfig;

    await expect(runMonitoringCycle(config, (u) => updates.push(u))).rejects.toMatchObject({
      name: 'MissingApiKeyError',
    });

    expect(updates.map((u) => u.phase)).not.toContain('error');
  });
});
