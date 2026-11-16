/**
 * Client Monitoring consumer — fan-out, tenant scope, per-org evaluation (issue #76).
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
import { clientMonitoringConsumer, parseAgentJson } from './client-monitoring.js';
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

/** An org-scoped record, as the fan-out produces. */
const orgRecord = (orgId: string) => record(orgId, { event_id: 'ge-1', target_organization_id: orgId });

beforeEach(() => {
  fake.globalEvent.findUnique.mockReset().mockResolvedValue({ id: 'ge-1', status: 'RESOLVED', event_hash: 'h' });
  fake.organization.findMany.mockReset().mockResolvedValue([]);
  fake.clientExposureProfile.findUnique.mockReset();
  agent.generate.mockReset();
  fake.messageQueue.createMany.mockReset().mockImplementation(({ data }: { data: unknown[] }) =>
    Promise.resolve({ count: data.length })
  );
});

interface QueueRow {
  idempotency_key: string;
  organization_id: string;
  payload: ChangeRecord;
}
const queuedRows = (): QueueRow[] =>
  fake.messageQueue.createMany.mock.calls.flatMap((c) => (c[0] as { data: QueueRow[] }).data);

describe('clientMonitoringConsumer fan-out', () => {
  it('enqueues one org-scoped record per eligible org and evaluates none inline', async () => {
    fake.organization.findMany.mockResolvedValue([{ id: ORG_A }, { id: ORG_B }]);

    await run(record(null, { event_id: 'ge-1', change_type: 'created' }));

    expect(fake.clientExposureProfile.findUnique).not.toHaveBeenCalled();
    expect(agent.generate).not.toHaveBeenCalled();
    const rows = queuedRows();
    expect(rows.map((r) => r.organization_id)).toEqual([ORG_A, ORG_B]);
    expect(rows[0].idempotency_key).toBe(`ge-1:change:org:${ORG_A}:1`);
    // Minimal payload: routes to client_monitoring only, never Event Verification.
    expect(rows[0].payload.payload).toEqual({
      event_id: 'ge-1',
      change_type: 'org_fanout',
      target_organization_id: ORG_A,
    });
    expect(fake.organization.findMany.mock.calls[0][0].where.id).toBeUndefined();
  });

  it('enqueues nothing when no org is eligible', async () => {
    await run(record(null, { event_id: 'ge-1' }));
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });
});

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

  it('evaluates only the target org, and only if it is eligible', async () => {
    await run(orgRecord(ORG_A));
    expect(fake.organization.findMany.mock.calls[0][0].where.id).toBe(ORG_A);
    // Not eligible (empty result): no evaluation, nothing enqueued.
    expect(fake.clientExposureProfile.findUnique).not.toHaveBeenCalled();
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });
});

describe('clientMonitoringConsumer org evaluation', () => {
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
    fake.organization.findMany.mockResolvedValue([{ id: ORG_A }]);
    fake.clientExposureProfile.findUnique.mockResolvedValue({ profile_version: 3 });
    upsert.mockReset().mockResolvedValue({
      candidate_exposure_id: 'ce-1',
      validation_status: 'CANDIDATE',
      outcome: 'created',
      change_record_emitted: true,
    });
  });

  it('fails the stage on an infrastructure error so the queue retries this org', async () => {
    fake.clientExposureProfile.findUnique.mockRejectedValueOnce(new Error('connection reset'));
    await expect(run(orgRecord(ORG_A))).rejects.toThrow('connection reset');
  });

  it('fails the stage on an unreadable agent response instead of recording no exposure', async () => {
    agent.generate.mockResolvedValue({ text: 'I could not decide.' });
    await expect(run(orgRecord(ORG_A))).rejects.toThrow('no parseable JSON');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('merges every item for the event into one upsert, keeping the strongest', async () => {
    agent.generate.mockResolvedValue({
      text: JSON.stringify({ candidate_exposures: [exposure('probable', 'f-1'), exposure('direct', 'f-2')] }),
    });

    await run(orgRecord(ORG_A));

    expect(upsert).toHaveBeenCalledTimes(1);
    const input = upsert.mock.calls[0][0];
    expect(input.organization_id).toBe(ORG_A);
    expect(input.exposure_strength).toBe('direct');
    expect(input.exposed_assets.map((a: { asset_id: string }) => a.asset_id)).toEqual(['f-1', 'f-2']);
  });

  it('stores a watch-list item as a possible exposure', async () => {
    const { exposure_strength: _s, ...watched } = exposure('possible', 'f-9');
    agent.generate.mockResolvedValue({ text: JSON.stringify({ candidate_exposures: [], watch_list: [watched] }) });

    await run(orgRecord(ORG_A));

    expect(upsert.mock.calls[0][0].exposure_strength).toBe('possible');
  });

  it('keeps a watch-list item watch-only even if the model labels it stronger', async () => {
    agent.generate.mockResolvedValue({
      text: JSON.stringify({ candidate_exposures: [], watch_list: [exposure('probable', 'f-8')] }),
    });

    await run(orgRecord(ORG_A));

    expect(upsert.mock.calls[0][0].exposure_strength).toBe('possible');
  });

  it('ignores watch-list items when there is a real candidate, so they cannot pad its assets', async () => {
    agent.generate.mockResolvedValue({
      text: JSON.stringify({ candidate_exposures: [exposure('direct', 'f-1')], watch_list: [exposure('possible', 'l-9')] }),
    });

    await run(orgRecord(ORG_A));

    expect(upsert.mock.calls[0][0].exposed_assets.map((a: { asset_id: string }) => a.asset_id)).toEqual(['f-1']);
  });

  it('writes nothing when the agent finds no exposure', async () => {
    agent.generate.mockResolvedValue({ text: JSON.stringify({ candidate_exposures: [], watch_list: [] }) });
    await run(orgRecord(ORG_A));
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('parseAgentJson', () => {
  it('prefers a fenced json block over braces in surrounding prose', () => {
    expect(parseAgentJson('Evaluating {org} exposure...\n```json\n{"a": 1}\n```\nDone {x}')).toEqual({ a: 1 });
  });

  it('finds the first balanced object that parses, skipping braces in prose and strings', () => {
    expect(parseAgentJson('Note {not json} then {"rationale": "a } inside", "b": [1]} end }')).toEqual({
      rationale: 'a } inside',
      b: [1],
    });
  });

  it('throws when there is no object', () => {
    expect(() => parseAgentJson('no json here')).toThrow('no parseable JSON');
  });
});
