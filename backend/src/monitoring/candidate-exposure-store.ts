/**
 * Candidate Exposure store (Doctrine §13, issue #76).
 *
 * The single write path for CandidateExposure rows. Only the client_monitoring
 * consumer calls it, with the organization it is evaluating. There is
 * deliberately no agent tool for this write: model-written arguments must not
 * choose the tenant.
 *
 * The row write and the `candidate_exposure` change record are committed in one
 * transaction: a record is never emitted for a row that was rolled back, and a
 * CANDIDATE row is never left without its record.
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getPrismaClient } from './db-client.js';
import { logger } from './logger.js';
import { enqueueInTransaction, CHANGE_RECORD_QUEUE } from './queue-client.js';
import { changeRecordQueueItem, type ChangeRecord } from '../workflow/records/change-record.js';
import { SEVERITY_RANK, STRENGTH_RANK, statusForStrength, type ExposureStrength } from './exposure-strength.js';
import { isUniqueViolation } from './prisma-errors.js';

export { STRENGTH_RANK, statusForStrength, type ExposureStrength };

/**
 * The exposure evaluation an agent produces (Client Monitoring spec §8).
 * The dispatch consumer parses untrusted LLM output with it.
 */
const PathwaySchema = z.object({
  pathway: z.enum(['geographic_site', 'geographic_flow', 'entity', 'product', 'regulatory', 'indirect', 'strategic']),
  match_basis: z.string().default(''),
  confidence: z.number().min(0).max(1).catch(0.5),
});

const AssetSchema = z.object({
  asset_type: z.enum(['facility', 'supplier', 'shipment', 'sku', 'carrier', 'lane', 'customer']),
  asset_id: z.string().min(1),
  asset_name: z.string().optional(),
  distance_or_match_basis: z.string().default(''),
});

/**
 * Keep the valid items of an LLM-written array and drop the malformed ones, so
 * one bad asset or pathway does not discard a real exposure (the worse error at
 * this layer, Client spec §5).
 */
function validItems<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value.filter((entry) => item.safeParse(entry).success) : value;
  }, z.array(item));
}

export const CandidateEvaluationSchema = z.object({
  exposure_pathways: validItems(PathwaySchema),
  exposure_strength: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z.enum(['direct', 'probable', 'possible', 'strategic'])
  ),
  exposed_assets: validItems(AssetSchema),
  // LLM output: confidence may be omitted, and dates arrive in mixed formats
  // (date-only, with offsets). These are lenient for the same reason.
  match_confidence: z
    .object({
      entity: z.number().min(0).max(1).optional(),
      location: z.number().min(0).max(1).optional(),
      product: z.number().min(0).max(1).optional(),
    })
    .catch({})
    .default({}),
  temporal_relevance: z
    .object({
      shipment_eta: z.string().nullable().optional(),
      event_window: z.string().nullable().optional(),
      regulation_effective_date: z.string().nullable().optional(),
    })
    .nullable()
    .optional()
    .catch(null),
  strategic_context: validItems(z.object({ doc_ref: z.string(), initiative: z.string() }))
    .nullable()
    .optional()
    .catch(null),
  // Required by the spec, but a missing rationale must not drop a real exposure.
  rationale: z.string().default('').describe('2-4 plain sentences explaining why'),
  exposure_priority: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
      z.enum(['critical', 'high', 'medium', 'low'])
    )
    .catch('medium'),
});

export type CandidateEvaluation = z.infer<typeof CandidateEvaluationSchema>;


/**
 * Merge every evaluation of one event for one org into the single exposure row
 * that (org, event) allows: strongest strength and highest priority win;
 * pathways, assets and strategic context are unioned. Returns null if empty.
 */
export function mergeEvaluations(evaluations: CandidateEvaluation[]): CandidateEvaluation | null {
  if (evaluations.length === 0) return null;
  const strongest = evaluations.reduce((a, b) =>
    STRENGTH_RANK[b.exposure_strength] > STRENGTH_RANK[a.exposure_strength] ? b : a
  );
  const uniqueBy = <T>(items: T[], key: (item: T) => string): T[] => {
    const seen = new Map<string, T>();
    for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
    return [...seen.values()];
  };
  const strategic = evaluations.flatMap((e) => e.strategic_context ?? []);
  return {
    ...strongest,
    exposure_pathways: uniqueBy(
      evaluations.flatMap((e) => e.exposure_pathways),
      (p) => `${p.pathway}|${p.match_basis}`
    ),
    exposed_assets: uniqueBy(
      evaluations.flatMap((e) => e.exposed_assets),
      (a) => `${a.asset_type}:${a.asset_id.trim().toLowerCase()}`
    ),
    exposure_priority: evaluations.reduce((a, b) =>
      SEVERITY_RANK[b.exposure_priority] > SEVERITY_RANK[a.exposure_priority] ? b : a
    ).exposure_priority,
    strategic_context: strategic.length > 0 ? uniqueBy(strategic, (c) => `${c.doc_ref}|${c.initiative}`) : null,
    temporal_relevance: strongest.temporal_relevance ?? evaluations.find((e) => e.temporal_relevance)?.temporal_relevance,
    rationale: [...new Set(evaluations.map((e) => e.rationale.trim()))].join(' '),
  };
}

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


/** Normalized asset keys. Asset ids are LLM-written, so compare loosely. */
function assetKeys(assets: unknown): Set<string> {
  if (!Array.isArray(assets)) return new Set();
  return new Set(
    assets.map((a) => {
      const asset = a as { asset_type?: unknown; asset_id?: unknown };
      return `${String(asset.asset_type).trim().toLowerCase()}:${String(asset.asset_id).trim().toLowerCase()}`;
    })
  );
}

/**
 * A Validation rejection stands unless the new evaluation brings new evidence:
 * a stronger exposure, or every previously named asset plus at least one more.
 * A different spelling of the same assets is not a strict superset, so model
 * run-to-run variation cannot reopen a rejection on its own.
 */
function hasNewEvidence(
  existing: { exposure_strength: string; exposed_assets: unknown },
  input: CandidateExposureInput
): boolean {
  const before = STRENGTH_RANK[existing.exposure_strength as ExposureStrength] ?? 0;
  if (STRENGTH_RANK[input.exposure_strength] > before) return true;
  const previous = assetKeys(existing.exposed_assets);
  const next = assetKeys(input.exposed_assets);
  if (next.size <= previous.size) return false;
  for (const key of previous) if (!next.has(key)) return false;
  return true;
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
  const { message, idempotencyKey } = changeRecordQueueItem(record);
  const { deduplicated } = await enqueueInTransaction(tx, CHANGE_RECORD_QUEUE, message, { idempotencyKey });
  return !deduplicated;
}


/** handoff_version the migration sets on pre-existing CANDIDATE rows. */
export const LEGACY_PENDING = -1;
/** Hand-off version used for those rows: above any v1 the old tool emitted. */
const LEGACY_HANDOFF_VERSION = 2;

/** Another evaluation changed the row between our read and our write. */
class ConcurrentUpdateError extends Error {
  constructor() {
    super('candidate exposure changed concurrently');
    this.name = 'ConcurrentUpdateError';
  }
}

/** Write only if the row is still in the state we read (compare-and-set). */
async function updateIfUnchanged(
  tx: Prisma.TransactionClient,
  existing: { id: string; handoff_version: number; validation_status: string },
  data: Prisma.CandidateExposureUpdateManyMutationInput
): Promise<void> {
  const { count } = await tx.candidateExposure.updateMany({
    where: {
      id: existing.id,
      handoff_version: existing.handoff_version,
      validation_status: existing.validation_status as Prisma.EnumExposureValidationStatusFilter['equals'],
    },
    data,
  });
  if (count === 0) throw new ConcurrentUpdateError();
}

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

    // A CANDIDATE row from before hand-offs were versioned is marked
    // LEGACY_PENDING by the migration: we cannot tell whether it was ever handed
    // off (the old tool emitted v1, the old consumer emitted nothing). Hand it
    // off now as v2, which can never collide with an old v1 record.
    if (existing.validation_status === 'CANDIDATE' && existing.handoff_version === LEGACY_PENDING) {
      await updateIfUnchanged(tx, existing, { handoff_version: LEGACY_HANDOFF_VERSION });
      // Hand off what is stored, not this evaluation, so the record and the row agree.
      const stored = {
        organization_id: existing.organization_id,
        global_event_id: existing.global_event_id,
        global_event_hash: existing.global_event_hash,
        exposure_strength: existing.exposure_strength as ExposureStrength,
        exposure_priority: existing.exposure_priority as CandidateEvaluation['exposure_priority'],
      };
      const emitted = await emitRecord(
        tx,
        buildCandidateExposureRecord(existing.id, LEGACY_HANDOFF_VERSION, stored, now)
      );
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

    // Two concurrent promotions would otherwise both write version n+1 and the
    // second record would dedupe while its content overwrote the row.
    await updateIfUnchanged(tx, existing, {
      ...fields,
      global_event_id: input.global_event_id,
      handoff_version: handoffVersion,
      // A reopened rejection is undecided again; drop the pointer to the old verdict.
      ...(existing.validation_status === 'REJECTED' ? { validation_ref: null } : {}),
      updated_at: now,
    });

    const emitted = emit
      ? await emitRecord(tx, buildCandidateExposureRecord(existing.id, handoffVersion, input, now))
      : false;
    if (emit && !emitted) {
      // A promotion always uses a new version, so a duplicate means the version
      // history is wrong (e.g. a row from before hand-off versioning). Make it loud.
      logger.error(
        { candidate_exposure_id: existing.id, handoff_version: handoffVersion },
        '[CandidateExposure] Hand-off record already existed for a new version; Validation was not notified'
      );
    }
    return {
      candidate_exposure_id: existing.id,
      validation_status: status,
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
 * Two concurrent evaluations can race: on create (unique (org, event_hash)
 * key) or on update (compare-and-set on handoff_version and status). The
 * loser's transaction rolls back and is retried against the winner's row.
 */
export async function upsertCandidateExposure(
  input: CandidateExposureInput
): Promise<UpsertCandidateExposureResult> {
  if (!input.organization_id) {
    throw new Error('organization_id required for tenant isolation');
  }

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await upsertOnce(input);
    } catch (error) {
      const raced = isUniqueViolation(error) || error instanceof ConcurrentUpdateError;
      if (!raced || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}
