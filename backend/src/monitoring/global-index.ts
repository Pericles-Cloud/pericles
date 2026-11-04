/**
 * Global Monitoring Loop - Main Entry Point
 *
 * Continuous polling loop that executes the Global Monitoring Agent.
 * Unlike the per-org monitoring loop, this runs ONCE globally and writes
 * to the Global Event Store.
 *
 * Flow:
 * 1. Execute global monitoring cycle
 * 2. Sleep for polling interval
 * 3. Repeat (with error handling and backoff)
 *
 * Cadence targets (from Notion instructions):
 * - Surface new events within 30 minutes of first public signal
 * - Check Active events at least every 10 minutes
 * - Check Critical events continuously (target lag under 5 minutes)
 */

import { mastra } from '../mastra/index.js';
import { logger, createLogger } from './logger.js';
import { getPrismaClient } from './db-client.js';
import { enqueueInTransaction, CHANGE_RECORD_QUEUE } from './queue-client.js';
import { globalEventStoreChangeRecord } from '../workflow/records/global-event-change.js';
import { changeRecordKey } from '../workflow/records/change-record.js';

// ============================================================================
// Global State
// ============================================================================

let isRunning = false;
let consecutiveErrors = 0;

// ============================================================================
// Configuration
// ============================================================================

export interface GlobalMonitoringConfig {
  pollingIntervalMs: number;
}

// ============================================================================
// Main Monitoring Loop
// ============================================================================

/**
 * Start continuous global monitoring loop
 */
export async function startGlobalMonitoring(config: GlobalMonitoringConfig): Promise<void> {
  const cycleLogger = createLogger({ scope: 'global' });

  cycleLogger.info(
    {
      pollingIntervalMs: config.pollingIntervalMs,
    },
    '[GlobalMonitoring] Starting global monitoring loop'
  );

  isRunning = true;

  while (isRunning) {
    try {
      // Execute single global monitoring cycle
      await runGlobalMonitoringCycle();

      // Reset error counter on success
      consecutiveErrors = 0;

      // Sleep for polling interval
      await sleep(config.pollingIntervalMs);
    } catch (error) {
      cycleLogger.error({ error }, '[GlobalMonitoring] Cycle failed');
      consecutiveErrors++;

      // Exponential backoff on errors
      const backoffMs = Math.min(60000, 5000 * Math.pow(2, consecutiveErrors));
      cycleLogger.warn({ backoffMs, consecutiveErrors }, '[GlobalMonitoring] Backing off due to error');
      await sleep(backoffMs);

      // Stop after too many consecutive errors
      if (consecutiveErrors >= 10) {
        cycleLogger.fatal('[GlobalMonitoring] Too many consecutive errors, stopping');
        stopGlobalMonitoring();
        break;
      }
    }
  }

  cycleLogger.info('[GlobalMonitoring] Global monitoring loop stopped');
}

/**
 * Stop global monitoring loop
 */
export function stopGlobalMonitoring(): void {
  isRunning = false;
  logger.info('[GlobalMonitoring] Stopping global monitoring loop...');
}

/**
 * Check if global monitoring is running
 */
export function isGlobalMonitoringRunning(): boolean {
  return isRunning;
}

// ============================================================================
// Single Global Monitoring Cycle
// ============================================================================

export interface GlobalCycleMetrics {
  signalsProcessed: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsResolved: number;
  duplicatesFound: number;
  contextItemsAttached: number;
  durationMs: number;
  errors: Array<{ tool: string; error: string; timestamp: Date }>;
}

/**
 * Execute single global monitoring cycle
 */
export async function runGlobalMonitoringCycle(): Promise<GlobalCycleMetrics> {
  const startTime = Date.now();
  const cycleLogger = createLogger({ scope: 'global' });

  const metrics: GlobalCycleMetrics = {
    signalsProcessed: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    eventsResolved: 0,
    duplicatesFound: 0,
    contextItemsAttached: 0,
    durationMs: 0,
    errors: [],
  };

  cycleLogger.info('[GlobalCycle] Starting global monitoring cycle');

  try {
    // Get global monitoring agent from Mastra
    const agent = mastra.getAgent('globalMonitoringAgent');

    if (!agent) {
      throw new Error('Global monitoring agent not found in Mastra registry');
    }

    // Create monitoring prompt
    const prompt = createGlobalMonitoringPrompt();

    cycleLogger.debug({ prompt: prompt.substring(0, 200) }, '[GlobalCycle] Executing agent');

    // Execute agent
    const response = await agent.generate(prompt);

    // Parse agent response
    const result = response.text || '';
    let parsedResult: any = {};

    try {
      const jsonMatch = /\{[\s\S]*\}/.exec(result);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      cycleLogger.warn({ error: parseError }, '[GlobalCycle] Failed to parse agent response as JSON');
    }

    // Extract metrics from response
    const responseMetrics = parsedResult.metrics || {};
    metrics.signalsProcessed = responseMetrics.signals_processed || 0;
    metrics.eventsCreated = responseMetrics.events_created || 0;
    metrics.eventsUpdated = responseMetrics.events_updated || 0;
    metrics.eventsResolved = responseMetrics.events_resolved || 0;
    metrics.duplicatesFound = responseMetrics.duplicates_found || 0;
    metrics.contextItemsAttached = responseMetrics.context_items_attached || 0;

    // Process created events
    const eventsCreated = parsedResult.events_created || [];
    for (const eventData of eventsCreated) {
      try {
        await storeGlobalEvent(eventData);
        metrics.eventsCreated++;
      } catch (error) {
        cycleLogger.error({ error, eventData }, '[GlobalCycle] Failed to store global event');
        metrics.errors.push({
          tool: 'storeGlobalEvent',
          error: (error as Error).message,
          timestamp: new Date(),
        });
      }
    }

    // Process updated events
    const eventsUpdated = parsedResult.events_updated || [];
    for (const updateData of eventsUpdated) {
      try {
        await updateGlobalEvent(updateData);
        metrics.eventsUpdated++;
      } catch (error) {
        cycleLogger.error({ error, updateData }, '[GlobalCycle] Failed to update global event');
        metrics.errors.push({
          tool: 'updateGlobalEvent',
          error: (error as Error).message,
          timestamp: new Date(),
        });
      }
    }

    // Process resolved events
    const eventsResolved = parsedResult.events_resolved || [];
    for (const resolveData of eventsResolved) {
      try {
        await resolveGlobalEvent(resolveData);
        metrics.eventsResolved++;
      } catch (error) {
        cycleLogger.error({ error, resolveData }, '[GlobalCycle] Failed to resolve global event');
        metrics.errors.push({
          tool: 'resolveGlobalEvent',
          error: (error as Error).message,
          timestamp: new Date(),
        });
      }
    }

    // Check for events that need resolution (no signal timeout)
    await checkForStaleEvents();

    metrics.durationMs = Date.now() - startTime;

    cycleLogger.info(
      {
        durationMs: metrics.durationMs,
        eventsCreated: metrics.eventsCreated,
        eventsUpdated: metrics.eventsUpdated,
        eventsResolved: metrics.eventsResolved,
      },
      '[GlobalCycle] Cycle complete'
    );

    return metrics;
  } catch (error) {
    metrics.durationMs = Date.now() - startTime;
    cycleLogger.error({ error }, '[GlobalCycle] Global monitoring cycle failed');
    throw error;
  }
}

// ============================================================================
// Event Storage
// ============================================================================

/**
 * Store a new global event
 */
async function storeGlobalEvent(eventData: any): Promise<void> {
  const prisma = getPrismaClient();

  // Check for existing event (deduplication)
  const existing = await prisma.globalEvent.findUnique({
    where: { event_hash: eventData.event_hash },
  });

  if (existing) {
    // Update existing event with new sources
    const sources = (existing.sources as any[]) || [];
    const newSources = eventData.sources || [];
    const existingUrls = new Set(sources.map((s: any) => s.url));
    const addedSources = newSources.filter((s: any) => !existingUrls.has(s.url));

    if (addedSources.length > 0) {
      await prisma.globalEvent.update({
        where: { id: existing.id },
        data: {
          sources: [...sources, ...addedSources],
          corroborating_source_count: sources.length + addedSources.length,
          updated_at: new Date(),
        },
      });
    }
    return;
  }

  // Create new event
  const event = await prisma.globalEvent.create({
    data: {
      event_hash: eventData.event_hash,
      headline: eventData.headline,
      actor: eventData.actor,
      action: eventData.action,
      target: eventData.target,
      occurred_at: eventData.occurred_at ? new Date(eventData.occurred_at) : null,
      scheduled_at: eventData.scheduled_at ? new Date(eventData.scheduled_at) : null,
      forecast_at: eventData.forecast_at ? new Date(eventData.forecast_at) : null,
      first_reported_at: eventData.first_reported_at ? new Date(eventData.first_reported_at) : null,
      category: eventData.category,
      subcategory: eventData.subcategory,
      secondary_categories: eventData.secondary_categories || [],
      status: eventData.status || 'FORECAST',
      intrinsic_severity: eventData.intrinsic_severity,
      severity_rationale: eventData.severity_rationale,
      confidence: eventData.confidence,
      corroborating_source_count: eventData.corroborating_source_count || 0,
      latitude: eventData.location?.latitude,
      longitude: eventData.location?.longitude,
      affected_area: eventData.location?.affected_area,
      country_iso: eventData.location?.country_iso,
      admin1_region: eventData.location?.admin1_region,
      named_infrastructure: eventData.location?.named_infrastructure,
      affected_dimensions: eventData.affected_dimensions,
      expected_duration: eventData.expected_duration,
      duration_estimate: eventData.duration_estimate,
      event_statement: eventData.event_statement,
      parent_event_id: eventData.parent_event_id,
      related_event_ids: eventData.related_event_ids || [],
      sources: eventData.sources || [],
      context_items: eventData.context_items || [],
      timeline: [],
      raw_data: eventData.raw_data,
    },
  });

  // Emit change record
  const record = globalEventStoreChangeRecord(
    {
      event_id: event.id,
      event_hash: event.event_hash,
      change_type: 'created',
      intrinsic_severity: event.intrinsic_severity,
      status: event.status,
    },
    event.created_at
  );

  await enqueueInTransaction(
    prisma,
    CHANGE_RECORD_QUEUE,
    {
      type: 'change_record',
      payload: record,
      timestamp: record.produced_at,
      organizationId: null, // Global events have no org scope
    },
    { idempotencyKey: changeRecordKey(record) }
  );
}

/**
 * Update an existing global event
 */
async function updateGlobalEvent(updateData: any): Promise<void> {
  const prisma = getPrismaClient();

  const event = await prisma.globalEvent.findUnique({
    where: { id: updateData.event_id },
  });

  if (!event) {
    throw new Error(`Event not found: ${updateData.event_id}`);
  }

  // Build timeline entry
  const timelineEntry = {
    timestamp: new Date().toISOString(),
    changes: updateData.changes,
    is_material: updateData.is_material,
  };

  const timeline = (event.timeline as any[]) || [];
  timeline.push(timelineEntry);

  // Apply changes
  const updateFields: any = {
    timeline,
    updated_at: new Date(),
  };

  for (const change of updateData.changes || []) {
    if (change.field in event) {
      updateFields[change.field] = change.new_value;
    }
  }

  await prisma.globalEvent.update({
    where: { id: updateData.event_id },
    data: updateFields,
  });

  // Emit change record if material
  if (updateData.is_material) {
    const record = globalEventStoreChangeRecord(
      {
        event_id: event.id,
        event_hash: event.event_hash,
        change_type: 'updated',
        intrinsic_severity: updateFields.intrinsic_severity || event.intrinsic_severity,
        status: updateFields.status || event.status,
      },
      new Date()
    );

    await enqueueInTransaction(
      prisma,
      CHANGE_RECORD_QUEUE,
      {
        type: 'change_record',
        payload: record,
        timestamp: record.produced_at,
        organizationId: null, // Global events have no org scope
      },
      { idempotencyKey: changeRecordKey(record) }
    );
  }
}

/**
 * Resolve a global event
 */
async function resolveGlobalEvent(resolveData: any): Promise<void> {
  const prisma = getPrismaClient();

  const event = await prisma.globalEvent.findUnique({
    where: { id: resolveData.event_id },
  });

  if (!event) {
    throw new Error(`Event not found: ${resolveData.event_id}`);
  }

  const now = new Date();

  // Build timeline entry
  const timelineEntry = {
    timestamp: now.toISOString(),
    field: 'status',
    old_value: event.status,
    new_value: 'RESOLVED',
    resolution_basis: resolveData.resolution_basis,
  };

  const timeline = (event.timeline as any[]) || [];
  timeline.push(timelineEntry);

  await prisma.globalEvent.update({
    where: { id: resolveData.event_id },
    data: {
      status: 'RESOLVED',
      resolved_at: now,
      resolution_basis: resolveData.resolution_basis,
      timeline,
      updated_at: now,
    },
  });

  // Emit change record
  const record = globalEventStoreChangeRecord(
    {
      event_id: event.id,
      event_hash: event.event_hash,
      change_type: 'resolved',
      intrinsic_severity: event.intrinsic_severity,
      status: 'RESOLVED',
    },
    now
  );

  await enqueueInTransaction(
    prisma,
    CHANGE_RECORD_QUEUE,
    {
      type: 'change_record',
      payload: record,
      timestamp: record.produced_at,
      organizationId: null, // Global events have no org scope
    },
    { idempotencyKey: changeRecordKey(record) }
  );
}

/**
 * Check for events that should be resolved due to no signal timeout
 */
async function checkForStaleEvents(): Promise<void> {
  const prisma = getPrismaClient();
  const cycleLogger = createLogger({ scope: 'global' });

  // Find Active events that haven't been checked in a while
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours

  const staleEvents = await prisma.globalEvent.findMany({
    where: {
      status: 'ACTIVE',
      last_checked_at: {
        lt: staleThreshold,
      },
    },
    take: 100,
  });

  for (const event of staleEvents) {
    // Mark as stale
    await prisma.globalEvent.update({
      where: { id: event.id },
      data: {
        stale: true,
        updated_at: new Date(),
      },
    });

    cycleLogger.info(
      { eventId: event.id, lastCheckedAt: event.last_checked_at },
      '[GlobalCycle] Marked event as stale'
    );
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function createGlobalMonitoringPrompt(): string {
  const now = new Date().toISOString();
  return `Execute global monitoring cycle at ${now}.

Monitor all enabled data sources for supply chain risk events globally.
Apply the event test: Actor + Action + Target + Location + Timestamp.

For each detected event:
1. Geolocate precisely
2. Deduplicate against Global Event Store
3. Structure hierarchy (parent/child events)
4. Link related events (caused_by, related_to)
5. Assess intrinsic severity and confidence
6. Produce duration estimates for Medium+ severity events
7. Write the record and emit a change record

Also check Active events for resolution and mark stale events.

Return results in JSON format.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
