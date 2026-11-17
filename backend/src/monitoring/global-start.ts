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
 *   SHUTDOWN_GRACE_MS - Drain time on SIGTERM (default: 7000; keep the stop timeout > it + 2s)
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
import { runService } from './shutdown.js';
import { refreshClientExposureProfile } from './client-exposure-profile.js';
import { startDispatchWorker } from '../workflow/dispatch/dispatch-worker.js';
import { resolveOrganizationIds } from './run-once.js';
import { envMs, validMs } from './durations.js';

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

/** The refresh in flight, if any (shutdown waits for it). */
let refreshInFlight: Promise<void> | null = null;
/** Set on shutdown: the refresh stops before its next org. */
let refreshStopping = false;

/** Refresh every monitoring-enabled customer org's profile, one at a time; never overlaps itself. */
function refreshAllProfiles(): Promise<void> {
  refreshInFlight ??= (async () => {
    try {
      // Same eligibility as the per-org monitoring cron (inherited
      // monitoring_agent_enabled, root excluded, has an OrganizationContext).
      const orgIds = await resolveOrganizationIds({ all: true, organizationIds: [] });
      let done = 0;
      for (const orgId of orgIds) {
        if (refreshStopping) break;
        await refreshClientExposureProfile(orgId, 'periodic');
        done++;
      }
      logger.info({ orgs: orgIds.length, done }, '[GlobalStart] Periodic profile refresh finished');
    } catch (error) {
      logger.error({ error }, '[GlobalStart] Periodic profile refresh failed');
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Shutdown: stop starting new orgs and wait for the one being written. */
function stopProfileRefresh(): Promise<void> {
  refreshStopping = true;
  return refreshInFlight ?? Promise.resolve();
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
      ? validMs('--interval', args.intervalMs)
      : envMs('GLOBAL_MONITORING_INTERVAL_MS', 300000);

  logger.info(
    {
      pollingIntervalMs: intervalMs,
    },
    '[GlobalStart] Configuration loaded'
  );

  // Validated before anything starts.
  const profileIntervalMs = envMs('PROFILE_REFRESH_INTERVAL_MS', 60 * 60 * 1000);

  // Lifecycle: signal handlers first, then startup, so a SIGTERM during
  // startup is not dropped (as PID 1 an unhandled signal is ignored).
  // SIGTERM/SIGINT drain the in-flight cycle and dispatch record (bounded by
  // SHUTDOWN_GRACE_MS) and exit 0; the loop giving up exits 1.
  await runService({
    name: '[GlobalStart]',
    start: () => {
      // The dispatch worker delivers the change records this process emits
      // to client_monitoring (and later Validation). Without it global events
      // never reach any customer (wiki D30).
      const dispatchWorker = startDispatchWorker();

      // Periodic Client Exposure Profile refresh for every monitored org
      // (D29): catches anything the sync triggers (ERP/BOL, Org Memory) missed.
      const profileTimer = setInterval(() => {
        void refreshAllProfiles();
      }, profileIntervalMs);
      void refreshAllProfiles();

      return {
        loop: startGlobalMonitoring({ pollingIntervalMs: intervalMs }),
        stopLoop: stopGlobalMonitoring,
        drain: () => Promise.allSettled([dispatchWorker.stop(), stopProfileRefresh()]),
        cleanup: () => {
          clearInterval(profileTimer);
        },
      };
    },
  });
}

// ============================================================================
// Execute
// ============================================================================

main().catch((error: unknown) => {
  logger.fatal({ error }, '[GlobalStart] Unhandled error');
  process.exit(1);
});
