/**
 * Candidate exposure store — Validation hand-off (issue #76).
 * Mocked Prisma client; no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const fake = vi.hoisted(() => ({
  candidateExposure: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  messageQueue: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));

import {
  upsertCandidateExposure,
  statusForStrength,
  CandidateEvaluationSchema,
  LEGACY_PENDING,
  mergeEvaluations,
  type CandidateEvaluation,
  type CandidateExposureInput,
} from './candidate-exposure-store.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const INT32_MAX = 2_147_483_647;
const INPUT: CandidateExposureInput = {
  organization_id: ORG,
  global_event_id: '22222222-2222-2222-2222-222222222222',
  global_event_hash: 'hash-1',
  exposure_pathways: [{ pathway: 'geographic_site', match_basis: 'plant 12km', confidence: 0.9 }],
  exposure_strength: 'direct',
  exposed_assets: [{ asset_type: 'facility', asset_id: 'f-1', distance_or_match_basis: '12km' }],
  match_confidence: { location: 0.9 },
  rationale: 'Plant is inside the affected area.',
  exposure_priority: 'high',
};

/** Queue rows written in this test. */
const enqueuedRows = (): Array<{ payload: Record<string, unknown>; idempotency_key: string }> =>
  fake.messageQueue.createMany.mock.calls.map(
    (call) => (call[0] as { data: Array<{ payload: Record<string, unknown>; idempotency_key: string }> }).data[0]
  );

const existingRow = (overrides: Record<string, unknown>) => ({
  id: 'ce-x',
  validation_status: 'WATCHING',
  exposure_strength: 'possible',
  exposed_assets: INPUT.exposed_assets,
  handoff_version: 0,
  ...overrides,
});

beforeEach(() => {
  fake.$transaction.mockReset().mockImplementation((fn: (tx: unknown) => unknown) => fn(fake));
  fake.candidateExposure.findUnique.mockReset();
  fake.candidateExposure.create.mockReset();
  fake.candidateExposure.updateMany.mockReset().mockResolvedValue({ count: 1 });
  fake.messageQueue.createMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('statusForStrength', () => {
  it('watches possible exposures and sends the rest to Validation', () => {
    expect(statusForStrength('possible')).toBe('WATCHING');
    expect(statusForStrength('direct')).toBe('CANDIDATE');
    expect(statusForStrength('probable')).toBe('CANDIDATE');
    expect(statusForStrength('strategic')).toBe('CANDIDATE');
  });
});

describe('CandidateEvaluationSchema', () => {
  it('accepts date-only and offset timestamps and a missing match_confidence', () => {
    const { organization_id: _o, global_event_id: _g, global_event_hash: _h, match_confidence: _m, ...rest } = INPUT;
    const parsed = CandidateEvaluationSchema.safeParse({
      ...rest,
      temporal_relevance: { shipment_eta: '2026-11-20', regulation_effective_date: '2026-11-20T00:00:00+02:00' },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.match_confidence).toEqual({});
  });

  it('keeps a candidate when one asset or pathway is malformed, dropping only that item', () => {
    const { organization_id: _o, global_event_id: _g, global_event_hash: _h, ...evaluation } = INPUT;
    const parsed = CandidateEvaluationSchema.safeParse({
      ...evaluation,
      exposure_priority: 'urgent',
      exposed_assets: [
        ...evaluation.exposed_assets,
        { asset_type: 'port', asset_id: 'USBAL' },
        { asset_type: 'supplier', asset_id: 's-2' },
      ],
      exposure_pathways: [...evaluation.exposure_pathways, { pathway: 'vibes', match_basis: '?' }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.exposed_assets.map((a) => a.asset_id)).toEqual(['f-1', 's-2']);
    expect(parsed.data.exposure_pathways).toHaveLength(1);
    expect(parsed.data.exposure_priority).toBe('medium');
  });

  it('normalizes worded strength and falls back to possible when unreadable', () => {
    const { organization_id: _o, global_event_id: _g, global_event_hash: _h, ...evaluation } = INPUT;
    const strengthOf = (value: unknown) => {
      const parsed = CandidateEvaluationSchema.safeParse({ ...evaluation, exposure_strength: value });
      return parsed.success ? parsed.data.exposure_strength : 'FAILED';
    };
    expect(strengthOf('Direct exposure')).toBe('direct');
    expect(strengthOf('maybe')).toBe('possible');
    // Negated or hedged wording must not upgrade the item.
    expect(strengthOf('not direct, possible')).toBe('possible');
    expect(strengthOf('indirect')).toBe('possible');
    expect(strengthOf('improbable')).toBe('possible');
    expect(strengthOf(undefined)).toBe('possible');
  });

  it('accepts mixed-case strength and priority, and missing arrays and rationale', () => {
    const parsed = CandidateEvaluationSchema.safeParse({ exposure_strength: 'Direct', exposure_priority: 'HIGH' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      exposure_strength: 'direct',
      exposure_priority: 'high',
      exposure_pathways: [],
      exposed_assets: [],
      rationale: '',
    });
  });

});

describe('upsertCandidateExposure', () => {
  it('rejects a missing organization_id', async () => {
    await expect(upsertCandidateExposure({ ...INPUT, organization_id: '' })).rejects.toThrow(
      'organization_id required'
    );
  });

  it('creates a CANDIDATE and emits hand-off v1 in the same transaction', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(null);
    fake.candidateExposure.create.mockResolvedValue({ id: 'ce-1', validation_status: 'CANDIDATE' });

    const result = await upsertCandidateExposure(INPUT);

    expect(result).toEqual({
      candidate_exposure_id: 'ce-1',
      validation_status: 'CANDIDATE',
      outcome: 'created',
      change_record_emitted: true,
    });
    expect(fake.candidateExposure.create.mock.calls[0][0].data.handoff_version).toBe(1);
    const [row] = enqueuedRows();
    expect(row.payload).toMatchObject({
      record_id: 'ce-1',
      record_version: 1,
      record_type: 'candidate_exposure',
      organization_id: ORG,
    });
    expect(row.idempotency_key).toBe('ce-1:1');
  });

  it('creates a WATCHING row for a possible exposure without emitting', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(null);
    fake.candidateExposure.create.mockResolvedValue({ id: 'ce-2', validation_status: 'WATCHING' });

    const result = await upsertCandidateExposure({ ...INPUT, exposure_strength: 'possible' });

    expect(result.change_record_emitted).toBe(false);
    expect(fake.candidateExposure.create.mock.calls[0][0].data.handoff_version).toBe(0);
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('promotes WATCHING with the next small hand-off version (fits DispatchLog Int)', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(existingRow({ id: 'ce-3', handoff_version: 2 }));

    const result = await upsertCandidateExposure(INPUT);

    expect(result.outcome).toBe('updated');
    expect(result.change_record_emitted).toBe(true);
    const [row] = enqueuedRows();
    expect(row.payload.record_version).toBe(3);
    expect(row.payload.record_version as number).toBeLessThanOrEqual(INT32_MAX);
    expect(fake.candidateExposure.updateMany.mock.calls[0][0].data.handoff_version).toBe(3);
  });

  it('clears temporal_relevance and strategic_context on refresh when the new evaluation has none', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(existingRow({ id: 'ce-5' }));

    await upsertCandidateExposure(INPUT);

    const data = fake.candidateExposure.updateMany.mock.calls[0][0].data;
    expect(data.temporal_relevance).toBe(Prisma.DbNull);
    expect(data.strategic_context).toBe(Prisma.DbNull);
  });

  it('leaves a REJECTED exposure alone when the evaluation brings no new evidence', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-6', validation_status: 'REJECTED', exposure_strength: 'direct', handoff_version: 1 })
    );

    const result = await upsertCandidateExposure(INPUT);

    expect(result.outcome).toBe('unchanged');
    expect(fake.candidateExposure.updateMany).not.toHaveBeenCalled();
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });


  it('emits v1 for a legacy CANDIDATE row from the stored fields, not the new evaluation', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({
        id: 'ce-9',
        validation_status: 'CANDIDATE',
        exposure_strength: 'direct',
        exposure_priority: 'critical',
        organization_id: ORG,
        global_event_id: INPUT.global_event_id,
        global_event_hash: INPUT.global_event_hash,
        handoff_version: LEGACY_PENDING,
      })
    );

    const result = await upsertCandidateExposure({ ...INPUT, exposure_strength: 'possible', exposure_priority: 'low' });

    expect(result.change_record_emitted).toBe(true);
    expect(fake.candidateExposure.updateMany.mock.calls[0][0].data).toEqual({ handoff_version: 2 });
    const [row] = enqueuedRows();
    // v2, never v1: an old candidateExposureTool may already have emitted v1.
    expect(row.idempotency_key).toBe('ce-9:2');
    expect(row.payload.payload).toMatchObject({ exposure_strength: 'direct', exposure_priority: 'critical' });
  });

  it('hands off a CANDIDATE written at handoff_version 0 by another path (e.g. the migration script)', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({
        id: 'ce-21',
        validation_status: 'CANDIDATE',
        exposure_strength: 'direct',
        exposure_priority: 'high',
        organization_id: ORG,
        global_event_id: INPUT.global_event_id,
        global_event_hash: INPUT.global_event_hash,
        handoff_version: 0,
      })
    );

    const result = await upsertCandidateExposure(INPUT);

    expect(result.change_record_emitted).toBe(true);
    expect(enqueuedRows()[0].idempotency_key).toBe('ce-21:2');
  });

  it('reports change_record_emitted false when the record was already queued', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-10', validation_status: 'CANDIDATE', exposure_strength: 'direct', handoff_version: LEGACY_PENDING })
    );
    fake.messageQueue.createMany.mockResolvedValue({ count: 0 });

    const result = await upsertCandidateExposure(INPUT);

    expect(result.change_record_emitted).toBe(false);
  });

  it('keeps a REJECTED exposure rejected when the model only renames the same assets', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-11', validation_status: 'REJECTED', exposure_strength: 'direct', handoff_version: 1 })
    );

    const result = await upsertCandidateExposure({
      ...INPUT,
      exposed_assets: [{ asset_type: 'facility', asset_id: 'Plant One (F-1)', distance_or_match_basis: '12km' }],
    });

    expect(result.outcome).toBe('unchanged');
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('matches asset ids case- and whitespace-insensitively', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-12', validation_status: 'REJECTED', exposure_strength: 'direct', handoff_version: 1 })
    );

    const result = await upsertCandidateExposure({
      ...INPUT,
      exposed_assets: [{ asset_type: 'facility', asset_id: ' F-1 ', distance_or_match_basis: '12km' }],
    });

    expect(result.outcome).toBe('unchanged');
  });


  it('keeps a rejection when the model only names an extra asset at the same strength', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-7', validation_status: 'REJECTED', exposure_strength: 'direct', handoff_version: 1 })
    );

    const result = await upsertCandidateExposure({
      ...INPUT,
      exposed_assets: [
        ...INPUT.exposed_assets,
        { asset_type: 'shipment', asset_id: 's-9', distance_or_match_basis: 'via port' },
      ],
    });

    expect(result.outcome).toBe('unchanged');
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('never reopens a rejection with a weaker evaluation', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-17', validation_status: 'REJECTED', exposure_strength: 'probable', handoff_version: 1 })
    );

    const result = await upsertCandidateExposure({ ...INPUT, exposure_strength: 'possible' });

    expect(result.outcome).toBe('unchanged');
    expect(fake.candidateExposure.updateMany).not.toHaveBeenCalled();
  });

  it('reopens a rejection when the exposure is stronger, clearing the old verdict', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-18', validation_status: 'REJECTED', exposure_strength: 'probable', handoff_version: 1 })
    );

    const result = await upsertCandidateExposure(INPUT);

    expect(result).toMatchObject({ outcome: 'updated', change_record_emitted: true });
    expect(enqueuedRows()[0].payload.record_version).toBe(2);
    expect(fake.candidateExposure.updateMany.mock.calls[0][0].data.validation_ref).toBeNull();
  });

  it('renews a CLEARED exposure as a new hand-off, clearing its end state', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-19', validation_status: 'CLEARED', exposure_strength: 'direct', handoff_version: 2 })
    );

    const result = await upsertCandidateExposure(INPUT);

    expect(result).toMatchObject({ outcome: 'updated', change_record_emitted: true });
    expect(enqueuedRows()[0].payload.record_version).toBe(3);
    const data = fake.candidateExposure.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ validation_status: 'CANDIDATE', validation_ref: null, cleared_at: null, cleared_reason: null });
  });

  it('scopes the compare-and-set write to the row organization', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(existingRow({ id: 'ce-20', organization_id: ORG }));

    await upsertCandidateExposure(INPUT);

    expect(fake.candidateExposure.updateMany.mock.calls[0][0].where.organization_id).toBe(ORG);
  });

  it('leaves an exposure already in the pipeline untouched', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(existingRow({ id: 'ce-4', validation_status: 'VALIDATED' }));

    const result = await upsertCandidateExposure(INPUT);

    expect(result.outcome).toBe('unchanged');
    expect(fake.candidateExposure.updateMany).not.toHaveBeenCalled();
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('retries once against the winning row when a concurrent create wins the unique key', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    fake.candidateExposure.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingRow({ id: 'ce-8', validation_status: 'CANDIDATE' }));
    fake.candidateExposure.create.mockRejectedValueOnce(p2002);

    const result = await upsertCandidateExposure(INPUT);

    expect(result).toMatchObject({ candidate_exposure_id: 'ce-8', outcome: 'unchanged' });
    expect(fake.$transaction).toHaveBeenCalledTimes(2);
  });

  it('writes only if handoff_version and status are unchanged since the read', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(existingRow({ id: 'ce-13', organization_id: ORG, handoff_version: 4 }));

    await upsertCandidateExposure(INPUT);

    expect(fake.candidateExposure.updateMany.mock.calls[0][0].where).toEqual({
      id: 'ce-13',
      organization_id: ORG,
      handoff_version: 4,
      validation_status: 'WATCHING',
    });
  });

  it('retries when a concurrent promotion changed the row first', async () => {
    fake.candidateExposure.findUnique
      .mockResolvedValueOnce(existingRow({ id: 'ce-14', handoff_version: 0 }))
      .mockResolvedValueOnce(existingRow({ id: 'ce-14', validation_status: 'CANDIDATE', handoff_version: 1 }));
    fake.candidateExposure.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await upsertCandidateExposure(INPUT);

    // Second attempt sees the winner's CANDIDATE v1 row and leaves it alone.
    expect(result.outcome).toBe('unchanged');
    expect(fake.$transaction).toHaveBeenCalledTimes(2);
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('gives up after repeated conflicts', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(existingRow({ id: 'ce-15' }));
    fake.candidateExposure.updateMany.mockResolvedValue({ count: 0 });

    await expect(upsertCandidateExposure(INPUT)).rejects.toThrow('changed concurrently');
    expect(fake.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(null);
    fake.candidateExposure.create.mockRejectedValue(new Error('connection lost'));

    await expect(upsertCandidateExposure(INPUT)).rejects.toThrow('connection lost');
    expect(fake.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('mergeEvaluations', () => {
  const base: CandidateEvaluation = {
    exposure_pathways: [{ pathway: 'entity', match_basis: 'named supplier', confidence: 0.8 }],
    exposure_strength: 'probable',
    exposed_assets: [{ asset_type: 'supplier', asset_id: 's-1', distance_or_match_basis: 'named' }],
    match_confidence: {},
    rationale: 'Supplier is named in the event.',
    exposure_priority: 'medium',
  };

  it('returns null for no evaluations', () => {
    expect(mergeEvaluations([])).toBeNull();
  });

  it('keeps the strongest exposure and unions assets and pathways from all items', () => {
    const merged = mergeEvaluations([
      base,
      {
        ...base,
        exposure_strength: 'direct',
        exposure_priority: 'high',
        exposure_pathways: [{ pathway: 'geographic_site', match_basis: 'plant in zone', confidence: 0.9 }],
        exposed_assets: [
          { asset_type: 'facility', asset_id: 'f-1', distance_or_match_basis: '3km' },
          { asset_type: 'supplier', asset_id: ' S-1 ', distance_or_match_basis: 'dup' },
        ],
        rationale: 'Plant is inside the zone.',
      },
    ]);
    expect(merged?.exposure_strength).toBe('direct');
    expect(merged?.exposure_priority).toBe('high');
    expect(merged?.exposed_assets.map((a) => a.asset_id)).toEqual(['s-1', 'f-1']);
    expect(merged?.exposure_pathways.map((p) => p.pathway)).toEqual(['entity', 'geographic_site']);
    expect(merged?.rationale).toBe('Supplier is named in the event. Plant is inside the zone.');
  });
});

