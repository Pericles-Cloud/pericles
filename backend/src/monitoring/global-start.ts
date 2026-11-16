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
import { getPrismaClient } from './db-client.js';
import { refreshClientExposureProfile } from './client-exposure-profile.js';
import { startDispatchWorker } from '../workflow/dispatch/dispatch-worker.js';

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
// Periodic profile refresh
// ============================================================================

let refreshing = false;

/** Refresh every monitoring-enabled customer org's profile, one at a time; never overlaps itself. */
async function refreshAllProfiles(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const orgs = await getPrismaClient().organization.findMany({
      where: { is_root: false, settings: { monitoring_agent_enabled: true } },
      select: { id: true },
    });
    for (const org of orgs) {
      await refreshClientExposureProfile(org.id, 'periodic');
    }
    logger.info({ orgs: orgs.length }, '[GlobalStart] Periodic profile refresh complete');
  } catch (error) {
    logger.error({ error }, '[GlobalStart] Periodic profile refresh failed');
  } finally {
    refreshing = false;
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

  // The dispatch worker delivers the change records this process emits to
  // client_monitoring (and later Validation). It runs here, always: without it
  // global events never reach any customer (wiki D30).
  const dispatchWorker = startDispatchWorker();

  // Periodic Client Exposure Profile refresh for every monitoring-enabled org
  // (D29): catches anything the sync triggers (ERP/BOL, Org Memory) missed.
  const profileIntervalMs = parseInt(process.env.PROFILE_REFRESH_INTERVAL_MS || String(60 * 60 * 1000), 10);
  const profileTimer = setInterval(() => {
    void refreshAllProfiles();
  }, profileIntervalMs);
  void refreshAllProfiles();

  const shutdown = (signal: string) => {
    logger.info(`[GlobalStart] Received ${signal}, shutting down...`);
    clearInterval(profileTimer);
    dispatchWorker.stop();
    stopGlobalMonitoring();
  };
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
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
