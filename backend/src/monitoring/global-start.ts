#!/usr/bin/env node

/**
 * Global Monitoring Agent - Standalone Process Entry Point
 *
 * Usage:
 *   node dist/monitoring/global-start.js
 *   npm run monitoring:global:start
 *
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   GLOBAL_MONITORING_INTERVAL_MS - Polling interval (default: 300000 = 5 minutes)
 *   LOG_LEVEL - Logging level: debug|info|warn|error (default: info)
 *
 * This process runs the Global Monitoring Agent continuously, monitoring
 * external data sources for events that could disrupt supply chains globally.
 *
 * Unlike the per-org monitoring agent, this runs ONCE globally and writes
 * to the Global Event Store, which all Client Monitoring Agents read.
 */

import { startGlobalMonitoring, stopGlobalMonitoring } from './global-index.js';
import { logger } from './logger.js';

// ============================================================================
// Parse Command Line Arguments
// ============================================================================

function parseArgs(): { intervalMs?: number } {
  const args = process.argv.slice(2);
  const result: { intervalMs?: number } = {};

  for (const arg of args) {
    if (arg.startsWith('--interval=')) {
      result.intervalMs = parseInt(arg.split('=')[1], 10);
    }
  }

  return result;
}

// ============================================================================
// Validate Environment
// ============================================================================

function validateEnvironment(): void {
  const required = ['DATABASE_URL'];
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
  logger.info('[GlobalStart] Global Monitoring Agent starting...');

  // Validate environment
  validateEnvironment();

  // Parse arguments
  const args = parseArgs();

  // Load configuration
  const intervalMs = args.intervalMs ?? parseInt(process.env.GLOBAL_MONITORING_INTERVAL_MS || '300000', 10);

  logger.info(
    {
      pollingIntervalMs: intervalMs,
    },
    '[GlobalStart] Configuration loaded'
  );

  // Setup graceful shutdown
  process.on('SIGINT', () => {
    logger.info('[GlobalStart] Received SIGINT, shutting down...');
    stopGlobalMonitoring();
  });

  process.on('SIGTERM', () => {
    logger.info('[GlobalStart] Received SIGTERM, shutting down...');
    stopGlobalMonitoring();
  });

  // Start global monitoring loop
  await startGlobalMonitoring({ pollingIntervalMs: intervalMs });
}

// ============================================================================
// Execute
// ============================================================================

main().catch((error: unknown) => {
  logger.fatal({ error }, '[GlobalStart] Unhandled error');
  process.exit(1);
});
