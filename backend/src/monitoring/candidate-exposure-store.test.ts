/**
 * Candidate exposure store — Validation hand-off (issue #76).
 * Mocked Prisma client; no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => {
  const client = {
    candidateExposure: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    messageQueue: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));

import { upsertCandidateExposure, statusForStrength } from './candidate-exposure-store.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const INPUT = {
  organization_id: ORG,
  global_event_id: '22222222-2222-2222-2222-222222222222',
  global_event_hash: 'hash-1',
  exposure_pathways: [{ pathway: 'geographic_site', match_basis: 'plant 12km', confidence: 0.9 }],
  exposure_strength: 'direct' as const,
  exposed_assets: [],
  match_confidence: { location: 0.9 },
  rationale: 'Plant is inside the affected area.',
  exposure_priority: 'high',
};

/** Change records written to the queue in this test. */
const enqueuedRecords = (): Array<Record<string, unknown>> =>
  fake.messageQueue.createMany.mock.calls.map(
    (call) => (call[0] as { data: Array<{ payload: Record<string, unknown> }> }).data[0].payload
  );

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

describe('upsertCandidateExposure', () => {
  it('rejects a missing organization_id', async () => {
    await expect(upsertCandidateExposure({ ...INPUT, organization_id: '' })).rejects.toThrow(
      'organization_id required'
    );
  });

  it('creates a CANDIDATE and emits candidate_exposure v1 in the same transaction', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(null);
    fake.candidateExposure.create.mockResolvedValue({ id: 'ce-1', validation_status: 'CANDIDATE' });

    const result = await upsertCandidateExposure(INPUT);

    expect(result).toEqual({
      candidate_exposure_id: 'ce-1',
      validation_status: 'CANDIDATE',
      outcome: 'created',
      change_record_emitted: true,
    });
    expect(fake.$transaction).toHaveBeenCalled();
    const [record] = enqueuedRecords();
    expect(record).toMatchObject({
      record_id: 'ce-1',
      record_version: 1,
      record_type: 'candidate_exposure',
      organization_id: ORG,
      payload: { global_event_id: INPUT.global_event_id, has_valid_verification: false },
    });
    expect(fake.messageQueue.createMany.mock.calls[0][0].data[0].idempotency_key).toBe('ce-1:1');
  });

  it('creates a WATCHING row for a possible exposure without emitting', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue(null);
    fake.candidateExposure.create.mockResolvedValue({ id: 'ce-2', validation_status: 'WATCHING' });

    const result = await upsertCandidateExposure({ ...INPUT, exposure_strength: 'possible' });

    expect(result.change_record_emitted).toBe(false);
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('emits a new record version when a WATCHING exposure is promoted', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue({ id: 'ce-3', validation_status: 'WATCHING' });
    fake.candidateExposure.update.mockResolvedValue({ id: 'ce-3', validation_status: 'CANDIDATE' });

    const result = await upsertCandidateExposure(INPUT);

    expect(result.outcome).toBe('updated');
    expect(result.change_record_emitted).toBe(true);
    const [record] = enqueuedRecords();
    expect(record.record_id).toBe('ce-3');
    expect(record.record_version).toBeGreaterThan(1);
  });

  it('leaves an exposure already in the pipeline untouched', async () => {
    fake.candidateExposure.findUnique.mockResolvedValue({ id: 'ce-4', validation_status: 'VALIDATED' });

    const result = await upsertCandidateExposure(INPUT);

    expect(result.outcome).toBe('unchanged');
    expect(fake.candidateExposure.update).not.toHaveBeenCalled();
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });
});
