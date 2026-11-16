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
} from '../../monitoring/candidate-exposure-store.js';

/**
 * Handle a global_event_change record.
 *
 * Flow:
 * 1. Load the Global Event
 * 2. Fetch all customer organizations
 * 3. For each org:
 *    a. Load Client Exposure Profile
 *    b. Apply admin filters
 *    c. Evaluate all 7 exposure pathways
 *    d. Create CandidateExposure if relevant
 */
export const clientMonitoringConsumer: ConsumerHandler = async ({ record, signal }) => {
  const prisma = getPrismaClient();

  const payload = record.payload as {
    event_id?: string;
    global_event_id?: string;
    change_type?: string;
    /** Set on org-scoped retry records: evaluate only this org, not every tenant. */
    target_organization_id?: string;
  };

  const globalEventId = payload.event_id ?? payload.global_event_id;

  if (!globalEventId) {
    logger.warn({ record_id: record.record_id }, '[ClientMonitoring] Record missing global_event_id');
    return;
  }

  // An org-scoped retry record targets a single org; a real global event change fans out to all.
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

  logger.info(
    { global_event_id: globalEventId, change_type: payload.change_type },
    '[ClientMonitoring] Processing global event change'
  );

  try {
    // Load the Global Event
    const globalEvent = await prisma.globalEvent.findUnique({
      where: { id: globalEventId },
    });

    if (!globalEvent) {
      logger.warn({ global_event_id: globalEventId }, '[ClientMonitoring] Global event not found');
      return;
    }

    // Fetch customer organizations (exclude root org). An org-scoped record
    // targets a single org; a real global event change fans out to all.
    const organizations = await prisma.organization.findMany({
      where: {
        ...(targetOrgId ? { id: targetOrgId } : {}),
        is_root: false,
        settings: {
          monitoring_agent_enabled: true,
        },
      },
      select: { id: true, name: true },
    });

    logger.info(
      { global_event_id: globalEventId, org_count: organizations.length },
      '[ClientMonitoring] Fanning out to organizations'
    );

    // Process each organization
    let totalCandidatesCreated = 0;
    let totalCleared = 0;
    const pendingOrgIds: string[] = [];

    for (const [index, org] of organizations.entries()) {
      if (signal.aborted) {
        logger.warn({ global_event_id: globalEventId }, '[ClientMonitoring] Aborted during fan-out');
        pendingOrgIds.push(...organizations.slice(index).map((o) => o.id));
        break;
      }

      try {
        const result = await evaluateExposureForOrg(org.id, globalEvent, signal);
        totalCandidatesCreated += result.candidatesCreated;
        totalCleared += result.cleared;
      } catch (error) {
        logger.error(
          { error, organization_id: org.id, global_event_id: globalEventId },
          '[ClientMonitoring] Failed to evaluate exposure for org'
        );
        pendingOrgIds.push(org.id);
      }
    }

    logger.info(
      {
        global_event_id: globalEventId,
        orgs_processed: organizations.length - pendingOrgIds.length,
        orgs_pending_retry: pendingOrgIds.length,
        candidates_created: totalCandidatesCreated,
        exposures_cleared: totalCleared,
      },
      '[ClientMonitoring] Completed global event fan-out'
    );

    if (pendingOrgIds.length > 0) {
      // A single-org record has nothing to split off: fail the stage so the
      // dispatcher retries it with backoff.
      if (targetOrgId) {
        throw new Error(`[ClientMonitoring] Exposure evaluation for ${targetOrgId} did not complete`);
      }
      // Fan-out: hand each failed or not-reached org its own org-scoped record
      // instead of failing the whole stage, so a retry re-runs only those orgs
      // (each with its own attempts and backoff), not every org that succeeded.
      await enqueueOrgRetries(record, globalEventId, pendingOrgIds);
    }
  } catch (error) {
    logger.error(
      { error, global_event_id: globalEventId },
      '[ClientMonitoring] Failed to process global event change'
    );
    throw error;
  }
};

/**
 * Enqueue one org-scoped re-evaluation per org whose evaluation did not
 * complete. Keyed by (source record, org) and the source version, so a
 * redelivery of the source record does not enqueue duplicates.
 */
async function enqueueOrgRetries(source: ChangeRecord, globalEventId: string, orgIds: string[]): Promise<void> {
  const producedAt = new Date().toISOString();
  const items = orgIds.map((orgId) =>
    changeRecordQueueItem(
      orgReevaluationRecord({
        recordId: `${source.record_id}:org:${orgId}`,
        recordVersion: source.record_version,
        globalEventId,
        organizationId: orgId,
        reason: 'org_retry',
        producedAt,
      })
    )
  );
  await enqueueManyIdempotent(getPrismaClient(), CHANGE_RECORD_QUEUE, items);
  logger.warn(
    { source_record_id: source.record_id, global_event_id: globalEventId, orgs: orgIds.length },
    '[ClientMonitoring] Enqueued org-scoped retries for incomplete evaluations'
  );
}

interface ExposureResult {
  candidatesCreated: number;
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
  let candidatesCreated = 0;
  let cleared = 0;

  // Check if event is in a terminal state
  if (['RESOLVED', 'RETRACTED', 'MERGED'].includes(globalEvent.status)) {
    // Clear any existing exposures for this event
    cleared = await clearExposuresForResolvedEvent(
      organizationId,
      globalEvent.id,
      globalEvent.status
    );
    return { candidatesCreated, cleared };
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
    return { candidatesCreated, cleared };
  }

  // Check admin filters
  const excludedCategories = profile.excluded_categories ?? [];
  if (excludedCategories.includes(globalEvent.category)) {
    logger.debug(
      { organization_id: organizationId, category: globalEvent.category },
      '[ClientMonitoring] Event category excluded by admin config'
    );
    return { candidatesCreated, cleared };
  }

  // Check excluded regions
  const excludedRegions = profile.excluded_regions ?? [];
  if (globalEvent.country_iso && excludedRegions.includes(globalEvent.country_iso)) {
    logger.debug(
      { organization_id: organizationId, region: globalEvent.country_iso },
      '[ClientMonitoring] Event region excluded by admin config'
    );
    return { candidatesCreated, cleared };
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
      return { candidatesCreated, cleared };
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

  // Parse the response
  const result = response.text || '';
  let parsedResult: any = {};

  try {
    const jsonMatch = /\{[\s\S]*\}/.exec(result);
    if (jsonMatch) {
      parsedResult = JSON.parse(jsonMatch[0]);
    }
  } catch (parseError) {
    logger.warn(
      { error: parseError, organization_id: organizationId },
      '[ClientMonitoring] Failed to parse agent response as JSON'
    );
    return { candidatesCreated, cleared };
  }

  // Process candidate exposures. Watch-list (possible) items are stored too,
  // so they can be promoted later (Client spec §5). One exposure row exists
  // per (org, event), so every item for this event is merged into one.
  const items: unknown[] = [
    ...(Array.isArray(parsedResult.candidate_exposures) ? parsedResult.candidate_exposures : []),
    ...(Array.isArray(parsedResult.watch_list) ? parsedResult.watch_list : []).map((item: unknown) =>
      // Watch-list items are watch-only by definition; the model cannot upgrade them here.
      item && typeof item === 'object' ? { ...item, exposure_strength: 'possible' } : item
    ),
  ];

  const evaluations: CandidateEvaluation[] = [];
  for (const item of items) {
    const parsed = CandidateEvaluationSchema.safeParse(item);
    if (parsed.success) {
      evaluations.push(parsed.data);
    } else {
      logger.warn(
        { organization_id: organizationId, global_event_id: globalEvent.id, issues: parsed.error.issues },
        '[ClientMonitoring] Skipping exposure item that failed schema validation'
      );
    }
  }

  const merged = mergeEvaluations(evaluations);
  if (merged) {
    // Anything thrown here is infrastructure (DB, queue) and propagates so the
    // org is retried; the upsert and the hand-off are idempotent.
    const created = await createCandidateExposure(organizationId, globalEvent, merged, profile.profile_version);
    if (created) candidatesCreated++;
  }

  return { candidatesCreated, cleared };
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
 * Create or refresh a CandidateExposure and hand it to Validation.
 * Returns true if a new record was created.
 */
async function createCandidateExposure(
  organizationId: string,
  globalEvent: { id: string; event_hash: string },
  evaluation: CandidateEvaluation,
  profileVersion: number
): Promise<boolean> {
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

  return result.outcome === 'created';
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
