#!/usr/bin/env node

/**
 * Monitoring Agent — single-cycle entry point.
 *
 * Runs ONE monitoring cycle and exits, so an external scheduler owns the
 * cadence. This is what a Coolify **Scheduled Task** invokes; it replaces the
 * deleted Vercel serverless endpoint (`api/monitoring/trigger.ts`) that a
 * Vercel Cron used to poke over HTTP.
 *
 * For continuous sub-minute polling, run `start.ts` as a persistent Coolify
 * service instead — it loops on MONITORING_DEFAULT_INTERVAL_MS (15s default),
 * which no cron schedule can match.
 *
 * Usage (inside the container, WORKDIR /app):
 *   npx tsx src/monitoring/run-once.ts --all
 *   npx tsx src/monitoring/run-once.ts --organization-id=<uuid>[,<uuid>...]
 *
 * Environment Variables:
 *   DATABASE_URL   - PostgreSQL connection string (required)
 *   OPENAI_API_KEY - OpenAI API key (required)
 *   LOG_LEVEL      - debug|info|warn|error (default: info)
 *
 * Exit codes: 0 = every cycle succeeded, 1 = at least one org failed.
 */

import { loadMonitoringConfig, getEnvironmentOverrides } from './config.js';
import { runMonitoringCycle } from './index.js';
import { getPrismaClient, disconnectPrisma } from './db-client.js';
import { logger } from './logger.js';

interface Args {
  organizationIds: string[];
  all: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const result: Args = { organizationIds: [], all: false };

  for (const arg of argv) {
    if (arg === '--all') {
      result.all = true;
    } else if (arg.startsWith('--organization-id=')) {
      result.organizationIds.push(
        ...arg
          .split('=')[1]
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      );
    }
  }

  return result;
}

function validateEnvironment(): void {
  const missing = ['DATABASE_URL', 'OPENAI_API_KEY'].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.fatal({ missing }, 'Missing required environment variables');
    process.exit(1);
  }
}

async function resolveOrganizationIds(args: Args): Promise<string[]> {
  if (!args.all) return args.organizationIds;

  const organizations = await getPrismaClient().organization.findMany({
    select: { id: true },
  });
  return organizations.map((org) => org.id);
}

async function main(): Promise<void> {
  validateEnvironment();

  const args = parseArgs();

  if (!args.all && args.organizationIds.length === 0) {
    logger.fatal(
      'Specify --all or --organization-id=<uuid>\n\nUsage:\n' +
        '  npx tsx src/monitoring/run-once.ts --all\n' +
        '  npx tsx src/monitoring/run-once.ts --organization-id=<uuid>[,<uuid>...]'
    );
    process.exit(1);
  }

  const organizationIds = await resolveOrganizationIds(args);

  if (organizationIds.length === 0) {
    logger.warn('[RunOnce] No organizations to monitor — nothing to do');
    await disconnectPrisma();
    return;
  }

  logger.info({ organizationCount: organizationIds.length }, '[RunOnce] Starting cycle');

  const envOverrides = getEnvironmentOverrides();
  let failures = 0;

  // Sequential on purpose: cycles fan out to the same rate-limited external
  // feeds, so running every tenant concurrently would trip upstream limits.
  for (const organizationId of organizationIds) {
    try {
      const config = await loadMonitoringConfig(organizationId, envOverrides);
      const metrics = await runMonitoringCycle(config);

      logger.info(
        {
          organizationId,
          durationMs: metrics.durationMs,
          eventsDetected: metrics.eventsDetected,
          eventsPublished: metrics.eventsPublished,
          duplicatesFiltered: metrics.duplicatesFiltered,
          toolsSucceeded: metrics.toolsSucceeded,
          toolsFailed: metrics.toolsFailed,
          errorCount: metrics.errors.length,
        },
        '[RunOnce] Cycle complete'
      );
    } catch (error) {
      failures++;
      // Keep going: one tenant's bad config must not starve the others.
      logger.error({ error, organizationId }, '[RunOnce] Cycle failed');
    }
  }

  await disconnectPrisma();

  if (failures > 0) {
    logger.error(
      { failures, total: organizationIds.length },
      '[RunOnce] Finished with failures'
    );
    process.exit(1);
  }

  logger.info({ total: organizationIds.length }, '[RunOnce] All cycles succeeded');
}

main().catch(async (error: unknown) => {
  logger.fatal({ error }, '[RunOnce] Unhandled error');
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
});
