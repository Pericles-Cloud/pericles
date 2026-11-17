#!/usr/bin/env node

/**
 * Global Monitoring Agent - Standalone Process Entry Point
 *
 * Usage:
 *   Deployed: the backend image with APP_ENTRY=src/monitoring/global-start.ts
 *             (docker-entrypoint.sh runs `node --import tsx` on it; DEPLOYMENT.md)
 *   Local:    npm run monitoring:global:dev
 *
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   GLOBAL_MONITORING_INTERVAL_MS - Polling interval (default: 300000 = 5 minutes)
 *   PROFILE_REFRESH_INTERVAL_MS - Periodic profile refresh (default: 3600000 = 1 hour)
 *   SHUTDOWN_GRACE_MS - Drain time on SIGTERM (default: 8000)
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
import { refreshClientExposureProfile } from './client-exposure-profile.js';
import { startDispatchWorker } from '../workflow/dispatch/dispatch-worker.js';
import { resolveOrganizationIds } from './run-once.js';

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

/** An interval in ms: an integer >= 1000. An invalid value stops the process (never NaN, which setTimeout reads as ~1ms). */
function validIntervalMs(name: string, value: unknown): number {
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < 1000) {
    logger.fatal({ name, value }, `${name} must be an integer number of milliseconds >= 1000`);
    process.exit(1);
  }
  return ms;
}

/** An interval from the environment, or the default. */
function positiveIntervalMs(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : validIntervalMs(name, raw);
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
    // Same eligibility as the per-org monitoring cron (inherited
    // monitoring_agent_enabled, root excluded, has an OrganizationContext).
    const orgIds = await resolveOrganizationIds({ all: true, organizationIds: [] });
    for (const orgId of orgIds) {
      await refreshClientExposureProfile(orgId, 'periodic');
    }
    logger.info({ orgs: orgIds.length }, '[GlobalStart] Periodic profile refresh complete');
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
  const intervalMs =
    args.intervalMs !== undefined
      ? validIntervalMs('--interval', args.intervalMs)
      : positiveIntervalMs('GLOBAL_MONITORING_INTERVAL_MS', 300000);

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
  const profileIntervalMs = positiveIntervalMs('PROFILE_REFRESH_INTERVAL_MS', 60 * 60 * 1000);
  const profileTimer = setInterval(() => {
    void refreshAllProfiles();
  }, profileIntervalMs);
  void refreshAllProfiles();

  // A requested stop (every redeploy sends SIGTERM) exits 0, not as a crash.
  // It first lets the record in flight finish, bounded by SHUTDOWN_GRACE_MS
  // (default 8s, below Docker's default 10s stop timeout; raise both together
  // to drain longer evaluations): killing a Client
  // Monitoring evaluation mid-call wastes a paid LLM call that the retry then
  // pays for again. The global loop's sleep is not waited for.
  const graceMs = positiveIntervalMs('SHUTDOWN_GRACE_MS', 8_000);
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[GlobalStart] Received ${signal}, draining (up to ${graceMs}ms)...`);
    clearInterval(profileTimer);
    stopGlobalMonitoring();
    const grace = new Promise<void>((resolve) => setTimeout(resolve, graceMs).unref());
    void Promise.race([dispatchWorker.stop(), grace]).finally(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  // Start global monitoring loop. It returns only when it gives up (e.g. after
  // repeated failures). Exit non-zero then, so the platform restarts the
  // service: the dispatch worker and timer would otherwise keep a process alive
  // that no longer detects anything.
  await startGlobalMonitoring({ pollingIntervalMs: intervalMs });
  // A requested shutdown also ends the loop: its handler owns the exit (0,
  // after the drain), so do not report it as a crash here.
  if (shuttingDown) return;
  logger.fatal('[GlobalStart] Global monitoring loop stopped; exiting so the service is restarted');
  clearInterval(profileTimer);
  void dispatchWorker.stop();
  process.exit(1);
}

// ============================================================================
// Execute
// ============================================================================

main().catch((error: unknown) => {
  logger.fatal({ error }, '[GlobalStart] Unhandled error');
  process.exit(1);
});
