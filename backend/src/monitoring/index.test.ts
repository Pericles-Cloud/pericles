/**
 * runMonitoringCycle — ROOT-ORG GUARD tests (Vitest, per pericles-testing).
 *
 * `runMonitoringCycle` is the single choke point every cycle path funnels
 * through (scheduled run-once, manual trigger, SSE trigger, start.ts): the
 * root org (Pericles, Inc.) must be refused there, with a sentinel error the
 * API layer maps to 403 rather than 500.
 *
 * Uses a mocked Prisma client (vi.mock of db-client); no DB, no agents.
 * The guard runs before any model/key/DB work, so only the guard is under
 * test — the customer path would run a full cycle (integration scope).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MonitoringConfig } from './config.js';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

// Only these two exports are reached from this file's import graph: the
// cycle guard needs getPrismaClient; mastra/index calls getPostgresStore at
// load (undefined storage is a supported cold-start path).
vi.mock('./db-client.js', () => ({
  getPrismaClient: () => ({ organization: { findUnique } }),
  getPostgresStore: () => undefined,
}));

import { runMonitoringCycle, MonitoringExcludedError } from './index.js';

const ROOT_ID = '00000000-0000-0000-0000-000000000001';
const CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';

const configFor = (organizationId: string) =>
  ({ organizationId }) as unknown as MonitoringConfig;

beforeEach(() => {
  findUnique.mockReset();
});

describe('runMonitoringCycle — root-org guard', () => {
  it('refuses a cycle for the root org before any work happens', async () => {
    findUnique.mockResolvedValue({ is_root: true });

    await expect(runMonitoringCycle(configFor(ROOT_ID))).rejects.toMatchObject({
      name: 'MonitoringExcludedError',
      message: expect.stringMatching(/excluded from monitoring/),
    });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROOT_ID },
        select: { is_root: true },
      })
    );
  });

  it('throws the exported sentinel class API layers map to 403', async () => {
    findUnique.mockResolvedValue({ is_root: true });

    await expect(runMonitoringCycle(configFor(ROOT_ID))).rejects.toBeInstanceOf(
      MonitoringExcludedError
    );
  });

  it('does not fire the guard for a customer org', async () => {
    findUnique.mockResolvedValue({ is_root: false });

    const outcome = await runMonitoringCycle(configFor(CUSTOMER_ID))
      .then(() => null)
      .catch((error: unknown) => error);

    expect(outcome).not.toBeInstanceOf(MonitoringExcludedError);
    // Guard passed: the minimal fixture then fails fast at the first config
    // read (undefined enabledSources), before any agent/model/DB work. If
    // this ever becomes a different failure, the cycle got further — update
    // this fixture deliberately rather than letting it reach live code.
    expect(outcome).toBeInstanceOf(TypeError);
  });
});
