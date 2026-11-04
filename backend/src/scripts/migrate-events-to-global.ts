/**
 * Data Migration Script: Event → GlobalEvent + CandidateExposure
 *
 * Migrates existing per-org Event records to the new architecture:
 * 1. Creates GlobalEvent records from Events (deduplicated by event_hash)
 * 2. Creates CandidateExposure records linking orgs to GlobalEvents
 * 3. Preserves all existing data in the Event table (no deletion)
 *
 * Usage:
 *   npx tsx src/scripts/migrate-events-to-global.ts [--dry-run] [--org=<uuid>]
 *
 * Options:
 *   --dry-run    Show what would be migrated without writing
 *   --org=<uuid> Migrate only events for a specific organization
 */

import { getPrismaClient } from '../monitoring/db-client.js';
import { logger } from '../monitoring/logger.js';
import crypto from 'crypto';

interface MigrationStats {
  eventsProcessed: number;
  globalEventsCreated: number;
  globalEventsSkipped: number;
  candidateExposuresCreated: number;
  candidateExposuresSkipped: number;
  errors: string[];
}

interface MigrationOptions {
  dryRun: boolean;
  organizationId?: string;
  batchSize: number;
}

/**
 * Main migration function
 */
export async function migrateEventsToGlobal(options: MigrationOptions): Promise<MigrationStats> {
  const prisma = getPrismaClient();
  const stats: MigrationStats = {
    eventsProcessed: 0,
    globalEventsCreated: 0,
    globalEventsSkipped: 0,
    candidateExposuresCreated: 0,
    candidateExposuresSkipped: 0,
    errors: [],
  };

  const { dryRun, organizationId, batchSize } = options;

  logger.info(
    { dryRun, organizationId, batchSize },
    '[Migration] Starting Event → GlobalEvent migration'
  );

  // Build query filter
  const whereClause: any = {
    validation_status: { not: 'duplicate' }, // Skip duplicates
  };
  if (organizationId) {
    whereClause.organization_id = organizationId;
  }

  // Count total events to migrate
  const totalEvents = await prisma.event.count({ where: whereClause });
  logger.info({ totalEvents }, '[Migration] Events to process');

  // Process in batches
  let skip = 0;
  while (skip < totalEvents) {
    const events = await prisma.event.findMany({
      where: whereClause,
      take: batchSize,
      skip,
      orderBy: { created_at: 'asc' },
    });

    if (events.length === 0) break;

    for (const event of events) {
      stats.eventsProcessed++;

      try {
        // Step 1: Create or find GlobalEvent
        const globalEvent = await migrateToGlobalEvent(event, dryRun);

        if (globalEvent === 'created') {
          stats.globalEventsCreated++;
        } else if (globalEvent === 'skipped') {
          stats.globalEventsSkipped++;
        } else if (globalEvent === 'error') {
          stats.errors.push(`GlobalEvent migration failed for event ${event.id}`);
          continue;
        }

        // Step 2: Create CandidateExposure linking org to GlobalEvent
        const candidateResult = await migrateToCandidateExposure(event, dryRun);

        if (candidateResult === 'created') {
          stats.candidateExposuresCreated++;
        } else if (candidateResult === 'skipped') {
          stats.candidateExposuresSkipped++;
        } else if (candidateResult === 'error') {
          stats.errors.push(`CandidateExposure migration failed for event ${event.id}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        stats.errors.push(`Event ${event.id}: ${msg}`);
        logger.error({ error, eventId: event.id }, '[Migration] Failed to migrate event');
      }
    }

    skip += batchSize;

    if (skip % (batchSize * 10) === 0) {
      logger.info(
        { processed: stats.eventsProcessed, total: totalEvents },
        '[Migration] Progress update'
      );
    }
  }

  logger.info(stats, '[Migration] Migration complete');
  return stats;
}

/**
 * Migrate a single Event to GlobalEvent
 * Returns: 'created' | 'skipped' | 'error'
 */
async function migrateToGlobalEvent(
  event: any,
  dryRun: boolean
): Promise<'created' | 'skipped' | 'error'> {
  const prisma = getPrismaClient();

  // Generate a stable event_hash for the GlobalEvent
  // Use the existing event_hash if available, otherwise generate one
  const eventHash = event.event_hash || generateEventHash(event);

  // Check if GlobalEvent already exists
  const existing = await prisma.globalEvent.findUnique({
    where: { event_hash: eventHash },
  });

  if (existing) {
    // GlobalEvent already exists - just return skipped
    return 'skipped';
  }

  if (dryRun) {
    return 'created';
  }

  try {
    // Map Event fields to GlobalEvent fields
    const globalEventData = {
      event_hash: eventHash,
      headline: event.title,
      actor: null, // Not tracked in old Event model
      action: null,
      target: null,
      occurred_at: event.event_timestamp,
      first_reported_at: event.event_timestamp,
      first_detected_at: event.detected_at,
      category: mapEventTypeToCategory(event.type),
      subcategory: null,
      secondary_categories: [],
      status: mapValidationStatusToGlobalStatus(event.validation_status),
      resolved_at: null,
      resolution_basis: null,
      intrinsic_severity: mapSeverityToIntrinsic(event.severity),
      severity_rationale: `Migrated from Event ${event.id}`,
      confidence: mapConfidenceToLevel(event.confidence),
      corroborating_source_count: 1,
      latitude: event.latitude,
      longitude: event.longitude,
      affected_area: null,
      country_iso: null,
      admin1_region: event.location_name,
      named_infrastructure: null,
      affected_dimensions: {
        transport_modes: [],
        commodities: [],
        industries: event.affected_domains || [],
        organizations: [],
      },
      expected_duration: null,
      duration_estimate: null,
      event_statement: event.description,
      parent_event_id: null,
      related_event_ids: [],
      sources: event.source
        ? [{
            url: null,
            publisher: event.source,
            tier: 3, // Assume Tier 3 for migrated data
            language: 'en',
            published_at: event.event_timestamp?.toISOString(),
            retrieved_at: event.detected_at?.toISOString(),
          }]
        : [],
      context_items: [],
      timeline: [{
        timestamp: new Date().toISOString(),
        field: 'migration',
        old_value: null,
        new_value: 'Migrated from Event table',
        source: 'migration-script',
      }],
      last_checked_at: event.updated_at,
      next_check_due: null,
      stale: true, // Mark as stale since we don't have fresh data
      verification_ref: null,
      raw_data: event.raw_data,
    };

    await prisma.globalEvent.create({ data: globalEventData as any });
    return 'created';
  } catch (error) {
    logger.error({ error, eventId: event.id }, '[Migration] Failed to create GlobalEvent');
    return 'error';
  }
}

/**
 * Migrate a single Event to CandidateExposure
 * Returns: 'created' | 'skipped' | 'error'
 */
async function migrateToCandidateExposure(
  event: any,
  dryRun: boolean
): Promise<'created' | 'skipped' | 'error'> {
  const prisma = getPrismaClient();

  const eventHash = event.event_hash || generateEventHash(event);

  // Find the corresponding GlobalEvent
  const globalEvent = await prisma.globalEvent.findUnique({
    where: { event_hash: eventHash },
  });

  if (!globalEvent) {
    logger.warn({ eventId: event.id, eventHash }, '[Migration] GlobalEvent not found for CandidateExposure');
    return 'error';
  }

  // Check if CandidateExposure already exists
  const existing = await prisma.candidateExposure.findUnique({
    where: {
      organization_id_global_event_hash: {
        organization_id: event.organization_id,
        global_event_hash: eventHash,
      },
    },
  });

  if (existing) {
    return 'skipped';
  }

  if (dryRun) {
    return 'created';
  }

  try {
    // Map Event fields to CandidateExposure fields
    const candidateData = {
      organization_id: event.organization_id,
      global_event_id: globalEvent.id,
      global_event_hash: eventHash,
      exposure_pathways: [{
        pathway: 'geographic_site',
        match_basis: 'Migrated from Event table - original pathway unknown',
        confidence: event.confidence || 0.5,
      }],
      exposure_strength: mapSeverityToExposureStrength(event.severity),
      exposed_assets: [],
      match_confidence: {
        location: event.confidence || 0.5,
      },
      temporal_relevance: null,
      strategic_context: null,
      rationale: `Migrated from Event ${event.id}. Original validation status: ${event.validation_status}.`,
      exposure_priority: mapSeverityToPriority(event.severity),
      validation_status: mapValidationStatusToExposureStatus(event.validation_status),
      validation_ref: null,
      cleared_at: null,
      cleared_reason: null,
      profile_snapshot_ref: 'migration-v1',
    };

    await prisma.candidateExposure.create({ data: candidateData as any });
    return 'created';
  } catch (error) {
    logger.error({ error, eventId: event.id }, '[Migration] Failed to create CandidateExposure');
    return 'error';
  }
}

// ============================================================================
// Mapping Functions
// ============================================================================

function generateEventHash(event: any): string {
  const content = `${event.source}|${event.title}|${event.event_timestamp?.toISOString()}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

function mapEventTypeToCategory(eventType: string): string {
  const categoryMap: Record<string, string> = {
    flood: 'Meteorological / Natural Hazard',
    hurricane: 'Meteorological / Natural Hazard',
    typhoon: 'Meteorological / Natural Hazard',
    earthquake: 'Meteorological / Natural Hazard',
    wildfire: 'Meteorological / Natural Hazard',
    storm: 'Meteorological / Natural Hazard',
    weather: 'Meteorological / Natural Hazard',
    strike: 'Labor',
    labor: 'Labor',
    protest: 'Labor',
    port_closure: 'Logistics & Infrastructure',
    port: 'Logistics & Infrastructure',
    shipping: 'Logistics & Infrastructure',
    logistics: 'Logistics & Infrastructure',
    cyberattack: 'Cyber',
    cyber: 'Cyber',
    ransomware: 'Cyber',
    sanctions: 'Sanctions & Trade Policy',
    trade: 'Sanctions & Trade Policy',
    tariff: 'Sanctions & Trade Policy',
    export_control: 'Sanctions & Trade Policy',
    conflict: 'Geopolitical / Conflict',
    war: 'Geopolitical / Conflict',
    military: 'Geopolitical / Conflict',
    geopolitical: 'Geopolitical / Conflict',
    pandemic: 'Public Health',
    outbreak: 'Public Health',
    health: 'Public Health',
    economic: 'Economic & Financial',
    financial: 'Economic & Financial',
    currency: 'Economic & Financial',
    regulatory: 'Regulatory & Compliance',
    compliance: 'Regulatory & Compliance',
    industrial: 'Industrial / Facility',
    facility: 'Industrial / Facility',
    plant: 'Industrial / Facility',
    political: 'Geopolitical / Conflict',
  };

  const lowerType = eventType?.toLowerCase() || '';
  for (const [key, category] of Object.entries(categoryMap)) {
    if (lowerType.includes(key)) {
      return category;
    }
  }

  return 'Logistics & Infrastructure'; // Default category
}

function mapValidationStatusToGlobalStatus(validationStatus: string): any {
  switch (validationStatus) {
    case 'validated':
      return 'ACTIVE';
    case 'rejected':
      return 'RETRACTED';
    case 'duplicate':
      return 'MERGED';
    default:
      return 'DEVELOPING';
  }
}

function mapSeverityToIntrinsic(severity: number): string {
  if (severity >= 0.9) return 'critical';
  if (severity >= 0.7) return 'high';
  if (severity >= 0.4) return 'medium';
  return 'low';
}

function mapConfidenceToLevel(confidence: number): string {
  if (confidence >= 0.9) return 'official';
  if (confidence >= 0.7) return 'corroborated';
  if (confidence >= 0.4) return 'reported';
  return 'unverified';
}

function mapSeverityToExposureStrength(severity: number): string {
  if (severity >= 0.7) return 'direct';
  if (severity >= 0.4) return 'probable';
  return 'possible';
}

function mapSeverityToPriority(severity: number): string {
  if (severity >= 0.9) return 'critical';
  if (severity >= 0.7) return 'high';
  if (severity >= 0.4) return 'medium';
  return 'low';
}

function mapValidationStatusToExposureStatus(validationStatus: string): any {
  switch (validationStatus) {
    case 'validated':
      return 'VALIDATED';
    case 'rejected':
      return 'REJECTED';
    case 'duplicate':
      return 'CLEARED';
    default:
      return 'CANDIDATE';
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  const dryRun = args.includes('--dry-run');
  const orgArg = args.find((a) => a.startsWith('--org='));
  const organizationId = orgArg ? orgArg.split('=')[1] : undefined;
  const batchSize = 100;

  console.log('='.repeat(60));
  console.log('Event → GlobalEvent Migration');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Organization: ${organizationId || 'ALL'}`);
  console.log(`Batch size: ${batchSize}`);
  console.log('='.repeat(60));

  const stats = await migrateEventsToGlobal({
    dryRun,
    organizationId,
    batchSize,
  });

  console.log('\n' + '='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));
  console.log(`Events processed:           ${stats.eventsProcessed}`);
  console.log(`GlobalEvents created:       ${stats.globalEventsCreated}`);
  console.log(`GlobalEvents skipped:       ${stats.globalEventsSkipped}`);
  console.log(`CandidateExposures created: ${stats.candidateExposuresCreated}`);
  console.log(`CandidateExposures skipped: ${stats.candidateExposuresSkipped}`);
  console.log(`Errors:                     ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nErrors:');
    stats.errors.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more`);
    }
  }

  console.log('='.repeat(60));

  process.exit(stats.errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
