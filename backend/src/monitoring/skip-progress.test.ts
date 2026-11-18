/**
 * #72: an org with no provider key is a configuration skip, not a failure.
 * The cycle must report progress phase 'skipped' (the UI renders it neutral),
 * never 'error', and still throw MissingApiKeyError so callers log at WARN.
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
  it("reports phase 'skipped' (not 'error') and rethrows MissingApiKeyError", async () => {
    const updates: ProgressUpdate[] = [];
    const config = {
      organizationId: '11111111-1111-1111-1111-111111111111',
      enabledSources: {},
      observability: { enableAuditLog: false },
    } as unknown as MonitoringConfig;

    await expect(runMonitoringCycle(config, (u) => updates.push(u))).rejects.toMatchObject({
      name: 'MissingApiKeyError',
    });

    const phases = updates.map((u) => u.phase);
    expect(phases).toContain('skipped');
    expect(phases).not.toContain('error');
    expect(updates.find((u) => u.phase === 'skipped')?.message).toMatch(/No openrouter API key/);
  });
});
