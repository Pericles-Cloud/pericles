/**
 * Test Monitoring Cycle
 *
 * Runs a single monitoring cycle for Levi Strauss organization
 */

import 'dotenv/config';
import { loadMonitoringConfig } from '../src/monitoring/config';
import { runMonitoringCycle } from '../src/monitoring/index';
import { logger } from '../src/monitoring/logger';

const LEVI_STRAUSS_ORG_ID = '550e8400-e29b-41d4-a716-446655440000';

async function main() {
  logger.info('Starting test monitoring cycle...');

  try {
    // Load configuration
    const config = await loadMonitoringConfig(LEVI_STRAUSS_ORG_ID);

    logger.info({
      organizationId: config.organizationId,
      enabledSources: config.enabledSources,
      radiusKm: config.geographicFilter.radiusKm,
      severityThreshold: config.riskFilter.severityThreshold,
    }, 'Configuration loaded');

    // Run single monitoring cycle
    logger.info('Executing monitoring cycle...');
    const metrics = await runMonitoringCycle(config);

    // Display results
    logger.info({
      durationMs: metrics.durationMs,
      toolsExecuted: metrics.toolsExecuted,
      toolsSucceeded: metrics.toolsSucceeded,
      toolsFailed: metrics.toolsFailed,
      eventsDetected: metrics.eventsDetected,
      eventsPublished: metrics.eventsPublished,
      duplicatesFiltered: metrics.duplicatesFiltered,
      geographyFiltered: metrics.geographyFiltered,
      severityFiltered: metrics.severityFiltered,
      errors: metrics.errors.length,
    }, '✓ Monitoring cycle complete');

    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'Test monitoring cycle failed');
    process.exit(1);
  }
}

void main();
