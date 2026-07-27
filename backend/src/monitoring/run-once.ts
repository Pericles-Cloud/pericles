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

/**
 * Organizations worth a cycle under `--all`.
 *
 * Explicit `--organization-id` is never filtered — if you name an org, you get
 * it. `--all` is filtered, because every id costs a full LLM agent cycle:
 *
 *  - `monitoring_agent_enabled` is the tenant's own switch, exposed in Manage →
 *    Settings. Honouring it is the whole point of the toggle: without this a
 *    tenant who turns monitoring off still gets cycles run and Event rows
 *    written. `loadMonitoringConfig` does not read it, so it must be enforced
 *    here. A missing settings row means defaults, and the column defaults to
 *    true — so absent settings still monitor.
 *  - `is_root` is the @pericles.cloud operator org. It has global read access
 *    but no supply chain of its own, so a cycle for it detects nothing.
 *  - No `OrganizationContext` means no plants, warehouses, suppliers, or lanes
 *    to geo-filter against — the cycle has nothing to correlate events with.
 */
async function resolveOrganizationIds(args: Args): Promise<string[]> {
  if (!args.all) return args.organizationIds;

  const organizations = await getPrismaClient().organization.findMany({
    where: {
      is_root: false,
      context: { isNot: null },
      OR: [
        { settings: { is: null } },
        { settings: { is: { monitoring_agent_enabled: true } } },
      ],
    },
    select: { id: true },
  });
  return organizations.map((org) => org.id);
}

/**
 * Terminate deterministically.
 *
 * Exiting explicitly is required: pooled handles we do not own (the Mastra
 * PostgresStore among them) can keep the event loop alive long after the work
 * is done, and a scheduled task that lingers piles runs up.
 *
 * But outside production the logger writes through a `pino-pretty` worker
 * thread, so a bare `process.exit` drops the very lines that report the
 * outcome. Flush first, bounded so a stuck transport cannot hang the task.
 */
async function shutdown(code: number): Promise<never> {
  await disconnectPrisma().catch(() => undefined);

  await Promise.race([
    new Promise<void>((resolve) => {
      logger.flush(() => {
        resolve();
      });
    }),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    }),
  ]);

  process.exit(code);
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
    await shutdown(1);
  }

  const organizationIds = await resolveOrganizationIds(args);

  if (organizationIds.length === 0) {
    logger.warn('[RunOnce] No organizations to monitor — nothing to do');
    await shutdown(0);
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

  if (failures > 0) {
    logger.error(
      { failures, total: organizationIds.length },
      '[RunOnce] Finished with failures'
    );
    await shutdown(1);
  }

  logger.info({ total: organizationIds.length }, '[RunOnce] All cycles succeeded');
  await shutdown(0);
}

main().catch(async (error: unknown) => {
  logger.fatal({ error }, '[RunOnce] Unhandled error');
  await shutdown(1);
});
