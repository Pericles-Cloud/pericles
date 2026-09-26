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
 *   LOG_LEVEL      - debug|info|warn|error (default: info)
 *
 * Tenant AI calls never read the environment: each org's provider/key resolves
 * from its own AI + Secrets settings (org.<provider>_api_key). An org with no
 * key is skipped with a per-org WARN log — it is a configuration state, not a
 * failure. (Exception: the agent's scorer judges still run on the platform
 * OPENAI_API_KEY — keep it set, known gap.)
 *
 * Exit codes: 0 = every cycle succeeded (skips are logged, not failures),
 * 1 = at least one org failed.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { loadMonitoringConfig, getEnvironmentOverrides, type MonitoringConfig } from './config.js';
import { runMonitoringCycle } from './index.js';
import type { CycleMetrics } from './metrics.js';
import { getPrismaClient, disconnectPrisma } from './db-client.js';
import { logger } from './logger.js';

export interface Args {
  organizationIds: string[];
  all: boolean;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): Args {
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

async function validateEnvironment(): Promise<void> {
  // Only DATABASE_URL is global. The AI key is resolved PER ORG from its
  // Secrets Manager entries (org.<provider>_api_key) with NO env fallback —
  // requiring OPENAI_API_KEY here would block every OpenRouter-configured
  // org on a key they never use, and an org without a key is skipped per
  // cycle rather than failing the whole run.
  const missing = ['DATABASE_URL'].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.fatal({ missing }, 'Missing required environment variables');
    // via shutdown(), so the reason survives the pino-pretty worker
    await shutdown(1);
  }
}

/**
 * Report a killed run as a failure.
 *
 * `getPrismaClient()` registers its own SIGINT/SIGTERM handlers that
 * `process.exit(0)` (db-client.ts). Since the exit code is what Coolify records
 * for the scheduled task, a run cut short by the task timeout or a redeploy
 * would otherwise be logged as a success while most orgs never ran.
 *
 * This must exit **synchronously**. Node runs every listener for a signal in
 * registration order, and ours is registered before the first
 * `getPrismaClient()` call — but only a synchronous `process.exit` stops the
 * chain there. Deferring through an async helper hands control back to the
 * loop, db-client's handler runs, and its `$disconnect().then(exit(0))` settles
 * first — reinstating the exact false success this guards against.
 *
 * The cost is no log flush on the way out. In the container that is free
 * (NODE_ENV=production, so pino writes synchronously); locally the line may be
 * clipped. Reporting the right exit code matters more.
 */
export function installSignalHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      logger.error({ signal }, '[RunOnce] Terminated before completing — reporting failure');
      process.exit(1);
    });
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
 *    true — so absent settings still monitor. For an INHERITED child the
 *    switch that counts is its settings OWNER's (walked up the parent chain,
 *    stopping at a non-root top-level org, one with custom settings, or the
 *    Pericles root boundary) — the child's own row is not authoritative while
 *    inherited, and a direct child of Pericles always uses its own.
 *  - `is_root` is the @pericles.cloud operator org (Pericles, Inc.), the
 *    manager of all organizations. It is NEVER a cycle candidate: it has no
 *    supply chain of its own, and customer settings never inherit from it.
 *    Root or context-less orgs may still be PARENTS, so every org is fetched
 *    and the chain walk can see them; the walk stops at root as a boundary.
 *  - No `OrganizationContext` means no plants, warehouses, suppliers, or lanes
 *    to geo-filter against — the cycle has nothing to correlate events with.
 *
 * `client` is injectable for tests; it defaults to the module Prisma client.
 */
export async function resolveOrganizationIds(
  args: Args,
  client?: PrismaClient
): Promise<string[]> {
  // Resolved after the early return, not as a default parameter: defaults are
  // evaluated before the body, which would construct a Prisma client (and
  // register db-client's signal handlers) even for a named-org run that never
  // queries.
  if (!args.all) return args.organizationIds;

  const organizations = await (client ?? getPrismaClient()).organization.findMany({
    select: {
      id: true,
      is_root: true,
      parent_organization_id: true,
      custom_settings_enabled: true,
      context: { select: { id: true } },
      settings: { select: { monitoring_agent_enabled: true } },
    },
  });

  const byId = new Map(organizations.map((org) => [org.id, org]));

  // Effective monitoring_agent_enabled for one org, walking the settings
  // chain. Mirrors organizations/settings-resolution.ts but works off the
  // already-fetched rows instead of re-querying per org. The root org is a
  // boundary, not an owner: a direct child of Pericles keeps its own flag.
  const monitoringEnabled = (startId: string): boolean => {
    const seen = new Set<string>();
    let id = startId;
    for (;;) {
      const org = byId.get(id);
      if (!org || seen.has(id)) return true; // unknown id or cycle → default on
      seen.add(id);
      if (!org.parent_organization_id) {
        return org.settings?.monitoring_agent_enabled ?? true;
      }
      const ownsConfig =
        org.custom_settings_enabled ||
        !byId.has(org.parent_organization_id) || // dangling parent → stop here
        byId.get(org.parent_organization_id)?.is_root === true; // Pericles boundary
      if (ownsConfig) return org.settings?.monitoring_agent_enabled ?? true;
      id = org.parent_organization_id;
    }
  };

  return organizations
    .filter((org) => !org.is_root && org.context && monitoringEnabled(org.id))
    .map((org) => org.id);
}

export interface CycleDeps {
  loadConfig: (
    organizationId: string,
    overrides: Partial<MonitoringConfig>
  ) => Promise<MonitoringConfig>;
  runCycle: (config: MonitoringConfig) => Promise<CycleMetrics>;
  overrides: Partial<MonitoringConfig>;
}

export interface CycleSummary {
  /** Orgs whose cycle ran but reported failure (or every tool failed). */
  failures: number;
  /** Orgs skipped because no API key is configured for their provider. */
  skipped: number;
}

/**
 * Run one cycle per organization; return how many failed vs. were skipped.
 *
 * Sequential on purpose: cycles fan out to the same rate-limited external
 * feeds, so running every tenant concurrently would trip upstream limits.
 *
 * MissingApiKeyError is a skip, not a failure: a tenant that has not brought
 * a key yet is a known configuration state. It is logged per org (WARN) so
 * the run never goes silently green, and counted separately from cycles that
 * actually ran and broke.
 *
 * `deps` is injectable for tests — the real ones reach OpenAI and every
 * monitoring feed.
 */
export async function runCycles(
  organizationIds: string[],
  deps: CycleDeps = {
    loadConfig: loadMonitoringConfig,
    runCycle: runMonitoringCycle,
    overrides: getEnvironmentOverrides(),
  }
): Promise<CycleSummary> {
  let failures = 0;
  let skipped = 0;

  for (const organizationId of organizationIds) {
    try {
      const config = await deps.loadConfig(organizationId, deps.overrides);
      const metrics = await deps.runCycle(config);

      // A cycle only throws on a hard error; per-tool failures are collected
      // into the metrics. If every tool that ran failed, the cycle detected
      // nothing and is a failure in substance — an expired feed API key would
      // otherwise leave the scheduled task green forever.
      if (metrics.toolsExecuted > 0 && metrics.toolsSucceeded === 0) {
        failures++;
        logger.error(
          {
            organizationId,
            toolsExecuted: metrics.toolsExecuted,
            toolsFailed: metrics.toolsFailed,
            errors: metrics.errors,
          },
          '[RunOnce] Every tool failed — treating cycle as failed'
        );
        continue;
      }

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
      // Skip (not fail) orgs that have no key for their provider — the fix
      // is configuration, not code. Keep going either way: one tenant's bad
      // config must not starve the others.
      if ((error as Error)?.name === 'MissingApiKeyError') {
        skipped++;
        logger.warn(
          { organizationId, reason: (error as Error).message },
          '[RunOnce] Skipped cycle — no API key configured for org'
        );
        continue;
      }
      failures++;
      logger.error({ error, organizationId }, '[RunOnce] Cycle failed');
    }
  }

  return { failures, skipped };
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
  installSignalHandlers();
  await validateEnvironment();

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
    logger.error(
      '[RunOnce] No organizations eligible for monitoring — check OrganizationContext exists and monitoring_agent_enabled is not false in OrganizationSettings'
    );
    await shutdown(1);
  }

  logger.info({ organizationCount: organizationIds.length }, '[RunOnce] Starting cycle');

  const { failures, skipped } = await runCycles(organizationIds);

  if (failures > 0) {
    logger.error(
      { failures, skipped, total: organizationIds.length },
      '[RunOnce] Finished with failures'
    );
    await shutdown(1);
  }

  if (skipped > 0) {
    // Skips are configuration, not faults: exit 0 so a tenant without a key
    // does not page anyone, but log at WARN with the count so a run that did
    // no work is never indistinguishable from a run that succeeded.
    logger.warn(
      { skipped, total: organizationIds.length },
      '[RunOnce] Finished — organizations skipped (no API key configured)'
    );
    await shutdown(0);
  }

  logger.info({ total: organizationIds.length }, '[RunOnce] All cycles succeeded');
  await shutdown(0);
}

// Only run when invoked as a script. Importing this module (tests) must not
// kick off a monitoring run or call process.exit out from under the runner.
//
// `import.meta.url` is realpath-resolved but argv[1] is not, so the comparison
// must resolve symlinks too. Otherwise invoking through a symlinked path makes
// this false, main() never runs, and the process exits 0 having done nothing —
// a green scheduled task with no log line at all, which is the worst shape of
// the false success this file exists to prevent.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
})();

if (invokedDirectly) {
  main().catch(async (error: unknown) => {
    logger.fatal({ error }, '[RunOnce] Unhandled error');
    await shutdown(1);
  });
}
