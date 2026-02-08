#!/usr/bin/env node

/**
 * Monitoring Agent - Standalone Process Entry Point
 *
 * Usage:
 *   node dist/monitoring/start.js --organization-id=<uuid>
 *   npm run monitoring:start -- --organization-id=<uuid>
 *
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   OPENAI_API_KEY - OpenAI API key (required)
 *   MONITORING_DEFAULT_INTERVAL_MS - Polling interval (default: 15000)
 *   LOG_LEVEL - Logging level: debug|info|warn|error (default: info)
 */

import { loadMonitoringConfig, getEnvironmentOverrides } from './config.js';
import { startMonitoring, stopMonitoring } from './index.js';
import { logger } from './logger.js';

// ============================================================================
// Parse Command Line Arguments
// ============================================================================

function parseArgs(): { organizationId?: string } {
  const args = process.argv.slice(2);
  const result: { organizationId?: string } = {};

  for (const arg of args) {
    if (arg.startsWith('--organization-id=')) {
      result.organizationId = arg.split('=')[1];
    }
  }

  return result;
}

// ============================================================================
// Validate Environment
// ============================================================================

function validateEnvironment(): void {
  const required = ['DATABASE_URL', 'OPENAI_API_KEY'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.fatal({ missing }, 'Missing required environment variables');
    process.exit(1);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  logger.info('[Start] Monitoring Agent starting...');

  // Validate environment
  validateEnvironment();

  // Parse arguments
  const args = parseArgs();

  if (!args.organizationId) {
    logger.fatal(
      'Missing required argument: --organization-id\n\nUsage:\n  node dist/monitoring/start.js --organization-id=<uuid>'
    );
    process.exit(1);
  }

  logger.info({ organizationId: args.organizationId }, '[Start] Organization ID provided');

  try {
    // Load configuration
    const envOverrides = getEnvironmentOverrides();
    const config = await loadMonitoringConfig(args.organizationId, envOverrides);

    logger.info(
      {
        organizationId: config.organizationId,
        pollingIntervalMs: config.pollingIntervalMs,
        enabledSources: config.enabledSources,
      },
      '[Start] Configuration loaded'
    );

    // Setup graceful shutdown
    process.on('SIGINT', () => {
      logger.info('[Start] Received SIGINT, shutting down...');
      stopMonitoring();
    });

    process.on('SIGTERM', () => {
      logger.info('[Start] Received SIGTERM, shutting down...');
      stopMonitoring();
    });

    // Start monitoring loop
    await startMonitoring(config);
  } catch (error) {
    logger.fatal({ error }, '[Start] Failed to start monitoring');
    process.exit(1);
  }
}

// ============================================================================
// Execute
// ============================================================================

main().catch((error: unknown) => {
  logger.fatal({ error }, '[Start] Unhandled error');
  process.exit(1);
});
