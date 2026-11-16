/**
 * Client Monitoring Consumer (Doctrine §13)
 *
 * Dispatch consumer that handles global_event_change records.
 * For each global event change, evaluates exposure for ALL organizations
 * and creates CandidateExposure records where relevant.
 *
 * This consumer is registered in the dispatch table for:
 * - global_event_change → client_monitoring
 *
 * Global events have organization_id: null, so this consumer fans out
 * to all customer organizations.
 */

import { changeRecordQueueItem, type ChangeRecord } from '../records/change-record.js';
import { orgReevaluationRecord } from '../records/global-event-change.js';
import { enqueueManyIdempotent, CHANGE_RECORD_QUEUE } from '../../monitoring/queue-client.js';
import type { ConsumerHandler } from '../dispatch/consumer-registry.js';
import { getPrismaClient } from '../../monitoring/db-client.js';
import { mastra } from '../../mastra/index.js';
import { logger } from '../../monitoring/logger.js';
import { severityRank, TERMINAL_EVENT_STATUSES } from '../../monitoring/exposure-strength.js';
import {
  CandidateEvaluationSchema,
  clearWatchingExposure,
  mergeEvaluations,
  upsertCandidateExposure,
  type CandidateEvaluation,
  type UpsertCandidateExposureResult,
} from '../../monitoring/candidate-exposure-store.js';

/**
 * Handle a global_event_change record.
 *
 * Two shapes:
 * - A global record (no target): the fan-out. It enqueues one org-scoped
 *   record per monitoring-enabled organization and evaluates none inline, so
 *   each org's LLM evaluation gets its own stage budget, lease and retries.
 * - An org-scoped record (target_organization_id = organization_id): evaluate
 *   that one org. A failure throws, so the queue retries it with backoff.
 */
export const clientMonitoringConsumer: ConsumerHandler = async ({ record, signal }) => {
  const prisma = getPrismaClient();

  const payload = record.payload as {
    event_id?: string;
    global_event_id?: string;
    change_type?: string;
    /** Set on org-scoped records: evaluate only this org. */
    target_organization_id?: string;
  };

  const globalEventId = payload.event_id ?? payload.global_event_id;

  if (!globalEventId) {
    logger.warn({ record_id: record.record_id }, '[ClientMonitoring] Record missing global_event_id');
    return;
  }

  // Tenant isolation: if the key is present at all, it must be a string equal
  // to the record's own scope. A null or malformed target must not fall back
  // to fanning out across every tenant.
  const hasTarget = Object.prototype.hasOwnProperty.call(payload, 'target_organization_id');
  const targetOrgId = hasTarget ? payload.target_organization_id : undefined;
  if (hasTarget && (typeof targetOrgId !== 'string' || targetOrgId !== record.organization_id)) {
    logger.warn(
      { record_id: record.record_id, record_org: record.organization_id, target_org: targetOrgId },
      '[ClientMonitoring] target_organization_id does not match record scope; ignoring record'
    );
    return;
  }

  if (targetOrgId === undefined) {
    // Only a global record may fan out across tenants. An org-scoped record
    // without a target is malformed, not a request to evaluate every tenant.
    if (record.organization_id !== null) {
      logger.warn(
        { record_id: record.record_id, record_org: record.organization_id },
        '[ClientMonitoring] Org-scoped record without target_organization_id; ignoring record'
      );
      return;
    }
    // Fan-out: needs only the event's id and status.
    const event = await prisma.globalEvent.findUnique({
      where: { id: globalEventId },
      select: { id: true, status: true },
    });
    if (!event) {
      logger.warn({ global_event_id: globalEventId }, '[ClientMonitoring] Global event not found');
      return;
    }
    const orgIds = await fanOutOrgIds(event.id, isTerminal(event.status));
    await enqueueOrgEvaluations(record, globalEventId, orgIds);
    logger.info(
      { global_event_id: globalEventId, change_type: payload.change_type, orgs: orgIds.length },
      '[ClientMonitoring] Fanned out org-scoped evaluations'
    );
    return;
  }

  const globalEvent = await prisma.globalEvent.findUnique({ where: { id: globalEventId } });
  if (!globalEvent) {
    logger.warn({ global_event_id: globalEventId }, '[ClientMonitoring] Global event not found');
    return;
  }

  // A terminal event only clears exposures, which must happen even for an org
  // that has since turned monitoring off. Anything else needs an eligible org.
  const organizations = isTerminal(globalEvent.status)
    ? [{ id: targetOrgId }]
    : await prisma.organization.findMany({
        where: { id: targetOrgId, is_root: false, settings: { monitoring_agent_enabled: true } },
        select: { id: true },
      });

  if (organizations.length === 0) {
    logger.info(
      { organization_id: targetOrgId, global_event_id: globalEventId },
      '[ClientMonitoring] Target org not eligible for monitoring; skipping'
    );
    return;
  }

  const result = await evaluateExposureForOrg(targetOrgId, globalEvent, signal);
  logger.info(
    {
      organization_id: targetOrgId,
      global_event_id: globalEventId,
      exposures_written: result.exposuresWritten,
      handoffs_emitted: result.handoffsEmitted,
      exposures_cleared: result.cleared,
    },
    '[ClientMonitoring] Evaluated org exposure'
  );
};


/** Top-level keys of the agent's response format; at least one must be present. */
const RESULT_KEYS = ['candidate_exposures', 'watch_list', 'not_exposed'] as const;

/**
 * Parse `candidate` as the agent's result object. A fragment such as one
 * nested pathway (from a truncated response) parses as JSON but has none of
 * the result keys, so it is rejected rather than read as "no exposure".
 */
function asObject(candidate: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(candidate);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const object = value as Record<string, unknown>;
    return RESULT_KEYS.some((key) => key in object) ? object : null;
  } catch {
    return null;
  }
}

/**
 * Extract the agent's result object: a fenced ```json block if present,
 * otherwise the first balanced {...} span that parses to an object with the
 * result keys (so braces in prose, or a fragment of a truncated response, do
 * not pass). Throws if none is found, so the org is retried.
 */
export function parseAgentJson(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const value = asObject(fenced[1].trim());
    if (value) return value;
  }
  // One linear pass: a stack of open-brace positions, braces inside strings
  // ignored. Each closed span is tried only if it names a result key, so a
  // long or truncated response is scanned once, not once per '{'.
  const opens: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') opens.push(i);
    else if (ch === '}' && opens.length > 0) {
      const start = opens.pop()!;
      const span = text.slice(start, i + 1);
      if (RESULT_KEYS.some((key) => span.includes(`"${key}"`))) {
        const value = asObject(span);
        if (value) return value;
      }
    }
  }
  throw new Error('[ClientMonitoring] Agent response contained no parseable JSON object');
}

const isTerminal = (status: string): boolean => TERMINAL_EVENT_STATUSES.has(status);

/**
 * Orgs to evaluate for an event.
 * - Terminal event: only orgs with an open exposure on it (the only work is
 *   clearing), including orgs that have since turned monitoring off.
 * - Otherwise: monitoring-enabled customer orgs that have a Client Exposure
 *   Profile (an org without one would exit without evaluating).
 *
 * These are the platform fan-out's tenant-listing queries, a documented
 * exception to the organization_id rule (.claude/adr/0002): they return org ids
 * only, run only for a global record, and every listed org is then processed
 * in its own org-scoped record, filtered by its organization_id.
 */
async function fanOutOrgIds(globalEventId: string, terminal: boolean): Promise<string[]> {
  const prisma = getPrismaClient();
  if (terminal) {
    const open = await prisma.candidateExposure.findMany({
      where: { global_event_id: globalEventId, validation_status: { not: 'CLEARED' } },
      select: { organization_id: true },
      distinct: ['organization_id'],
    });
    return open.map((row) => row.organization_id);
  }
  const eligible = await prisma.organization.findMany({
    where: {
      is_root: false,
      settings: { monitoring_agent_enabled: true },
      clientExposureProfile: { isNot: null },
    },
    select: { id: true },
  });
  return eligible.map((o) => o.id);
}

/** Rows per INSERT: stays far below Postgres's 65,535 bind-parameter limit. */
const FANOUT_INSERT_CHUNK = 1000;

/**
 * Enqueue one org-scoped evaluation per organization. Keyed by (source record,
 * org) and the source version, so a redelivery of the source record does not
 * enqueue duplicates.
 */
async function enqueueOrgEvaluations(source: ChangeRecord, globalEventId: string, orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  const producedAt = new Date().toISOString();
  const items = orgIds.map((orgId) =>
    changeRecordQueueItem(
      orgReevaluationRecord({
        recordId: `${source.record_id}:org:${orgId}`,
        recordVersion: source.record_version,
        globalEventId,
        organizationId: orgId,
        reason: 'org_fanout',
        producedAt,
      })
    )
  );
  for (let i = 0; i < items.length; i += FANOUT_INSERT_CHUNK) {
    await enqueueManyIdempotent(getPrismaClient(), CHANGE_RECORD_QUEUE, items.slice(i, i + FANOUT_INSERT_CHUNK));
  }
}

interface ExposureResult {
  /** Exposure rows created or changed (including promotions and reopens). */
  exposuresWritten: number;
  /** candidate_exposure records handed to Validation. */
  handoffsEmitted: number;
  cleared: number;
}

/**
 * Evaluate exposure for a single organization against a global event
 */
async function evaluateExposureForOrg(
  organizationId: string,
  globalEvent: any,
  signal: AbortSignal
): Promise<ExposureResult> {
  const prisma = getPrismaClient();
  let exposuresWritten = 0;
  let handoffsEmitted = 0;
  let cleared = 0;

  // Check if event is in a terminal state
  if (isTerminal(globalEvent.status)) {
    // Clear any existing exposures for this event
    cleared = await clearExposuresForResolvedEvent(
      organizationId,
      globalEvent.id,
      globalEvent.status
    );
    return { exposuresWritten, handoffsEmitted, cleared };
  }

  // Load Client Exposure Profile
  const profile = await prisma.clientExposureProfile.findUnique({
    where: { organization_id: organizationId },
  });

  if (!profile) {
    logger.debug(
      { organization_id: organizationId },
      '[ClientMonitoring] No Client Exposure Profile found - skipping'
    );
    return { exposuresWritten, handoffsEmitted, cleared };
  }

  // Check admin filters
  const excludedCategories = profile.excluded_categories ?? [];
  if (excludedCategories.includes(globalEvent.category)) {
    logger.debug(
      { organization_id: organizationId, category: globalEvent.category },
      '[ClientMonitoring] Event category excluded by admin config'
    );
    return { exposuresWritten, handoffsEmitted, cleared };
  }

  // Check excluded regions
  const excludedRegions = profile.excluded_regions ?? [];
  if (globalEvent.country_iso && excludedRegions.includes(globalEvent.country_iso)) {
    logger.debug(
      { organization_id: organizationId, region: globalEvent.country_iso },
      '[ClientMonitoring] Event region excluded by admin config'
    );
    return { exposuresWritten, handoffsEmitted, cleared };
  }

  // Check minimum severity
  const minSeverityConfig = profile.min_severity as Record<string, string> | null;
  if (minSeverityConfig) {
    const minSeverity = minSeverityConfig[globalEvent.category] ?? 'low';
    const eventSeverityValue = severityRank(globalEvent.intrinsic_severity);
    const minSeverityValue = severityRank(minSeverity);

    if (eventSeverityValue < minSeverityValue) {
      logger.debug(
        { organization_id: organizationId, severity: globalEvent.intrinsic_severity, minSeverity },
        '[ClientMonitoring] Event severity below minimum threshold'
      );
      return { exposuresWritten, handoffsEmitted, cleared };
    }
  }

  // Get the Client Monitoring Agent
  const agent = mastra.getAgent('clientMonitoringAgent');

  if (!agent) {
    throw new Error('Client Monitoring Agent not found in Mastra registry');
  }

  // Build the prompt for the agent
  const prompt = buildClientMonitoringPrompt(globalEvent, profile, organizationId);

  // Execute the agent
  const response = await agent.generate(prompt, {
    abortSignal: signal,
  });

  // Parse the response. An unreadable response is a failed evaluation, not
  // "no exposure": throw so this org gets a retry record instead of being
  // counted as evaluated with a real exposure silently dropped.
  const parsedResult = parseAgentJson(response.text || '');

  // Process exposures. One exposure row exists per (org, event), so items are
  // merged into one. Watch-list (possible) items are stored too, so they can be
  // promoted later (Client spec §5), but they are only used when the agent
  // found no candidate: their assets must not pad a real candidate.
  let unreadable = 0;
  const parseItems = (raw: unknown, forcePossible: boolean): CandidateEvaluation[] => {
    if (!Array.isArray(raw)) return [];
    const out: CandidateEvaluation[] = [];
    for (const item of raw as unknown[]) {
      // An item naming a different event belongs to that event's row, never this one.
      const itemEventId =
        item && typeof item === 'object' ? (item as { global_event_id?: unknown }).global_event_id : undefined;
      if (typeof itemEventId === 'string' && itemEventId !== globalEvent.id) {
        logger.warn(
          { organization_id: organizationId, global_event_id: globalEvent.id, item_event_id: itemEventId },
          '[ClientMonitoring] Skipping exposure item for a different event'
        );
        continue;
      }
      // Watch-list items are watch-only by definition; the model cannot upgrade them here.
      const input = forcePossible && item && typeof item === 'object' ? { ...item, exposure_strength: 'possible' } : item;
      const parsed = CandidateEvaluationSchema.safeParse(input);
      if (parsed.success) {
        out.push(parsed.data);
      } else {
        unreadable++;
        logger.warn(
          { organization_id: organizationId, global_event_id: globalEvent.id, issues: parsed.error.issues },
          '[ClientMonitoring] Skipping exposure item that failed schema validation'
        );
      }
    }
    return out;
  };

  const candidates = parseItems(parsedResult.candidate_exposures, false);
  // Candidates were listed but none could be read: a failed evaluation. Do
  // not fall back to the watch list, which would downgrade a real candidate.
  if (candidates.length === 0 && unreadable > 0) {
    throw new Error(`[ClientMonitoring] All ${unreadable} candidate exposure(s) in the agent response were unreadable`);
  }
  const evaluations = candidates.length > 0 ? candidates : parseItems(parsedResult.watch_list, true);

  // Items were listed but none could be read: that is a failed evaluation,
  // not "no exposure" (which would clear a watched item). Throw to retry.
  if (evaluations.length === 0 && unreadable > 0) {
    throw new Error(`[ClientMonitoring] All ${unreadable} exposure item(s) in the agent response were unreadable`);
  }

  const merged = mergeEvaluations(evaluations);
  if (!merged) {
    // No exposure found: a watched (or never handed-off) item is cleared (spec §5).
    if (await clearWatchingExposure(organizationId, globalEvent.event_hash)) cleared++;
    return { exposuresWritten, handoffsEmitted, cleared };
  }

  // Anything thrown here is infrastructure (DB, queue) and propagates so the
  // org is retried; the upsert and the hand-off are idempotent.
  const result = await createCandidateExposure(organizationId, globalEvent, merged, profile.profile_version);
  if (result.outcome === 'created' || result.outcome === 'updated') exposuresWritten++;
  if (result.change_record_emitted) handoffsEmitted++;

  return { exposuresWritten, handoffsEmitted, cleared };
}

/**
 * Build the prompt for the Client Monitoring Agent
 */
function buildClientMonitoringPrompt(
  globalEvent: any,
  profile: any,
  organizationId: string
): string {
  return `Evaluate exposure for organization ${organizationId}.

## Global Event
- ID: ${globalEvent.id}
- Headline: ${globalEvent.headline}
- Category: ${globalEvent.category}
- Subcategory: ${globalEvent.subcategory || 'N/A'}
- Status: ${globalEvent.status}
- Intrinsic Severity: ${globalEvent.intrinsic_severity}
- Confidence: ${globalEvent.confidence}

### Location
- Latitude: ${globalEvent.latitude ?? 'N/A'}
- Longitude: ${globalEvent.longitude ?? 'N/A'}
- Country: ${globalEvent.country_iso ?? 'N/A'}
- Region: ${globalEvent.admin1_region ?? 'N/A'}
- Named Infrastructure: ${JSON.stringify(globalEvent.named_infrastructure || [])}
- Affected Area: ${JSON.stringify(globalEvent.affected_area || {})}

### Affected Dimensions
${JSON.stringify(globalEvent.affected_dimensions || {}, null, 2)}

### Event Statement
${globalEvent.event_statement || 'N/A'}

## Client Exposure Profile (version ${profile.profile_version})

### Own Facilities
${JSON.stringify(profile.own_facilities || [], null, 2)}

### Suppliers
${JSON.stringify(profile.suppliers || [], null, 2)}

### Products
${JSON.stringify(profile.products || [], null, 2)}

### Logistics
${JSON.stringify(profile.logistics || {}, null, 2)}

### Shipments in Transit
${JSON.stringify(profile.shipments_in_transit || [], null, 2)}

### Strategic Priorities
${JSON.stringify(profile.strategic_priorities || [], null, 2)}

### Admin Configuration
- Excluded Categories: ${JSON.stringify(profile.excluded_categories || [])}
- Excluded Regions: ${JSON.stringify(profile.excluded_regions || [])}
- Buffer Distances: ${JSON.stringify(profile.buffer_distances || {})}
- Min Severity: ${JSON.stringify(profile.min_severity || {})}

## Task
Evaluate all 7 exposure pathways against this event. Return JSON with:
- candidate_exposures: array of exposures to send to Validation
- watch_list: array of Possible exposures to monitor
- not_exposed: array of events with no pathway match
- metrics: evaluation summary`;
}

/**
 * Create or refresh the (org, event) CandidateExposure; the store hands it to
 * Validation when it becomes a CANDIDATE. Returns the store's result.
 */
async function createCandidateExposure(
  organizationId: string,
  globalEvent: { id: string; event_hash: string },
  evaluation: CandidateEvaluation,
  profileVersion: number
): Promise<UpsertCandidateExposureResult> {
  const strength = evaluation.exposure_strength;

  const result = await upsertCandidateExposure({
    ...evaluation,
    organization_id: organizationId,
    global_event_id: globalEvent.id,
    global_event_hash: globalEvent.event_hash,
    profile_snapshot_ref: `v${profileVersion}`,
  });

  logger.info(
    {
      organization_id: organizationId,
      global_event_id: globalEvent.id,
      exposure_strength: strength,
      validation_status: result.validation_status,
      outcome: result.outcome,
      change_record_emitted: result.change_record_emitted,
    },
    '[ClientMonitoring] Upserted candidate exposure'
  );

  return result;
}

/**
 * Clear exposures when a global event is resolved/retracted/merged
 * Returns the number of exposures cleared
 */
async function clearExposuresForResolvedEvent(
  organizationId: string,
  globalEventId: string,
  newStatus: string
): Promise<number> {
  const prisma = getPrismaClient();

  const clearedReason = newStatus === 'RESOLVED'
    ? 'event_resolved'
    : newStatus === 'RETRACTED'
      ? 'event_retracted'
      : 'event_merged';

  const result = await prisma.candidateExposure.updateMany({
    where: {
      organization_id: organizationId,
      global_event_id: globalEventId,
      validation_status: {
        notIn: ['CLEARED'],
      },
    },
    data: {
      validation_status: 'CLEARED',
      cleared_at: new Date(),
      cleared_reason: clearedReason,
      updated_at: new Date(),
    },
  });

  if (result.count > 0) {
    logger.info(
      {
        organization_id: organizationId,
        global_event_id: globalEventId,
        cleared_count: result.count,
        reason: clearedReason,
      },
      '[ClientMonitoring] Cleared exposures for resolved event'
    );
  }

  return result.count;
}
