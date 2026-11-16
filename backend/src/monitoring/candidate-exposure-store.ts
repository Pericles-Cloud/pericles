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

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getPrismaClient } from './db-client.js';
import { enqueueInTransaction, CHANGE_RECORD_QUEUE } from './queue-client.js';
import { changeRecordKey, type ChangeRecord } from '../workflow/records/change-record.js';

/**
 * The exposure evaluation an agent produces (Client Monitoring spec §8).
 * Shared by candidateExposureTool's inputSchema and the dispatch consumer, which
 * parses untrusted LLM output with it.
 */
export const CandidateEvaluationSchema = z.object({
  exposure_pathways: z.array(
    z.object({
      pathway: z.enum([
        'geographic_site',
        'geographic_flow',
        'entity',
        'product',
        'regulatory',
        'indirect',
        'strategic',
      ]),
      match_basis: z.string(),
      confidence: z.number().min(0).max(1),
    })
  ),
  exposure_strength: z.enum(['direct', 'probable', 'possible', 'strategic']),
  exposed_assets: z.array(
    z.object({
      asset_type: z.enum(['facility', 'supplier', 'shipment', 'sku', 'carrier', 'lane', 'customer']),
      asset_id: z.string(),
      asset_name: z.string().optional(),
      distance_or_match_basis: z.string(),
    })
  ),
  // LLM output: confidence may be omitted, and dates arrive in mixed formats
  // (date-only, with offsets). Dropping a real exposure over formatting is the
  // worse error at this layer (Client spec §5), so these are lenient.
  match_confidence: z
    .object({
      entity: z.number().min(0).max(1).optional(),
      location: z.number().min(0).max(1).optional(),
      product: z.number().min(0).max(1).optional(),
    })
    .default({}),
  temporal_relevance: z
    .object({
      shipment_eta: z.string().nullable().optional(),
      event_window: z.string().nullable().optional(),
      regulation_effective_date: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  strategic_context: z
    .array(z.object({ doc_ref: z.string(), initiative: z.string() }))
    .nullable()
    .optional(),
  rationale: z.string().min(10).describe('2-4 plain sentences explaining why'),
  exposure_priority: z.enum(['critical', 'high', 'medium', 'low']),
});

export type CandidateEvaluation = z.infer<typeof CandidateEvaluationSchema>;
export type ExposureStrength = CandidateEvaluation['exposure_strength'];

export interface CandidateExposureInput extends CandidateEvaluation {
  organization_id: string;
  global_event_id: string;
  global_event_hash: string;
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

/** Single ordering of exposure strength, weakest first. Shared with the pathway evaluator. */
export const STRENGTH_RANK: Record<ExposureStrength, number> = { possible: 1, strategic: 2, probable: 3, direct: 4 };

/** Stable key for an exposed-asset set, independent of order. */
function assetSetKey(assets: unknown): string {
  if (!Array.isArray(assets)) return '';
  return assets
    .map((a) => {
      const asset = a as { asset_type?: unknown; asset_id?: unknown };
      return `${String(asset.asset_type)}:${String(asset.asset_id)}`;
    })
    .sort()
    .join('|');
}

/**
 * A Validation rejection stands unless the new evaluation brings new evidence:
 * a stronger exposure, or a different set of exposed assets. Otherwise every
 * event update would re-send the same rejected exposure.
 */
function hasNewEvidence(
  existing: { exposure_strength: string; exposed_assets: unknown },
  input: CandidateExposureInput
): boolean {
  const before = STRENGTH_RANK[existing.exposure_strength as ExposureStrength] ?? 0;
  if (STRENGTH_RANK[input.exposure_strength] > before) return true;
  return assetSetKey(existing.exposed_assets) !== assetSetKey(input.exposed_assets);
}

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
/** On update, an absent value must clear the column, not leave it unchanged. */
const toNullableJson = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);

/** Build the change record that routes a candidate to event_verification + exposure_validation. */
export function buildCandidateExposureRecord(
  candidateExposureId: string,
  handoffVersion: number,
  input: Pick<
    CandidateExposureInput,
    'organization_id' | 'global_event_id' | 'global_event_hash' | 'exposure_strength' | 'exposure_priority'
  >,
  producedAt: Date
): ChangeRecord {
  return {
    record_id: candidateExposureId,
    record_version: handoffVersion,
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

/** Enqueue the record; returns false if an identical record was already queued. */
async function emitRecord(tx: Prisma.TransactionClient, record: ChangeRecord): Promise<boolean> {
  const { deduplicated } = await enqueueInTransaction(
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
  return !deduplicated;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

async function upsertOnce(input: CandidateExposureInput): Promise<UpsertCandidateExposureResult> {
  const prisma = getPrismaClient();
  const status = statusForStrength(input.exposure_strength);
  const now = new Date();

  const fields = {
    exposure_pathways: toJson(input.exposure_pathways),
    exposure_strength: input.exposure_strength,
    exposed_assets: toJson(input.exposed_assets),
    match_confidence: toJson(input.match_confidence),
    temporal_relevance: toNullableJson(input.temporal_relevance),
    strategic_context: toNullableJson(input.strategic_context),
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
      const emit = status === 'CANDIDATE';
      const created = await tx.candidateExposure.create({
        data: {
          organization_id: input.organization_id,
          global_event_id: input.global_event_id,
          global_event_hash: input.global_event_hash,
          ...fields,
          handoff_version: emit ? 1 : 0,
        },
      });
      const emitted = emit ? await emitRecord(tx, buildCandidateExposureRecord(created.id, 1, input, now)) : false;
      return {
        candidate_exposure_id: created.id,
        validation_status: created.validation_status,
        outcome: 'created',
        change_record_emitted: emitted,
      };
    }

    const refreshable =
      existing.validation_status === 'WATCHING' ||
      (existing.validation_status === 'REJECTED' && hasNewEvidence(existing, input));

    // A CANDIDATE that was never handed off (created before the hand-off
    // existed, or by migrate-events-to-global) gets its first record now, so no
    // CANDIDATE row is left without one. If one was already queued under v1
    // the insert is a no-op.
    if (existing.validation_status === 'CANDIDATE' && existing.handoff_version === 0) {
      await tx.candidateExposure.update({ where: { id: existing.id }, data: { handoff_version: 1 } });
      const emitted = await emitRecord(tx, buildCandidateExposureRecord(existing.id, 1, input, now));
      return {
        candidate_exposure_id: existing.id,
        validation_status: existing.validation_status,
        outcome: 'unchanged',
        change_record_emitted: emitted,
      };
    }

    if (!refreshable) {
      return {
        candidate_exposure_id: existing.id,
        validation_status: existing.validation_status,
        outcome: 'unchanged',
        change_record_emitted: false,
      };
    }

    // A promotion to CANDIDATE is a new hand-off with the next small version.
    const emit = status === 'CANDIDATE';
    const handoffVersion = emit ? existing.handoff_version + 1 : existing.handoff_version;

    const updated = await tx.candidateExposure.update({
      where: { id: existing.id },
      data: { ...fields, global_event_id: input.global_event_id, handoff_version: handoffVersion, updated_at: now },
    });

    const emitted = emit
      ? await emitRecord(tx, buildCandidateExposureRecord(updated.id, handoffVersion, input, now))
      : false;
    return {
      candidate_exposure_id: updated.id,
      validation_status: updated.validation_status,
      outcome: 'updated',
      change_record_emitted: emitted,
    };
  });
}

/**
 * Create or refresh the candidate exposure for (organization, global event).
 *
 * - No row: create it. If it is a CANDIDATE, emit hand-off version 1.
 * - WATCHING row: refresh it with the new evaluation; a promotion to
 *   CANDIDATE emits the next hand-off version.
 * - REJECTED row: refresh and re-send only with new evidence (stronger
 *   exposure or a different asset set). Otherwise the rejection stands.
 * - Any other status: the exposure is already in the pipeline; leave it.
 *
 * Two concurrent evaluations can race on the unique (org, event_hash) key; the
 * loser's transaction rolls back and is retried once against the winner's row.
 */
export async function upsertCandidateExposure(
  input: CandidateExposureInput
): Promise<UpsertCandidateExposureResult> {
  if (!input.organization_id) {
    throw new Error('organization_id required for tenant isolation');
  }

  try {
    return await upsertOnce(input);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return upsertOnce(input);
  }
}
