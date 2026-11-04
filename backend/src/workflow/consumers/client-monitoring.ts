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

import type { ChangeRecord } from '../records/change-record.js';
import type { ConsumerHandler } from '../dispatch/consumer-registry.js';
import { getPrismaClient } from '../../monitoring/db-client.js';
import { mastra } from '../../mastra/index.js';
import { logger } from '../../monitoring/logger.js';

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
  };

  const globalEventId = payload.event_id ?? payload.global_event_id;

  if (!globalEventId) {
    logger.warn({ record_id: record.record_id }, '[ClientMonitoring] Record missing global_event_id');
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

    // Fetch all customer organizations (exclude root org)
    const organizations = await prisma.organization.findMany({
      where: {
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

    for (const org of organizations) {
      if (signal.aborted) {
        logger.warn({ global_event_id: globalEventId }, '[ClientMonitoring] Aborted during fan-out');
        break;
      }

      try {
        const result = await evaluateExposureForOrg(
          org.id,
          globalEvent,
          signal
        );

        totalCandidatesCreated += result.candidatesCreated;
        totalCleared += result.cleared;
      } catch (error) {
        logger.error(
          { error, organization_id: org.id, global_event_id: globalEventId },
          '[ClientMonitoring] Failed to evaluate exposure for org'
        );
        // Continue with other orgs - don't fail the whole batch
      }
    }

    logger.info(
      {
        global_event_id: globalEventId,
        orgs_processed: organizations.length,
        candidates_created: totalCandidatesCreated,
        exposures_cleared: totalCleared,
      },
      '[ClientMonitoring] Completed global event fan-out'
    );
  } catch (error) {
    logger.error(
      { error, global_event_id: globalEventId },
      '[ClientMonitoring] Failed to process global event change'
    );
    throw error;
  }
};

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
    const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
    const minSeverity = minSeverityConfig[globalEvent.category] ?? 'low';
    const eventSeverityValue = severityOrder[globalEvent.intrinsic_severity as keyof typeof severityOrder] ?? 0;
    const minSeverityValue = severityOrder[minSeverity as keyof typeof severityOrder] ?? 0;

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

  // Process candidate exposures
  const candidateExposures = parsedResult.candidate_exposures || [];

  for (const candidate of candidateExposures) {
    const created = await createCandidateExposure(
      organizationId,
      globalEvent,
      candidate,
      profile.profile_version
    );
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
 * Create a CandidateExposure record
 * Returns true if a new record was created, false if it already existed
 */
async function createCandidateExposure(
  organizationId: string,
  globalEvent: any,
  candidate: any,
  profileVersion: number
): Promise<boolean> {
  const prisma = getPrismaClient();

  // Check for existing candidate exposure
  const existing = await prisma.candidateExposure.findUnique({
    where: {
      organization_id_global_event_hash: {
        organization_id: organizationId,
        global_event_hash: globalEvent.event_hash,
      },
    },
  });

  if (existing) {
    // Update if status allows
    if (existing.validation_status === 'WATCHING' || existing.validation_status === 'REJECTED') {
      await prisma.candidateExposure.update({
        where: { id: existing.id },
        data: {
          exposure_pathways: candidate.exposure_pathways,
          exposure_strength: candidate.exposure_strength,
          exposed_assets: candidate.exposed_assets,
          match_confidence: candidate.match_confidence,
          temporal_relevance: candidate.temporal_relevance,
          strategic_context: candidate.strategic_context,
          rationale: candidate.rationale,
          exposure_priority: candidate.exposure_priority,
          validation_status: candidate.exposure_strength === 'possible' ? 'WATCHING' : 'CANDIDATE',
          profile_snapshot_ref: `v${profileVersion}`,
          updated_at: new Date(),
        },
      });
      return false; // Updated, not new
    }
    return false; // Already in pipeline
  }

  // Create new candidate exposure
  const validationStatus = candidate.exposure_strength === 'possible' ? 'WATCHING' : 'CANDIDATE';

  await prisma.candidateExposure.create({
    data: {
      organization_id: organizationId,
      global_event_id: globalEvent.id,
      global_event_hash: globalEvent.event_hash,
      exposure_pathways: candidate.exposure_pathways,
      exposure_strength: candidate.exposure_strength,
      exposed_assets: candidate.exposed_assets,
      match_confidence: candidate.match_confidence,
      temporal_relevance: candidate.temporal_relevance,
      strategic_context: candidate.strategic_context,
      rationale: candidate.rationale,
      exposure_priority: candidate.exposure_priority,
      validation_status: validationStatus as any,
      profile_snapshot_ref: `v${profileVersion}`,
    },
  });

  logger.info(
    {
      organization_id: organizationId,
      global_event_id: globalEvent.id,
      exposure_strength: candidate.exposure_strength,
      validation_status: validationStatus,
    },
    '[ClientMonitoring] Created candidate exposure'
  );

  return true;
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
