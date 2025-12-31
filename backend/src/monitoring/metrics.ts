/**
 * Monitoring Metrics Tracker
 *
 * Tracks performance metrics for monitoring cycles:
 * - Cycle duration
 * - Events detected/filtered/published
 * - API calls made
 * - Errors encountered
 */

export interface CycleMetrics {
  organizationId: string;
  cycleStartTime: Date;
  cycleEndTime?: Date;
  durationMs?: number;

  // Tool execution
  toolsExecuted: number;
  toolsSucceeded: number;
  toolsFailed: number;
  apiCallsMade: number;

  // Event processing
  eventsDetected: number;
  duplicatesFiltered: number;
  geographyFiltered: number;
  riskTypeFiltered: number;
  severityFiltered: number;
  eventsPublished: number;

  // Errors
  errors: Array<{
    tool: string;
    error: string;
    timestamp: Date;
  }>;
}

/**
 * Initialize metrics for a new monitoring cycle
 */
export function initializeCycleMetrics(organizationId: string): CycleMetrics {
  return {
    organizationId,
    cycleStartTime: new Date(),
    toolsExecuted: 0,
    toolsSucceeded: 0,
    toolsFailed: 0,
    apiCallsMade: 0,
    eventsDetected: 0,
    duplicatesFiltered: 0,
    geographyFiltered: 0,
    riskTypeFiltered: 0,
    severityFiltered: 0,
    eventsPublished: 0,
    errors: [],
  };
}

/**
 * Finalize metrics at end of cycle
 */
export function finalizeCycleMetrics(metrics: CycleMetrics): CycleMetrics {
  metrics.cycleEndTime = new Date();
  metrics.durationMs = metrics.cycleEndTime.getTime() - metrics.cycleStartTime.getTime();
  return metrics;
}

/**
 * Calculate metrics summary for logging
 */
export function getMetricsSummary(metrics: CycleMetrics): string {
  const filterRate = metrics.eventsDetected > 0
    ? ((metrics.eventsPublished / metrics.eventsDetected) * 100).toFixed(1)
    : '0.0';

  return [
    `Duration: ${metrics.durationMs}ms`,
    `Tools: ${metrics.toolsSucceeded}/${metrics.toolsExecuted}`,
    `Events: ${metrics.eventsDetected} detected → ${metrics.eventsPublished} published (${filterRate}%)`,
    `Filtered: ${metrics.duplicatesFiltered} dupes, ${metrics.geographyFiltered} geo, ${metrics.severityFiltered} severity`,
    `Errors: ${metrics.errors.length}`,
  ].join(' | ');
}
