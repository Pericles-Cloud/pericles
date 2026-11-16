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
import {
  SEVERITY_RANK,
  STRENGTH_RANK,
  TERMINAL_EVENT_STATUSES,
  statusForStrength,
  type ExposureStrength,
} from './exposure-strength.js';
import { isUniqueViolation } from './prisma-errors.js';

export { STRENGTH_RANK, statusForStrength, type ExposureStrength };

/**
 * The exposure evaluation an agent produces (Client Monitoring spec §8).
 * The dispatch consumer parses untrusted LLM output with it.
 */
const PathwaySchema = z.object({
  pathway: z.enum(['geographic_site', 'geographic_flow', 'entity', 'product', 'regulatory', 'indirect', 'strategic']),
  match_basis: z.string().nullish().transform((value) => value ?? ''),
  confidence: z.number().min(0).max(1).catch(0.5),
});

const AssetSchema = z.object({
  asset_type: z.enum(['facility', 'supplier', 'shipment', 'sku', 'carrier', 'lane', 'customer']),
  asset_id: z.string().min(1),
  asset_name: z.string().nullish(),
  distance_or_match_basis: z.string().nullish().transform((value) => value ?? ''),
});

/**
 * Keep the valid items of an LLM-written array and drop the malformed ones, so
 * one bad asset or pathway does not discard a real exposure (the worse error at
 * this layer, Client spec §5).
 */
function validItems<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value) => {
    // Anything that is not an array (missing, null, an object) is no items.
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => item.safeParse(entry).success);
  }, z.array(item));
}

export const CandidateEvaluationSchema = z.object({
  exposure_pathways: validItems(PathwaySchema),
  // Accept the strength only when it is the first word ("Direct exposure" ->
  // direct). Anything else, including negated or hedged wording ("not direct",
  // "indirect", "improbable"), falls back to possible: kept on the watch list
  // and re-evaluated, never sent to Validation on a guess.
  exposure_strength: z.preprocess((value) => {
    if (typeof value !== 'string') return 'possible';
    const words = value.trim().toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const named = words.filter((w): w is ExposureStrength =>
      (['direct', 'probable', 'possible', 'strategic'] as const).includes(w as ExposureStrength)
    );
    // Exactly one strength, and it leads. "direct|probable|possible|strategic"
    // (the prompt template echoed back) names several, so it is ambiguous.
    return named.length === 1 && words[0] === named[0] ? named[0] : 'possible';
  }, z.enum(['direct', 'probable', 'possible', 'strategic'])),
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
  rationale: z
    .string()
    .nullish()
    .transform((value) => value ?? '')
    .describe('2-4 plain sentences explaining why'),
  exposure_priority: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
      z.enum(['critical', 'high', 'medium', 'low'])
    )
    .catch('medium'),
});

export type CandidateEvaluation = z.infer<typeof CandidateEvaluationSchema>;


/**
 * Merge the evaluations of one event for one org into the single exposure row
 * that (org, event) allows. Items at the strongest tier are merged (highest
 * priority wins; pathways, assets and strategic context are unioned); weaker
 * items are dropped. Returns null if empty.
 */
export function mergeEvaluations(all: CandidateEvaluation[]): CandidateEvaluation | null {
  if (all.length === 0) return null;
  // Only items at the strongest tier are merged: a weaker item's assets and
  // rationale must not pad a stronger exposure.
  const topRank = Math.max(...all.map((e) => STRENGTH_RANK[e.exposure_strength]));
  const evaluations = all.filter((e) => STRENGTH_RANK[e.exposure_strength] === topRank);
  const strongest = evaluations[0];
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

export type UpsertOutcome = 'created' | 'updated' | 'unchanged' | 'event_ended';

export interface UpsertCandidateExposureResult {
  candidate_exposure_id: string;
  validation_status: string;
  outcome: UpsertOutcome;
  change_record_emitted: boolean;
}


/**
 * A Validation rejection stands unless the exposure is now *stronger* (Client
 * spec §5: promote "if the link becomes stronger"). Asset lists are
 * model-written and vary run to run, so they are not evidence on their own.
 */
function isStronger(existing: { exposure_strength: string }, input: CandidateExposureInput): boolean {
  const before = STRENGTH_RANK[existing.exposure_strength as ExposureStrength] ?? 0;
  return STRENGTH_RANK[input.exposure_strength] > before;
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

/** The next hand-off version: never 0 or below, never colliding with a legacy v1. */
function nextHandoffVersion(current: number): number {
  return current <= 0 ? LEGACY_HANDOFF_VERSION : current + 1;
}


/** Clear reasons meaning the event itself ended; a stale evaluation must not reopen these. */
const EVENT_ENDED_REASONS = new Set(['event_resolved', 'event_retracted', 'event_merged']);

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
  existing: { id: string; organization_id: string; handoff_version: number; validation_status: string },
  data: Prisma.CandidateExposureUpdateManyMutationInput
): Promise<void> {
  const { count } = await tx.candidateExposure.updateMany({
    where: {
      id: existing.id,
      organization_id: existing.organization_id,
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
    // Lock the event row (FOR SHARE) and check it has not ended. A resolution's
    // status UPDATE waits for this transaction, so its fan-out then sees and
    // clears anything written here; and an evaluation that started before the
    // event ended writes nothing once it has.
    const [event] = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM "GlobalEvent" WHERE id = ${input.global_event_id} FOR SHARE
    `;
    if (!event || TERMINAL_EVENT_STATUSES.has(event.status)) {
      return { candidate_exposure_id: '', validation_status: 'NONE', outcome: 'event_ended', change_record_emitted: false };
    }

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

    // WATCHING is always re-evaluated. CLEARED for an asset reason (shipment
    // delivered, supplier removed) can renew: a new evaluation that still finds
    // an exposure is a new one on the same (org, event) row. CLEARED because the
    // event ended stays cleared, so an evaluation that started before the event
    // resolved cannot reopen it. REJECTED reopens only
    // if stronger. VALIDATED (and an in-flight CANDIDATE) stay as they are.
    // A CANDIDATE never handed off (handoff_version <= 0: written before
    // hand-off versioning, or by migrate-events-to-global) takes the fresh
    // evaluation like a WATCHING row, so it is handed off (or demoted) on what
    // the agent says now, not on stale stored fields.
    const neverHandedOff = existing.validation_status === 'CANDIDATE' && existing.handoff_version <= 0;
    const refreshable =
      neverHandedOff ||
      existing.validation_status === 'WATCHING' ||
      (existing.validation_status === 'CLEARED' && !EVENT_ENDED_REASONS.has(existing.cleared_reason ?? '')) ||
      (existing.validation_status === 'REJECTED' && isStronger(existing, input));

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
    const handoffVersion = emit ? nextHandoffVersion(existing.handoff_version) : existing.handoff_version;

    // Two concurrent promotions would otherwise both write version n+1 and the
    // second record would dedupe while its content overwrote the row.
    await updateIfUnchanged(tx, existing, {
      ...fields,
      global_event_id: input.global_event_id,
      handoff_version: handoffVersion,
      // A reopened rejection or a renewed cleared exposure is undecided again:
      // drop the pointer to the old verdict and the old end state.
      ...(existing.validation_status === 'REJECTED' || existing.validation_status === 'CLEARED'
        ? { validation_ref: null, cleared_at: null, cleared_reason: null }
        : {}),
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
 * - CLEARED row: a new exposure on the same (org, event); refresh it and hand
 *   it off with the next version if it is a CANDIDATE.
 * - REJECTED row: refresh and re-send only if the exposure is stronger than
 *   when it was rejected. Otherwise the rejection stands.
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

/**
 * Re-send the *stranded* CANDIDATEs of one organization to Validation, each
 * with a fresh hand-off version. Stranded means: never handed off (legacy,
 * handoff_version <= 0), or its current version's exposure_validation stage
 * was logged skipped_noop. Idempotent: once a re-sent version is dispatched to
 * a registered consumer it is no longer stranded, so a second call sends
 * nothing.
 *
 * Until the Validation consumers (event_verification, exposure_validation;
 * GitHub #78) are registered, the dispatcher records candidate_exposure stages
 * as skipped_noop, which is final for that record version. #78 calls this per
 * organization once its consumers are registered, so those exposures, and
 * LEGACY_PENDING rows whose event never changes again, are not stranded.
 *
 * Each row is bumped with the same compare-and-set as a promotion, so a row an
 * evaluation changes concurrently is skipped here rather than double-sent.
 * Returns the number of records enqueued.
 */
export async function reemitCandidateHandoffs(
  organizationId: string,
  options: { pageSize?: number } = {}
): Promise<number> {
  if (!organizationId) {
    throw new Error('organization_id required for tenant isolation');
  }
  const prisma = getPrismaClient();
  const pageSize = options.pageSize ?? 200;
  let cursor: string | undefined;
  let emitted = 0;

  for (;;) {
    const rows = await prisma.candidateExposure.findMany({
      where: { organization_id: organizationId, validation_status: 'CANDIDATE' },
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    const skipped = await prisma.dispatchLog.findMany({
      where: {
        organization_id: organizationId,
        consumer: 'exposure_validation',
        status: 'skipped_noop',
        record_id: { in: rows.map((r) => r.id) },
      },
      select: { record_id: true, record_version: true },
    });
    const skippedKeys = new Set(skipped.map((d) => `${d.record_id}:${d.record_version}`));
    const stranded = rows.filter((r) => r.handoff_version <= 0 || skippedKeys.has(`${r.id}:${r.handoff_version}`));

    for (const row of stranded) {
      const next = nextHandoffVersion(row.handoff_version);
      try {
        const sent = await prisma.$transaction(async (tx) => {
          await updateIfUnchanged(tx, row, { handoff_version: next });
          return emitRecord(
            tx,
            buildCandidateExposureRecord(
              row.id,
              next,
              {
                organization_id: row.organization_id,
                global_event_id: row.global_event_id,
                global_event_hash: row.global_event_hash,
                exposure_strength: row.exposure_strength as ExposureStrength,
                exposure_priority: row.exposure_priority as CandidateEvaluation['exposure_priority'],
              },
              new Date()
            )
          );
        });
        if (sent) emitted++;
      } catch (error) {
        if (!(error instanceof ConcurrentUpdateError)) throw error;
        // Changed by a concurrent evaluation, which handles its own hand-off.
      }
    }

    if (rows.length < pageSize) break;
    cursor = rows[rows.length - 1].id;
  }

  logger.info({ organization_id: organizationId, emitted }, '[CandidateExposure] Re-emitted candidate hand-offs');
  return emitted;
}

/**
 * The agent found no exposure for (org, event): clear a WATCHING row, which
 * would otherwise keep stale assets and could be promoted by a later partial
 * evaluation (Client spec §5: "No pathway: record not_exposed"). A CANDIDATE
 * that was never handed off (handoff_version <= 0) is cleared the same way:
 * Validation has not seen it, so the latest evaluation decides. A handed-off
 * CANDIDATE is with Validation, which decides it.
 * Returns true if a row was cleared.
 */
export async function clearWatchingExposure(organizationId: string, globalEventHash: string): Promise<boolean> {
  if (!organizationId) {
    throw new Error('organization_id required for tenant isolation');
  }
  const { count } = await getPrismaClient().candidateExposure.updateMany({
    where: {
      organization_id: organizationId,
      global_event_hash: globalEventHash,
      OR: [{ validation_status: 'WATCHING' }, { validation_status: 'CANDIDATE', handoff_version: { lte: 0 } }],
    },
    data: { validation_status: 'CLEARED', cleared_at: new Date(), cleared_reason: 'not_exposed' },
  });
  return count > 0;
}

