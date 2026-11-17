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
import { emitGlobalEventChange, lockGlobalEvent } from './global-event-changes.js';
import { isMaterialChange } from '../workflow/records/global-event-change.js';
import { TERMINAL_EVENT_STATUSES } from './exposure-strength.js';
import type { Prisma } from '@prisma/client';
import { GlobalBillingConfigError, modelContext, resolveGlobalMonitoringModel } from './agent-models.js';
import { MissingApiKeyError, agentTimeoutMs } from './config.js';

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
  wakeSleep?.();
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

    // Billed to the Pericles root org's own key (no platform env fallback).
    // A missing key skips the cycle, loudly: it is a configuration state.
    let model;
    try {
      model = await resolveGlobalMonitoringModel();
    } catch (error) {
      if (error instanceof MissingApiKeyError || error instanceof GlobalBillingConfigError) {
        cycleLogger.error({ error: error.message }, '[GlobalCycle] Skipped agent: no billable root organization key');
        // Stale marking is a DB step that needs no model: keep it running.
        await checkForStaleEvents();
        return metrics;
      }
      throw error;
    }

    // Execute agent
    // Bounded like the per-org cycle (MONITORING_AGENT_TIMEOUT_MS, 5 min): a hung
    // provider must fail the cycle, so the loop's error handling (and, after
    // repeated failures, the service restart) can take over.
    const response = await agent.generate(prompt, {
      runtimeContext: modelContext(model),
      abortSignal: AbortSignal.timeout(agentTimeoutMs()),
    });

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
    // Created/updated/resolved are counted below from what was actually
    // stored; seeding them from the agent's self-reported numbers doubled them.
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
  // The event write and its change record commit together: an event is never
  // stored without the record that tells customers about it.
  await prisma.$transaction(async (tx) => {
    const event = await tx.globalEvent.create({
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
    await emitGlobalEventChange(
      tx,
      {
        event_id: event.id,
        event_hash: event.event_hash,
        change_type: 'created',
        intrinsic_severity: event.intrinsic_severity,
        status: event.status,
      },
      event.created_at
    );
  });
}

/** GlobalEvent fields an agent update may set (Global Monitoring spec §9 content). */
const AGENT_UPDATABLE_FIELDS = new Set([
  'headline', 'actor', 'action', 'target',
  'occurred_at', 'scheduled_at', 'forecast_at', 'first_reported_at',
  'category', 'subcategory', 'secondary_categories',
  'status', 'intrinsic_severity', 'severity_rationale',
  'confidence', 'corroborating_source_count',
  'latitude', 'longitude', 'affected_area', 'country_iso', 'admin1_region', 'named_infrastructure',
  'affected_dimensions', 'expected_duration', 'duration_estimate', 'event_statement',
  'parent_event_id', 'related_event_ids', 'sources', 'context_items',
  'last_checked_at', 'next_check_due', 'stale',
]);

/**
 * Update an existing global event
 */
export async function updateGlobalEvent(updateData: any): Promise<void> {
  const prisma = getPrismaClient();

  // Read, decide, write and emit under the event's row lock, so a resolve or
  // retract that commits concurrently is never overwritten by this update's
  // stale view (timeline or status).
  await prisma.$transaction(async (tx) => {
    await lockGlobalEvent(tx, updateData.event_id);
    const event = await tx.globalEvent.findUnique({ where: { id: updateData.event_id } });
    if (!event) {
      throw new Error(`Event not found: ${updateData.event_id}`);
    }
    const ended = TERMINAL_EVENT_STATUSES.has(event.status);

    // Model-written changes may touch only event content fields. Identity, the
    // change_seq counter, the append-only timeline and verification_ref (the
    // Validation Agent's) are never writable here. Status may not be set to a
    // terminal value (resolve/retract/merge do that and always emit), and an
    // ended event's status cannot be changed at all (no silent reopening).
    const updateFields: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const change of updateData.changes || []) {
      if (!AGENT_UPDATABLE_FIELDS.has(change.field)) continue;
      let value: unknown = change.new_value;
      if (change.field === 'status') {
        if (ended || TERMINAL_EVENT_STATUSES.has(String(value))) {
          logger.warn(
            { event_id: event.id, from: event.status, to: value },
            '[GlobalMonitoring] Status change refused in an update (ended event, or terminal value)'
          );
          continue;
        }
      }
      if (change.field === 'intrinsic_severity' && typeof value === 'string') {
        value = value.trim().toLowerCase();
      }
      const before = (event as Record<string, unknown>)[change.field];
      if (JSON.stringify(before) === JSON.stringify(value)) continue;
      updateFields[change.field] = value;
      changedFields.push(change.field);
    }
    if (changedFields.length === 0) return;

    const timeline = [
      ...((event.timeline as unknown[]) || []),
      { timestamp: new Date().toISOString(), changes: updateData.changes, is_material: updateData.is_material },
    ];
    await tx.globalEvent.update({
      where: { id: event.id },
      data: { ...updateFields, timeline, updated_at: new Date() } as Prisma.GlobalEventUpdateInput,
    });

    // Materiality is decided from what actually changed (isMaterialChange),
    // not only from the model's own flag, which can be wrong or missing.
    const payload = {
      event_id: event.id,
      event_hash: event.event_hash,
      change_type: 'updated' as const,
      intrinsic_severity: (updateFields.intrinsic_severity as string | undefined) ?? event.intrinsic_severity,
      previous_intrinsic_severity: event.intrinsic_severity,
      status: (updateFields.status as string | undefined) ?? event.status,
      changed_fields: changedFields,
      is_material: updateData.is_material === true,
    };
    if (isMaterialChange(payload) || payload.is_material) {
      await emitGlobalEventChange(tx, payload);
    }
  });
}

/**
 * Resolve a global event
 */
export async function resolveGlobalEvent(resolveData: any): Promise<void> {
  const prisma = getPrismaClient();
  const now = new Date();

  // Under the event's row lock: re-read, refuse an already-ended event (a
  // repeated resolve must not rewrite its status or fan out again), then write
  // and emit together.
  await prisma.$transaction(async (tx) => {
    await lockGlobalEvent(tx, resolveData.event_id);
    const event = await tx.globalEvent.findUnique({ where: { id: resolveData.event_id } });
    if (!event) {
      throw new Error(`Event not found: ${resolveData.event_id}`);
    }
    if (TERMINAL_EVENT_STATUSES.has(event.status)) {
      logger.warn({ event_id: event.id, status: event.status }, '[GlobalMonitoring] Resolve refused: event already ended');
      return;
    }

    const timeline = [
      ...((event.timeline as unknown[]) || []),
      {
        timestamp: now.toISOString(),
        field: 'status',
        old_value: event.status,
        new_value: 'RESOLVED',
        resolution_basis: resolveData.resolution_basis,
      },
    ];

    await tx.globalEvent.update({
      where: { id: event.id },
      data: {
        status: 'RESOLVED',
        resolved_at: now,
        resolution_basis: resolveData.resolution_basis,
        timeline: timeline as Prisma.InputJsonValue,
        updated_at: now,
      },
    });

    await emitGlobalEventChange(
      tx,
      {
        event_id: event.id,
        event_hash: event.event_hash,
        change_type: 'resolved',
        intrinsic_severity: event.intrinsic_severity,
        status: 'RESOLVED',
      },
      now
    );
  });
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

/** Wakes the loop's current sleep early (set while sleeping). */
let wakeSleep: (() => void) | null = null;

/** A sleep the stop function can cut short, so a requested stop does not wait a whole interval. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      wakeSleep = null;
      resolve();
    }
    wakeSleep = done;
  });
}
