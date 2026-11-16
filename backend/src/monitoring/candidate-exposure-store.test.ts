/**
 * Candidate exposure store — Validation hand-off (issue #76).
 * Mocked Prisma client; no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const fake = vi.hoisted(() => ({
  candidateExposure: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  messageQueue: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));

import {
  upsertCandidateExposure,
  statusForStrength,
  CandidateEvaluationSchema,
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
  fake.candidateExposure.update.mockReset();
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
  it('rejects an invalid exposure_priority from the agent', () => {
    const { organization_id: _o, global_event_id: _g, global_event_hash: _h, ...evaluation } = INPUT;
    expect(CandidateEvaluationSchema.safeParse(evaluation).success).toBe(true);
    expect(CandidateEvaluationSchema.safeParse({ ...evaluation, exposure_priority: 'urgent' }).success).toBe(false);
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
    fake.candidateExposure.update.mockResolvedValue({ id: 'ce-3', validation_status: 'CANDIDATE' });

    const result = await upsertCandidateExposure(INPUT);

    expect(result.outcome).toBe('updated');
    expect(result.change_record_emitted).toBe(true);
    const [row] = enqueuedRows();
    expect(row.payload.record_version).toBe(3);
    expect(row.payload.record_version as number).toBeLessThanOrEqual(INT32_MAX);
    expect(fake.candidateExposure.update.mock.calls[0][0].data.handoff_version).toBe(3);
  });

  it('clears temporal_relevance and strategic_context on refresh when the new evaluation has none', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(existingRow({ id: 'ce-5' }));
    fake.candidateExposure.update.mockResolvedValue({ id: 'ce-5', validation_status: 'CANDIDATE' });

    await upsertCandidateExposure(INPUT);

    const data = fake.candidateExposure.update.mock.calls[0][0].data;
    expect(data.temporal_relevance).toBe(Prisma.DbNull);
    expect(data.strategic_context).toBe(Prisma.DbNull);
  });

  it('leaves a REJECTED exposure alone when the evaluation brings no new evidence', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-6', validation_status: 'REJECTED', exposure_strength: 'direct', handoff_version: 1 })
    );

    const result = await upsertCandidateExposure(INPUT);

    expect(result.outcome).toBe('unchanged');
    expect(fake.candidateExposure.update).not.toHaveBeenCalled();
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('re-sends a REJECTED exposure when a new asset is exposed', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(
      existingRow({ id: 'ce-7', validation_status: 'REJECTED', exposure_strength: 'direct', handoff_version: 1 })
    );
    fake.candidateExposure.update.mockResolvedValue({ id: 'ce-7', validation_status: 'CANDIDATE' });

    const result = await upsertCandidateExposure({
      ...INPUT,
      exposed_assets: [
        ...INPUT.exposed_assets,
        { asset_type: 'shipment', asset_id: 's-9', distance_or_match_basis: 'via port' },
      ],
    });

    expect(result.change_record_emitted).toBe(true);
    expect(enqueuedRows()[0].payload.record_version).toBe(2);
  });

  it('leaves an exposure already in the pipeline untouched', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(existingRow({ id: 'ce-4', validation_status: 'VALIDATED' }));

    const result = await upsertCandidateExposure(INPUT);

    expect(result.outcome).toBe('unchanged');
    expect(fake.candidateExposure.update).not.toHaveBeenCalled();
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

  it('does not retry other errors', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(null);
    fake.candidateExposure.create.mockRejectedValue(new Error('connection lost'));

    await expect(upsertCandidateExposure(INPUT)).rejects.toThrow('connection lost');
    expect(fake.$transaction).toHaveBeenCalledTimes(1);
  });
});
