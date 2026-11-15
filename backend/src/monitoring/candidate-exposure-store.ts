/**
 * Candidate Exposure store (Doctrine §13, issue #76).
 *
 * The single write path for CandidateExposure rows. Both the Client Monitoring
 * consumer and candidateExposureTool go through here, so the hand-off to the
 * Validation Agent cannot be skipped by one of them.
 *
 * The row write and the `candidate_exposure` change record are committed in one
 * transaction: a record is never emitted for a row that was rolled back, and a
 * CANDIDATE row is never left without its record.
 */

import type { Prisma } from '@prisma/client';
import { getPrismaClient } from './db-client.js';
import { enqueueInTransaction, CHANGE_RECORD_QUEUE } from './queue-client.js';
import { changeRecordKey, type ChangeRecord } from '../workflow/records/change-record.js';

export type ExposureStrength = 'direct' | 'probable' | 'possible' | 'strategic';

export interface CandidateExposureInput {
  organization_id: string;
  global_event_id: string;
  global_event_hash: string;
  exposure_pathways: unknown;
  exposure_strength: ExposureStrength;
  exposed_assets: unknown;
  match_confidence: unknown;
  temporal_relevance?: unknown;
  strategic_context?: unknown;
  rationale: string;
  exposure_priority: string;
  profile_snapshot_ref?: string | null;
}

export type UpsertOutcome = 'created' | 'updated' | 'unchanged';

export interface UpsertCandidateExposureResult {
  candidate_exposure_id: string;
  validation_status: string;
  outcome: UpsertOutcome;
  change_record_emitted: boolean;
}

/** Possible exposures go on the watch list; everything else goes to Validation. */
export function statusForStrength(strength: ExposureStrength): 'WATCHING' | 'CANDIDATE' {
  return strength === 'possible' ? 'WATCHING' : 'CANDIDATE';
}

const asJson = (value: unknown): Prisma.InputJsonValue => (value ?? []) as Prisma.InputJsonValue;
const asNullableJson = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === null || value === undefined ? undefined : (value as Prisma.InputJsonValue);

/** Build the change record that routes a candidate to event_verification + exposure_validation. */
export function buildCandidateExposureRecord(
  candidateExposureId: string,
  recordVersion: number,
  input: Pick<
    CandidateExposureInput,
    'organization_id' | 'global_event_id' | 'global_event_hash' | 'exposure_strength' | 'exposure_priority'
  >,
  producedAt: Date
): ChangeRecord {
  return {
    record_id: candidateExposureId,
    record_version: recordVersion,
    record_type: 'candidate_exposure',
    organization_id: input.organization_id,
    produced_at: producedAt.toISOString(),
    payload: {
      global_event_id: input.global_event_id,
      global_event_hash: input.global_event_hash,
      exposure_strength: input.exposure_strength,
      exposure_priority: input.exposure_priority,
      has_valid_verification: false,
    },
  };
}

async function emitRecord(tx: Prisma.TransactionClient, record: ChangeRecord): Promise<void> {
  await enqueueInTransaction(
    tx,
    CHANGE_RECORD_QUEUE,
    {
      type: 'change_record',
      payload: record,
      timestamp: record.produced_at,
      organizationId: record.organization_id,
    },
    { idempotencyKey: changeRecordKey(record) }
  );
}

/**
 * Create or refresh the candidate exposure for (organization, global event).
 *
 * - No row: create it. If it is a CANDIDATE, emit record version 1.
 * - WATCHING or REJECTED row: refresh it with the new evaluation. If that
 *   promotes it to CANDIDATE, emit a new record version so Validation sees it.
 * - Any other status: the exposure is already in the pipeline; leave it.
 */
export async function upsertCandidateExposure(
  input: CandidateExposureInput
): Promise<UpsertCandidateExposureResult> {
  if (!input.organization_id) {
    throw new Error('organization_id required for tenant isolation');
  }

  const prisma = getPrismaClient();
  const status = statusForStrength(input.exposure_strength);
  const now = new Date();

  const fields = {
    exposure_pathways: asJson(input.exposure_pathways),
    exposure_strength: input.exposure_strength,
    exposed_assets: asJson(input.exposed_assets),
    match_confidence: asJson(input.match_confidence ?? {}),
    temporal_relevance: asNullableJson(input.temporal_relevance),
    strategic_context: asNullableJson(input.strategic_context),
    rationale: input.rationale,
    exposure_priority: input.exposure_priority,
    profile_snapshot_ref: input.profile_snapshot_ref ?? null,
    validation_status: status,
  };

  return prisma.$transaction(async (tx) => {
    const existing = await tx.candidateExposure.findUnique({
      where: {
        organization_id_global_event_hash: {
          organization_id: input.organization_id,
          global_event_hash: input.global_event_hash,
        },
      },
    });

    if (!existing) {
      const created = await tx.candidateExposure.create({
        data: {
          organization_id: input.organization_id,
          global_event_id: input.global_event_id,
          global_event_hash: input.global_event_hash,
          ...fields,
        },
      });
      const emit = status === 'CANDIDATE';
      if (emit) {
        await emitRecord(tx, buildCandidateExposureRecord(created.id, 1, input, now));
      }
      return {
        candidate_exposure_id: created.id,
        validation_status: created.validation_status,
        outcome: 'created',
        change_record_emitted: emit,
      };
    }

    if (existing.validation_status !== 'WATCHING' && existing.validation_status !== 'REJECTED') {
      return {
        candidate_exposure_id: existing.id,
        validation_status: existing.validation_status,
        outcome: 'unchanged',
        change_record_emitted: false,
      };
    }

    const updated = await tx.candidateExposure.update({
      where: { id: existing.id },
      data: { ...fields, global_event_id: input.global_event_id, updated_at: now },
    });

    // A promotion to CANDIDATE is a new hand-off; version by time so the
    // idempotency key differs from any earlier hand-off for this row.
    const emit = status === 'CANDIDATE';
    if (emit) {
      await emitRecord(tx, buildCandidateExposureRecord(updated.id, now.getTime(), input, now));
    }
    return {
      candidate_exposure_id: updated.id,
      validation_status: updated.validation_status,
      outcome: 'updated',
      change_record_emitted: emit,
    };
  });
}
