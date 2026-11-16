/**
 * Client Monitoring consumer — tenant scope of targeted records (issue #76).
 * Mocked Prisma and Mastra; no DB, no LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  globalEvent: { findUnique: vi.fn() },
  organization: { findMany: vi.fn() },
  clientExposureProfile: { findUnique: vi.fn() },
  messageQueue: { createMany: vi.fn() },
}));

vi.mock('../../monitoring/db-client.js', () => ({ getPrismaClient: () => fake }));
const agent = vi.hoisted(() => ({ generate: vi.fn() }));
const upsert = vi.hoisted(() => vi.fn());

vi.mock('../../mastra/index.js', () => ({ mastra: { getAgent: () => agent } }));
vi.mock('../../monitoring/candidate-exposure-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Store>()),
  upsertCandidateExposure: upsert,
}));

import type * as Store from '../../monitoring/candidate-exposure-store.js';
import { clientMonitoringConsumer } from './client-monitoring.js';
import type { ChangeRecord } from '../records/change-record.js';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

const record = (organization_id: string | null, payload: Record<string, unknown>): ChangeRecord => ({
  record_id: 'ge-1:change',
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
  fake.messageQueue.createMany.mockReset().mockImplementation(({ data }: { data: unknown[] }) =>
    Promise.resolve({ count: data.length })
  );
});

interface QueueRow {
  idempotency_key: string;
  organization_id: string;
  payload: ChangeRecord;
}
const retryRows = (): QueueRow[] =>
  fake.messageQueue.createMany.mock.calls.flatMap((c) => (c[0] as { data: QueueRow[] }).data);

describe('clientMonitoringConsumer target_organization_id', () => {
  it('ignores a record whose target org differs from its own scope', async () => {
    await run(record(ORG_A, { event_id: 'ge-1', target_organization_id: ORG_B }));
    expect(fake.globalEvent.findUnique).not.toHaveBeenCalled();
    expect(fake.organization.findMany).not.toHaveBeenCalled();
  });

  it('rejects a present-but-null target instead of fanning out to every tenant', async () => {
    await run(record(ORG_A, { event_id: 'ge-1', target_organization_id: null }));
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
  beforeEach(() => {
    fake.globalEvent.findUnique.mockResolvedValue({ id: 'ge-1', status: 'ACTIVE', event_hash: 'h' });
    fake.organization.findMany.mockResolvedValue([
      { id: ORG_A, name: 'A' },
      { id: ORG_B, name: 'B' },
    ]);
  });

  it('completes the fan-out and hands only the failed org an org-scoped retry record', async () => {
    fake.clientExposureProfile.findUnique
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(null);

    await run(record(null, { event_id: 'ge-1' }));

    expect(fake.clientExposureProfile.findUnique).toHaveBeenCalledTimes(2);
    const rows = retryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(ORG_A);
    expect(rows[0].idempotency_key).toBe(`ge-1:change:org:${ORG_A}:1`);
    expect(rows[0].payload.payload).toEqual({
      event_id: 'ge-1',
      change_type: 'org_retry',
      target_organization_id: ORG_A,
    });
  });

  it('hands every org not yet reached a retry record when aborted mid-fan-out', async () => {
    const controller = new AbortController();
    fake.clientExposureProfile.findUnique.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(null);
    });

    await clientMonitoringConsumer({ record: record(null, { event_id: 'ge-1' }), signal: controller.signal } as never);

    expect(retryRows().map((r) => r.organization_id)).toEqual([ORG_B]);
  });

  it('fails the stage for a single-org record so the dispatcher retries it', async () => {
    fake.organization.findMany.mockResolvedValue([{ id: ORG_A, name: 'A' }]);
    fake.clientExposureProfile.findUnique.mockRejectedValueOnce(new Error('connection reset'));

    await expect(run(record(ORG_A, { event_id: 'ge-1', target_organization_id: ORG_A }))).rejects.toThrow(
      'did not complete'
    );
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });
});

describe('clientMonitoringConsumer agent output', () => {
  const exposure = (strength: string, assetId: string) => ({
    exposure_pathways: [{ pathway: 'geographic_site', match_basis: 'in zone', confidence: 0.9 }],
    exposure_strength: strength,
    exposed_assets: [{ asset_type: 'facility', asset_id: assetId, distance_or_match_basis: '3km' }],
    match_confidence: {},
    rationale: `Asset ${assetId} is exposed.`,
    exposure_priority: 'high',
  });

  beforeEach(() => {
    fake.globalEvent.findUnique.mockResolvedValue({ id: 'ge-1', status: 'ACTIVE', event_hash: 'h', category: 'x' });
    fake.organization.findMany.mockResolvedValue([{ id: ORG_A, name: 'A' }]);
    fake.clientExposureProfile.findUnique.mockResolvedValue({ profile_version: 3 });
    upsert.mockReset().mockResolvedValue({
      candidate_exposure_id: 'ce-1',
      validation_status: 'CANDIDATE',
      outcome: 'created',
      change_record_emitted: true,
    });
  });

  it('merges every item for the event into one upsert, keeping the strongest', async () => {
    agent.generate.mockResolvedValue({
      text: JSON.stringify({ candidate_exposures: [exposure('probable', 'f-1'), exposure('direct', 'f-2')] }),
    });

    await run(record(null, { event_id: 'ge-1' }));

    expect(upsert).toHaveBeenCalledTimes(1);
    const input = upsert.mock.calls[0][0];
    expect(input.organization_id).toBe(ORG_A);
    expect(input.exposure_strength).toBe('direct');
    expect(input.exposed_assets.map((a: { asset_id: string }) => a.asset_id)).toEqual(['f-1', 'f-2']);
  });

  it('stores a watch-list item as a possible exposure', async () => {
    const { exposure_strength: _s, ...watched } = exposure('possible', 'f-9');
    agent.generate.mockResolvedValue({ text: JSON.stringify({ candidate_exposures: [], watch_list: [watched] }) });

    await run(record(null, { event_id: 'ge-1' }));

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].exposure_strength).toBe('possible');
  });

  it('keeps a watch-list item watch-only even if the model labels it stronger', async () => {
    agent.generate.mockResolvedValue({
      text: JSON.stringify({ candidate_exposures: [], watch_list: [exposure('probable', 'f-8')] }),
    });

    await run(record(null, { event_id: 'ge-1' }));

    expect(upsert.mock.calls[0][0].exposure_strength).toBe('possible');
  });

  it('writes nothing when the agent finds no exposure', async () => {
    agent.generate.mockResolvedValue({ text: JSON.stringify({ candidate_exposures: [], watch_list: [] }) });
    await run(record(null, { event_id: 'ge-1' }));
    expect(upsert).not.toHaveBeenCalled();
  });
});

