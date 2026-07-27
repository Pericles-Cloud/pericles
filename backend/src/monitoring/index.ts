/**
 * Monitoring Loop - Main Entry Point
 *
 * Continuous polling loop that executes the monitoring agent every N seconds.
 *
 * Flow:
 * 1. Load configuration
 * 2. Execute monitoring cycle
 * 3. Sleep for polling interval
 * 4. Repeat (with error handling and backoff)
 */

import { mastra } from '../mastra/index.js';
import { type MonitoringConfig } from './config.js';
import { getPrismaClient } from './db-client.js';
import { logger, createLogger } from './logger.js';
import {
  type CycleMetrics,
  initializeCycleMetrics,
  finalizeCycleMetrics,
  getMetricsSummary,
} from './metrics.js';
import {
  classifyError,
  reportError,
  calculateBackoff,
  ErrorSeverity,
} from './error-reporter.js';
import { requestValidation } from './validation-client.js';
import { publishToQueue } from './queue-client.js';

// ============================================================================
// Global State
// ============================================================================

let isRunning = false;
let consecutiveErrors = 0;

// ============================================================================
// Main Monitoring Loop
// ============================================================================

/**
 * Start continuous monitoring loop
 *
 * @param config - Monitoring configuration
 */
export async function startMonitoring(config: MonitoringConfig): Promise<void> {
  const cycleLogger = createLogger({ organizationId: config.organizationId });

  cycleLogger.info(
    {
      pollingIntervalMs: config.pollingIntervalMs,
      enabledSources: config.enabledSources,
    },
    '[Monitoring] Starting monitoring loop'
  );

  isRunning = true;

  while (isRunning) {
    try {
      // Execute single monitoring cycle
      await runMonitoringCycle(config);

      // Reset error counter on success
      consecutiveErrors = 0;

      // Sleep for polling interval
      await sleep(config.pollingIntervalMs);
    } catch (error) {
      const classified = classifyError(error as Error, 'monitoring-loop');
      reportError(classified, 'monitoring-loop', config.organizationId);

      consecutiveErrors++;

      // Fatal errors stop monitoring
      if (classified.severity === ErrorSeverity.FATAL) {
        cycleLogger.fatal('[Monitoring] Fatal error encountered, stopping monitoring');
        stopMonitoring();
        break;
      }

      // Recoverable errors: exponential backoff
      if (classified.severity === ErrorSeverity.RECOVERABLE) {
        const backoffMs = classified.backoffMs || calculateBackoff(consecutiveErrors);
        cycleLogger.warn({ backoffMs }, '[Monitoring] Backing off due to error');
        await sleep(backoffMs);
      }

      // If too many consecutive errors, stop
      if (consecutiveErrors >= config.errorHandling.maxRetries && config.errorHandling.stopOnFatalError) {
        cycleLogger.fatal(
          { consecutiveErrors },
          '[Monitoring] Too many consecutive errors, stopping monitoring'
        );
        stopMonitoring();
        break;
      }
    }
  }

  cycleLogger.info('[Monitoring] Monitoring loop stopped');
}

/**
 * Stop monitoring loop
 */
export function stopMonitoring(): void {
  isRunning = false;
  logger.info('[Monitoring] Stopping monitoring loop...');
}

/**
 * Check if monitoring is running
 */
export function isMonitoringRunning(): boolean {
  return isRunning;
}

// ============================================================================
// Progress Callback Types
// ============================================================================

export type ProgressPhase = 'starting' | 'loading_context' | 'executing_tools' | 'processing_events' | 'complete' | 'error';

export interface ProgressUpdate {
  phase: ProgressPhase;
  message: string;
  tool?: string;
  toolIndex?: number;
  totalTools?: number;
  eventsDetected?: number;
  eventsPublished?: number;
  timestamp: string;
  // Tool configuration info (emitted at start)
  enabledTools?: string[];
  disabledTools?: string[];
  // Heartbeat flag - frontend should not display these in activity log
  isHeartbeat?: boolean;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

// ============================================================================
// Single Monitoring Cycle
// ============================================================================

/**
 * Execute single monitoring cycle
 *
 * @param config - Monitoring configuration
 * @param onProgress - Optional callback for progress updates
 * @returns Cycle metrics
 */
export async function runMonitoringCycle(
  config: MonitoringConfig,
  onProgress?: ProgressCallback
): Promise<CycleMetrics> {
  const metrics = initializeCycleMetrics(config.organizationId);
  const cycleLogger = createLogger({ organizationId: config.organizationId });

  const emitProgress = (update: Omit<ProgressUpdate, 'timestamp'>) => {
    if (onProgress) {
      onProgress({ ...update, timestamp: new Date().toISOString() });
    }
  };

  // Map source names to tool IDs for display
  const sourceToToolId: Record<string, string> = {
    weather: 'weather-disaster-monitor-tool',
    political: 'political-risk-monitor-tool',
    cybersecurity: 'cybersecurity-monitor-tool',
    economic: 'economic-financial-monitor-tool',
    news: 'news-social-media-monitor-tool',
    maritime: 'maritime-logistics-monitor-tool',
    labor: 'labor-social-monitor-tool',
    regulatory: 'regulatory-trade-monitor-tool',
    pandemic: 'pandemic-health-monitor-tool',
    geopolitical: 'geopolitical-conflict-monitor-tool',
  };

  // Categorize tools by enabled status
  const enabledTools: string[] = ['erp-context-tool', 'incident-lookup-tool']; // Always enabled
  const disabledTools: string[] = [];

  for (const [source, enabled] of Object.entries(config.enabledSources)) {
    const toolId = sourceToToolId[source];
    if (toolId) {
      if (enabled) {
        enabledTools.push(toolId);
      } else {
        disabledTools.push(toolId);
      }
    }
  }

  emitProgress({
    phase: 'starting',
    message: 'Initializing monitoring cycle...',
    enabledTools,
    disabledTools,
  });
  cycleLogger.debug('[Cycle] Starting monitoring cycle');

  // Heartbeat interval for progress feedback (declared outside try for cleanup in finally)
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let agentTimeout: NodeJS.Timeout | null = null;

  try {
    // Get monitoring agent from Mastra
    const agent = mastra.getAgent('monitoringAgent');

    if (!agent) {
      throw new Error('Monitoring agent not found in Mastra registry');
    }

    emitProgress({
      phase: 'loading_context',
      message: 'Loading organization context...',
      enabledTools,
      disabledTools,
    });

    // Count enabled sources to estimate total tools
    const enabledSourceCount = Object.values(config.enabledSources).filter(Boolean).length;
    const estimatedTools = enabledSourceCount + 2; // +2 for context/lookup tools
    let currentToolIndex = 0;

    // Execute agent with structured prompt
    const monitoringPrompt = createMonitoringPrompt(config);

    cycleLogger.debug({ prompt: monitoringPrompt }, '[Cycle] Executing agent');

    emitProgress({ phase: 'executing_tools', message: 'Connecting to AI agent...', toolIndex: 0, totalTools: estimatedTools });

    const agentStartTime = Date.now();
    cycleLogger.info({ prompt: monitoringPrompt.substring(0, 200) + '...' }, '[Cycle] Starting agent execution');

    // Create a timeout promise for the overall agent execution. 5 minutes is
    // the cap for a full cycle. (The old 280s Vercel-serverless branch went
    // with the serverless deploy — the backend is a Coolify container now.)
    const AGENT_TIMEOUT_MS = parseInt(process.env.MONITORING_AGENT_TIMEOUT_MS || '300000', 10);

    // The handle is cleared in `finally`. Left pending it keeps the event loop
    // alive for the full timeout after the cycle has already returned, which
    // stalls any one-shot caller (see monitoring/run-once.ts) long past its work.
    const timeoutPromise = new Promise<never>((_, reject) => {
      agentTimeout = setTimeout(() => {
        reject(new Error(`Agent execution timed out after ${AGENT_TIMEOUT_MS / 1000} seconds`));
      }, AGENT_TIMEOUT_MS);
    });

    // Emit heartbeat updates every 10 seconds to keep SSE connection alive
    // This is critical for Vercel streaming - connections drop without periodic data
    // Marked as heartbeat so frontend can filter from display
    let waitingSeconds = 0;
    heartbeatInterval = setInterval(() => {
      waitingSeconds += 10;
      if (onProgress) {
        onProgress({
          phase: 'executing_tools',
          message: currentToolIndex === 0
            ? `Waiting for AI response... (${waitingSeconds}s)`
            : `Processing tools... (${waitingSeconds}s elapsed)`,
          toolIndex: currentToolIndex,
          totalTools: Math.max(estimatedTools, currentToolIndex),
          timestamp: new Date().toISOString(),
          isHeartbeat: true, // Mark as heartbeat for frontend filtering
        });
      }
    }, 10000);

    // Track tool execution for logging
    const toolsProcessed = new Set<string>();
    let lastStepTime = Date.now();

    const agentPromise = agent.generate(monitoringPrompt, {
      // Called when a step (which may include tool calls) finishes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra agent callback type
      onStepFinish: (step: any) => {
        const stepDuration = Date.now() - lastStepTime;
        lastStepTime = Date.now();

        // Log the full step structure for debugging
        cycleLogger.info(
          {
            stepType: step?.type,
            stepDurationMs: stepDuration,
            hasToolCalls: !!step?.toolCalls?.length,
            hasToolResults: !!step?.toolResults?.length,
            toolCallCount: step?.toolCalls?.length || 0,
            toolResultCount: step?.toolResults?.length || 0,
            stepKeys: Object.keys(step || {}),
          },
          '[Cycle] Step finished'
        );

        // Process tool calls from this step
        const toolCalls = step?.toolCalls || step?.toolResults || [];
        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            // Try multiple property paths for tool name
            const toolName = toolCall?.payload?.toolName
              || toolCall?.toolName
              || toolCall?.name
              || toolCall?.toolId
              || toolCall?.id
              || toolCall?.tool?.name
              || toolCall?.tool?.id
              || toolCall?.function?.name
              || (typeof toolCall === 'string' ? toolCall : null)
              || null;

            // Generate a unique key for this tool call
            const toolKey = toolName || `unknown-${currentToolIndex}`;

            // Only process if we haven't seen this tool yet
            if (!toolsProcessed.has(toolKey)) {
              toolsProcessed.add(toolKey);
              metrics.toolsExecuted++;
              currentToolIndex++;

              const displayName = formatToolName(toolName || 'Unknown');
              const durationSec = (stepDuration / 1000).toFixed(1);

              // Log detailed tool info
              cycleLogger.info(
                {
                  tool: toolName,
                  toolIndex: currentToolIndex,
                  stepDurationMs: stepDuration,
                  toolCallKeys: Object.keys(toolCall || {}),
                  hasResult: !!toolCall?.result,
                  hasError: !!toolCall?.error,
                },
                `[Cycle] Tool completed: ${displayName}`
              );

              // Emit progress with timing
              emitProgress({
                phase: 'executing_tools',
                message: `${displayName} completed (${durationSec}s)`,
                tool: toolName || `tool-${currentToolIndex}`,
                toolIndex: currentToolIndex,
                totalTools: Math.max(estimatedTools, currentToolIndex),
              });
            }
          }
        } else {
          // No tool calls in this step - might be an LLM thinking step
          cycleLogger.debug(
            { stepDurationMs: stepDuration },
            '[Cycle] Non-tool step completed (LLM processing)'
          );
        }
      },
    });

    // Race between agent execution and timeout
    const response = await Promise.race([agentPromise, timeoutPromise]);

    // Clear heartbeat interval after agent completes
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    // Parse agent response
    const result = response.text || '';
    const agentDuration = Date.now() - agentStartTime;
    cycleLogger.info(
      { durationMs: agentDuration, toolsExecuted: metrics.toolsExecuted, responseLength: result.length },
      '[Cycle] Agent execution completed'
    );

    emitProgress({
      phase: 'processing_events',
      message: `Agent completed in ${(agentDuration / 1000).toFixed(1)}s, processing results...`,
    });

    emitProgress({ phase: 'processing_events', message: 'Processing detected events...' });

    // Extract structured data from response
    // Note: The agent should return JSON, but we need to parse it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic JSON parsing from agent response
    let detectedEvents: any[] = [];
    try {
      const jsonMatch = /\{[\s\S]*\}/.exec(result);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        detectedEvents = parsed.detected_events || [];
        metrics.eventsDetected = parsed.total_events_detected || detectedEvents.length;
        metrics.duplicatesFiltered = parsed.duplicates_filtered || 0;
        metrics.geographyFiltered = parsed.geography_filtered || 0;
        metrics.severityFiltered = parsed.severity_filtered || 0;
      }
    } catch (parseError) {
      cycleLogger.warn({ error: parseError }, '[Cycle] Failed to parse agent response as JSON');
    }

    emitProgress({
      phase: 'processing_events',
      message: `Found ${metrics.eventsDetected} events, storing...`,
      eventsDetected: metrics.eventsDetected,
    });

    // Process and store detected events
    for (const eventData of detectedEvents) {
      try {
        const storedEvent = await storeEvent(config.organizationId, eventData);

        // Check if this was a duplicate (server-side deduplication)
        if (storedEvent._deduplicated) {
          metrics.duplicatesFiltered = (metrics.duplicatesFiltered || 0) + 1;
          cycleLogger.debug(
            { eventId: storedEvent.id, hash: eventData.event_hash },
            '[Cycle] Duplicate event skipped (server-side deduplication)'
          );
          continue;
        }

        metrics.eventsPublished++;

        // Emit to queue with error logging
        if (config.observability.enableMetrics) {
          publishToQueue('events-queue', {
            type: 'event',
            payload: storedEvent,
            timestamp: new Date().toISOString(),
            organizationId: config.organizationId,
          }).catch((queueError: unknown) => {
            // Log queue publishing failure but don't fail the overall cycle
            cycleLogger.warn(
              { error: queueError, eventId: storedEvent.id },
              '[Cycle] Failed to publish event to queue - event was stored but may not trigger downstream processing'
            );
          });
        }

        // Pass to Validation Agent
        requestValidation({
          eventId: storedEvent.id,
          organizationId: config.organizationId,
          eventType: storedEvent.type,
          title: storedEvent.title,
          description: storedEvent.description,
          location: {
            name: storedEvent.location_name || 'Unknown',
            latitude: storedEvent.latitude || undefined,
            longitude: storedEvent.longitude || undefined,
          },
          source: storedEvent.source,
          eventTimestamp: storedEvent.event_timestamp.toISOString(),
        });

        cycleLogger.info(
          {
            eventId: storedEvent.id,
            type: storedEvent.type,
            severity: storedEvent.severity,
          },
          '[Cycle] Event stored and queued'
        );
      } catch (error) {
        cycleLogger.error({ error, eventData }, '[Cycle] Failed to store event');
        metrics.errors.push({
          tool: 'storeEvent',
          error: (error as Error).message,
          timestamp: new Date(),
        });
      }
    }

    metrics.toolsSucceeded = metrics.toolsExecuted - metrics.errors.length;
    metrics.toolsFailed = metrics.errors.length;

    // Log audit record
    if (config.observability.enableAuditLog) {
      await logAuditRecord(config.organizationId, metrics);
    }

    emitProgress({
      phase: 'complete',
      message: `Cycle complete: ${metrics.eventsPublished} events published`,
      eventsDetected: metrics.eventsDetected,
      eventsPublished: metrics.eventsPublished,
    });
  } catch (error) {
    emitProgress({
      phase: 'error',
      message: (error as Error).message || 'Monitoring cycle failed',
    });
    cycleLogger.error({ error }, '[Cycle] Monitoring cycle failed');
    throw error;
  } finally {
    // Clean up heartbeat interval if still running
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    // Drop the agent timeout too — otherwise it holds the event loop open for
    // the remainder of AGENT_TIMEOUT_MS after the cycle is done.
    if (agentTimeout) {
      clearTimeout(agentTimeout);
      agentTimeout = null;
    }
    finalizeCycleMetrics(metrics);
    cycleLogger.info({ metrics: getMetricsSummary(metrics) }, '[Cycle] Cycle complete');
  }

  return metrics;
}

// ============================================================================
// Event Storage
// ============================================================================

/**
 * Store event in database (atomic transaction)
 *
 * Creates:
 * - Event record
 * - EventHash record (for deduplication)
 * - RiskAssessment record
 *
 * @param organizationId - Organization UUID
 * @param eventData - Event data from agent
 * @returns Stored event record
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic event data from agent, typed at Prisma layer
async function storeEvent(organizationId: string, eventData: any): Promise<any> {
  const prisma = getPrismaClient();

  return await prisma.$transaction(async (tx) => {
    // Server-side deduplication check - verify event doesn't already exist
    // Check both by event_hash AND by content (title + source + type)
    const existingEvent = await tx.event.findFirst({
      where: {
        organization_id: organizationId,
        OR: [
          { event_hash: eventData.event_hash },
          {
            title: eventData.title,
            source: eventData.source,
            type: eventData.type,
          },
        ],
      },
      select: { id: true, event_hash: true },
    });

    if (existingEvent) {
      // Event already exists - update EventHash occurrence count and return existing event
      await tx.eventHash.updateMany({
        where: {
          organization_id: organizationId,
          hash: existingEvent.event_hash,
        },
        data: {
          last_seen_at: new Date(),
          occurrence_count: { increment: 1 },
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return { ...existingEvent, _deduplicated: true };
    }

    // Create Event record
    const event = await tx.event.create({
      data: {
        organization_id: organizationId,
        event_hash: eventData.event_hash,
        type: eventData.type,
        source: eventData.source,
        title: eventData.title,
        description: eventData.description,
        location_name: eventData.location?.name,
        latitude: eventData.location?.latitude,
        longitude: eventData.location?.longitude,
        event_timestamp: new Date(eventData.event_timestamp),
        severity: eventData.severity,
        confidence: eventData.confidence,
        risk_factors: eventData.risk_factors || [],
        affected_domains: eventData.affected_domains || [],
        validation_status: 'pending',
        raw_data: eventData.raw_data || {},
      },
    });

    // Create/Update EventHash record (for deduplication)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    await tx.eventHash.upsert({
      where: {
        organization_id_hash: {
          organization_id: organizationId,
          hash: eventData.event_hash,
        },
      },
      create: {
        organization_id: organizationId,
        hash: eventData.event_hash,
        first_seen_at: new Date(),
        last_seen_at: new Date(),
        occurrence_count: 1,
        original_event_id: event.id,
        expires_at: expiresAt,
      },
      update: {
        last_seen_at: new Date(),
        occurrence_count: { increment: 1 },
        expires_at: expiresAt, // Extend TTL
      },
    });

    // Create RiskAssessment record
    await tx.riskAssessment.create({
      data: {
        organization_id: organizationId,
        event_id: event.id,
        severity_score: eventData.severity,
        confidence_score: eventData.confidence,
        risk_category: eventData.type,
        risk_type: eventData.type,
        geographic_impact: eventData.location || {},
        supply_chain_impact: {
          affected_domains: eventData.affected_domains,
          risk_factors: eventData.risk_factors,
        },
        risk_factors: eventData.risk_factors || [],
        affected_domains: eventData.affected_domains || [],
        mitigation_suggestions: [], // To be filled by Impact Assessment Agent
      },
    });

    return event;
  });
}

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Log monitoring cycle to audit log
 */
async function logAuditRecord(organizationId: string, metrics: CycleMetrics): Promise<void> {
  const prisma = getPrismaClient();

  try {
    await prisma.monitoringAuditLog.create({
      data: {
        organization_id: organizationId,
        event_type: 'monitoring_cycle',
        status: metrics.errors.length > 0 ? 'partial_success' : 'success',
        events_detected: metrics.eventsDetected,
        events_filtered: metrics.duplicatesFiltered + metrics.geographyFiltered + metrics.severityFiltered,
        events_published: metrics.eventsPublished,
        duplicates_found: metrics.duplicatesFiltered,
        duration_ms: metrics.durationMs,
        metadata: {
          toolsExecuted: metrics.toolsExecuted,
          toolsSucceeded: metrics.toolsSucceeded,
          toolsFailed: metrics.toolsFailed,
          errors: metrics.errors,
        },
      },
    });
  } catch (error) {
    logger.warn({ error }, '[Audit] Failed to log audit record');
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create monitoring prompt for agent
 */
function createMonitoringPrompt(config: MonitoringConfig): string {
  return `Monitor supply chain risk events for organization: ${config.organizationId}

Execute monitoring for the following enabled sources:
${Object.entries(config.enabledSources)
  .filter(([_, enabled]) => enabled)
  .map(([source]) => `- ${source}`)
  .join('\n')}

Configuration:
- Geographic Radius: ${config.geographicFilter.radiusKm}km
- Severity Threshold: ${config.riskFilter.severityThreshold}
- Confidence Threshold: ${config.riskFilter.confidenceThreshold}
- Monitored Risk Types: ${config.riskFilter.monitoredRiskTypes.length > 0 ? config.riskFilter.monitoredRiskTypes.join(', ') : 'All types'}

Return detected events in JSON format as specified in your instructions.`;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format tool name for display
 */
function formatToolName(toolName: string | undefined): string {
  if (!toolName) return 'Unknown Tool';

  const toolDisplayNames: Record<string, string> = {
    'erp-context-tool': 'ERP Context',
    'incident-lookup-tool': 'Incident Lookup',
    'organization-lookup-tool': 'Organization Lookup',
    'weather-disaster-monitor-tool': 'Weather & Disasters',
    'political-risk-monitor-tool': 'Political Risk',
    'cybersecurity-monitor-tool': 'Cybersecurity',
    'economic-financial-monitor-tool': 'Economic & Financial',
    'news-social-media-monitor-tool': 'News & Social Media',
    'maritime-logistics-monitor-tool': 'Maritime & Logistics',
    'labor-social-monitor-tool': 'Labor & Social',
    'regulatory-trade-monitor-tool': 'Regulatory & Trade',
    'pandemic-health-monitor-tool': 'Pandemic & Health',
    'geopolitical-conflict-monitor-tool': 'Geopolitical & Conflict',
  };

  return toolDisplayNames[toolName] || toolName.replace(/-/g, ' ').replace(/tool$/i, '').trim();
}
