/**
 * Client Monitoring consumer — tenant scope of targeted records (issue #76).
 * Mocked Prisma and Mastra; no DB, no LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  globalEvent: { findUnique: vi.fn() },
  organization: { findMany: vi.fn() },
  clientExposureProfile: { findUnique: vi.fn() },
}));

vi.mock('../../monitoring/db-client.js', () => ({ getPrismaClient: () => fake }));
vi.mock('../../mastra/index.js', () => ({ mastra: { getAgent: vi.fn() } }));

import { clientMonitoringConsumer } from './client-monitoring.js';
import type { ChangeRecord } from '../records/change-record.js';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

const record = (organization_id: string | null, payload: Record<string, unknown>): ChangeRecord => ({
  record_id: 'ge-1:backmatch',
  record_version: 1,
  record_type: 'global_event_change',
  organization_id,
  produced_at: '2026-11-16T00:00:00.000Z',
  payload,
});

const run = (r: ChangeRecord) =>
  clientMonitoringConsumer({ record: r, signal: new AbortController().signal } as never);

beforeEach(() => {
  fake.globalEvent.findUnique.mockReset().mockResolvedValue({ id: 'ge-1', status: 'RESOLVED', event_hash: 'h' });
  fake.organization.findMany.mockReset().mockResolvedValue([]);
  fake.clientExposureProfile.findUnique.mockReset();
});

describe('clientMonitoringConsumer target_organization_id', () => {
  it('ignores a record whose target org differs from its own scope', async () => {
    await run(record(ORG_A, { event_id: 'ge-1', target_organization_id: ORG_B }));
    expect(fake.globalEvent.findUnique).not.toHaveBeenCalled();
    expect(fake.organization.findMany).not.toHaveBeenCalled();
  });

  it('restricts fan-out to the target org when it matches the record scope', async () => {
    await run(record(ORG_A, { event_id: 'ge-1', target_organization_id: ORG_A }));
    expect(fake.organization.findMany.mock.calls[0][0].where.id).toBe(ORG_A);
  });

  it('fans out to all orgs for an untargeted global record', async () => {
    await run(record(null, { event_id: 'ge-1' }));
    expect(fake.organization.findMany.mock.calls[0][0].where.id).toBeUndefined();
  });
});

describe('clientMonitoringConsumer failure handling', () => {
  it('fails the stage when an org evaluation hits an infrastructure error, after trying the rest', async () => {
    fake.globalEvent.findUnique.mockResolvedValue({ id: 'ge-1', status: 'ACTIVE', event_hash: 'h' });
    fake.organization.findMany.mockResolvedValue([{ id: ORG_A, name: 'A' }, { id: ORG_B, name: 'B' }]);
    fake.clientExposureProfile.findUnique
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(null);

    await expect(run(record(null, { event_id: 'ge-1' }))).rejects.toThrow('failed for 1 of 2');
    expect(fake.clientExposureProfile.findUnique).toHaveBeenCalledTimes(2);
  });
});
