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
import { severityRank } from '../../monitoring/exposure-strength.js';
import {
  CandidateEvaluationSchema,
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

  const globalEvent = await prisma.globalEvent.findUnique({ where: { id: globalEventId } });
  if (!globalEvent) {
    logger.warn({ global_event_id: globalEventId }, '[ClientMonitoring] Global event not found');
    return;
  }

  // Customer organizations with monitoring on (root org excluded).
  const organizations = await prisma.organization.findMany({
    where: {
      ...(targetOrgId ? { id: targetOrgId } : {}),
      is_root: false,
      settings: { monitoring_agent_enabled: true },
    },
    select: { id: true },
  });

  if (targetOrgId === undefined) {
    await enqueueOrgEvaluations(
      record,
      globalEventId,
      organizations.map((o) => o.id)
    );
    logger.info(
      { global_event_id: globalEventId, change_type: payload.change_type, orgs: organizations.length },
      '[ClientMonitoring] Fanned out org-scoped evaluations'
    );
    return;
  }

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

/** The balanced {...} span starting at `start`, skipping braces inside strings. */
function balancedObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function asObject(candidate: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(candidate);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Extract the agent's JSON object: a fenced ```json block if present,
 * otherwise the first balanced {...} span that parses to an object (so braces
 * in surrounding prose do not break it). Throws if none is found.
 */
export function parseAgentJson(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const value = asObject(fenced[1].trim());
    if (value) return value;
  }
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const span = balancedObjectAt(text, start);
    const value = span ? asObject(span) : null;
    if (value) return value;
  }
  throw new Error('[ClientMonitoring] Agent response contained no parseable JSON object');
}

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
  await enqueueManyIdempotent(getPrismaClient(), CHANGE_RECORD_QUEUE, items);
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
  if (['RESOLVED', 'RETRACTED', 'MERGED'].includes(globalEvent.status)) {
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
  const parseItems = (raw: unknown, forcePossible: boolean): CandidateEvaluation[] => {
    if (!Array.isArray(raw)) return [];
    const out: CandidateEvaluation[] = [];
    for (const item of raw as unknown[]) {
      // Watch-list items are watch-only by definition; the model cannot upgrade them here.
      const input = forcePossible && item && typeof item === 'object' ? { ...item, exposure_strength: 'possible' } : item;
      const parsed = CandidateEvaluationSchema.safeParse(input);
      if (parsed.success) {
        out.push(parsed.data);
      } else {
        logger.warn(
          { organization_id: organizationId, global_event_id: globalEvent.id, issues: parsed.error.issues },
          '[ClientMonitoring] Skipping exposure item that failed schema validation'
        );
      }
    }
    return out;
  };

  const candidates = parseItems(parsedResult.candidate_exposures, false);
  const evaluations = candidates.length > 0 ? candidates : parseItems(parsedResult.watch_list, true);

  const merged = mergeEvaluations(evaluations);
  if (merged) {
    // Anything thrown here is infrastructure (DB, queue) and propagates so the
    // org is retried; the upsert and the hand-off are idempotent.
    const result = await createCandidateExposure(organizationId, globalEvent, merged, profile.profile_version);
    if (result.outcome !== 'unchanged') exposuresWritten++;
    if (result.change_record_emitted) handoffsEmitted++;
  }

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
