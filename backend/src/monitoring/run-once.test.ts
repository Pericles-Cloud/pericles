/**
 * run-once — argument parsing, `--all` org selection, and failure accounting
 * (Vitest, per pericles-testing).
 *
 * This entry point is what the Coolify Scheduled Task invokes, and its exit
 * code is the only signal Coolify records for a run. Two things therefore have
 * to hold, and neither is obvious from reading the code:
 *
 *  1. `--all` must not run a cycle for an org the tenant switched monitoring
 *     off for, for the root operator org, or for an org with no ERP context —
 *     each costs a full LLM cycle.
 *  2. A run must report failure when work did not actually happen, including
 *     the case where the cycle returns normally but every tool inside it failed.
 *
 * Uses an injected fake Prisma client and injected cycle deps; no DB, no OpenAI.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { MonitoringConfig } from './config.js';
import { initializeCycleMetrics, type CycleMetrics } from './metrics.js';
import { parseArgs, resolveOrganizationIds, runCycles, type CycleDeps } from './run-once.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  is_root: boolean;
  hasContext: boolean;
  /** null models an org with no OrganizationSettings row at all. */
  monitoringEnabled: boolean | null;
}

const ORGS: OrgRow[] = [
  { id: 'root', is_root: true, hasContext: true, monitoringEnabled: true },
  { id: 'helios', is_root: false, hasContext: true, monitoringEnabled: true },
  { id: 'sun', is_root: false, hasContext: true, monitoringEnabled: false },
  { id: 'faster', is_root: false, hasContext: false, monitoringEnabled: true },
  { id: 'standex', is_root: false, hasContext: true, monitoringEnabled: null },
];

interface RelationFilter {
  is?: null | Record<string, unknown>;
  isNot?: null;
}

/**
 * Minimal stand-in for `organization.findMany` that interprets the same `where`
 * clause the production query builds, so the test exercises the real filter
 * rather than a restatement of it.
 *
 * It honours the *direction* of each clause — `{ isNot: null }` requires the
 * relation, `{ is: null }` requires its absence — because inverting a filter is
 * a far more likely mistake than deleting one, and an inverted filter selects
 * exactly the wrong tenants while the task stays green.
 *
 * Anything it does not recognise throws. A fake that quietly matches everything
 * when the query shape changes turns a real regression into a green run.
 */
function makeClient(orgs: OrgRow[] = ORGS) {
  const findMany = vi.fn(({ where }: { where?: Record<string, unknown> } = {}) => {
    const known = new Set(['is_root', 'context', 'OR']);
    const unknown = Object.keys(where ?? {}).filter((k) => !known.has(k));
    if (unknown.length > 0) {
      throw new Error(
        `fake findMany: unrecognised where key(s) [${unknown.join(', ')}] — ` +
          'teach the fake this clause rather than letting it match everything'
      );
    }

    /** true = relation must exist, false = must be absent. */
    const requireContext = ((): boolean | undefined => {
      const clause = where?.context as RelationFilter | undefined;
      if (clause === undefined) return undefined;
      if (clause.isNot === null) return true;
      if (clause.is === null) return false;
      throw new Error(`fake findMany: unrecognised context filter ${JSON.stringify(clause)}`);
    })();

    const orClause = where?.OR as Array<{ settings: RelationFilter }> | undefined;

    const matches = orgs.filter((org) => {
      if (where?.is_root !== undefined && org.is_root !== where.is_root) return false;
      if (requireContext !== undefined && org.hasContext !== requireContext) return false;

      if (orClause) {
        const allowsAbsentSettings = orClause.some((c) => c.settings.is === null);
        const flagClause = orClause.find(
          (c) => c.settings.is !== null && c.settings.is !== undefined
        )?.settings.is as { monitoring_agent_enabled?: boolean } | undefined;

        if (org.monitoringEnabled === null) return allowsAbsentSettings;
        if (flagClause?.monitoring_agent_enabled === undefined) {
          throw new Error(
            `fake findMany: unrecognised settings filter ${JSON.stringify(orClause)}`
          );
        }
        return org.monitoringEnabled === flagClause.monitoring_agent_enabled;
      }

      return true;
    });

    return Promise.resolve(matches.map((org) => ({ id: org.id })));
  });

  return { client: { organization: { findMany } } as unknown as PrismaClient, findMany };
}

const CONFIG = { organizationId: 'x' } as unknown as MonitoringConfig;

/**
 * Build metrics from the production initializer rather than a hand-rolled
 * literal, so a new required field on CycleMetrics arrives here with its real
 * default instead of `undefined` behind a cast.
 */
function metrics(overrides: Partial<CycleMetrics> = {}): CycleMetrics {
  return {
    ...initializeCycleMetrics('org-under-test'),
    durationMs: 10,
    toolsExecuted: 3,
    toolsSucceeded: 3,
    ...overrides,
  };
}

function makeDeps(runCycle: CycleDeps['runCycle']): CycleDeps {
  return {
    loadConfig: () => Promise.resolve(CONFIG),
    runCycle,
    overrides: {},
  };
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('recognises --all', () => {
    expect(parseArgs(['--all'])).toEqual({ all: true, organizationIds: [] });
  });

  it('parses a single --organization-id', () => {
    expect(parseArgs(['--organization-id=abc'])).toEqual({
      all: false,
      organizationIds: ['abc'],
    });
  });

  it('splits a comma-separated list and trims whitespace', () => {
    expect(parseArgs(['--organization-id=a, b ,c']).organizationIds).toEqual(['a', 'b', 'c']);
  });

  it('drops empty entries from a trailing or doubled comma', () => {
    expect(parseArgs(['--organization-id=a,,b,']).organizationIds).toEqual(['a', 'b']);
  });

  it('accumulates repeated flags', () => {
    expect(parseArgs(['--organization-id=a', '--organization-id=b']).organizationIds).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns neither flag when given nothing — the caller treats this as a usage error', () => {
    expect(parseArgs([])).toEqual({ all: false, organizationIds: [] });
  });

  it('ignores unknown flags rather than throwing', () => {
    expect(parseArgs(['--verbose', '--all'])).toEqual({ all: true, organizationIds: [] });
  });
});

// ---------------------------------------------------------------------------
// resolveOrganizationIds
// ---------------------------------------------------------------------------

describe('resolveOrganizationIds', () => {
  it('returns the named orgs verbatim without querying, when --all is absent', async () => {
    const { client, findMany } = makeClient();

    const ids = await resolveOrganizationIds({ all: false, organizationIds: ['sun', 'root'] }, client);

    // Explicitly named orgs are never filtered — including ones --all would skip.
    expect(ids).toEqual(['sun', 'root']);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('under --all, skips the root org, context-less orgs, and monitoring-disabled orgs', async () => {
    const { client } = makeClient();

    const ids = await resolveOrganizationIds({ all: true, organizationIds: [] }, client);

    expect(ids).toContain('helios'); // enabled, has context, not root
    expect(ids).not.toContain('root'); // operator org
    expect(ids).not.toContain('sun'); // monitoring_agent_enabled = false
    expect(ids).not.toContain('faster'); // no OrganizationContext
  });

  it('under --all, still monitors an org with no settings row (column defaults to true)', async () => {
    const { client } = makeClient();

    const ids = await resolveOrganizationIds({ all: true, organizationIds: [] }, client);

    expect(ids).toContain('standex');
  });

  it('under --all, requires an OrganizationContext rather than requiring its absence', async () => {
    // Pins the *direction* of the context filter. Inverting it (isNot: null →
    // is: null) selects exactly the wrong set in production — every org that can
    // correlate nothing, and no real tenant — while the task stays green.
    // 'onlyContextless' is chosen so it is the sole match under the inversion.
    const { client } = makeClient([
      { id: 'withContext', is_root: false, hasContext: true, monitoringEnabled: true },
      { id: 'onlyContextless', is_root: false, hasContext: false, monitoringEnabled: true },
    ]);

    const ids = await resolveOrganizationIds({ all: true, organizationIds: [] }, client);

    expect(ids).toEqual(['withContext']);
  });

  it('under --all, excludes the root org rather than selecting only it', async () => {
    const { client } = makeClient([
      { id: 'root', is_root: true, hasContext: true, monitoringEnabled: true },
      { id: 'tenant', is_root: false, hasContext: true, monitoringEnabled: true },
    ]);

    const ids = await resolveOrganizationIds({ all: true, organizationIds: [] }, client);

    expect(ids).toEqual(['tenant']);
  });

  it('under --all, selects monitoring-enabled orgs rather than disabled ones', async () => {
    const { client } = makeClient([
      { id: 'on', is_root: false, hasContext: true, monitoringEnabled: true },
      { id: 'off', is_root: false, hasContext: true, monitoringEnabled: false },
    ]);

    const ids = await resolveOrganizationIds({ all: true, organizationIds: [] }, client);

    expect(ids).toEqual(['on']);
  });

  it('returns an empty list when --all matches nothing', async () => {
    const { client } = makeClient([
      { id: 'root', is_root: true, hasContext: true, monitoringEnabled: true },
    ]);

    expect(await resolveOrganizationIds({ all: true, organizationIds: [] }, client)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runCycles — what the exit code is derived from
// ---------------------------------------------------------------------------

describe('runCycles', () => {
  it('reports no failures when every cycle succeeds', async () => {
    const failures = await runCycles(['a', 'b'], makeDeps(() => Promise.resolve(metrics())));

    expect(failures).toBe(0);
  });

  it('counts a thrown cycle as a failure', async () => {
    const failures = await runCycles(
      ['a'],
      makeDeps(() => Promise.reject(new Error('boom')))
    );

    expect(failures).toBe(1);
  });

  it('keeps going after one org throws, so a bad tenant cannot starve the rest', async () => {
    const seen: string[] = [];
    const deps: CycleDeps = {
      loadConfig: (organizationId) => {
        seen.push(organizationId);
        return Promise.resolve(CONFIG);
      },
      runCycle: () => (seen.length === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(metrics())),
      overrides: {},
    };

    const failures = await runCycles(['a', 'b', 'c'], deps);

    expect(seen).toEqual(['a', 'b', 'c']);
    expect(failures).toBe(1);
  });

  it('counts a cycle where every tool failed as a failure, though it did not throw', async () => {
    // The expired-API-key case: the cycle returns normally, detects nothing,
    // and would otherwise leave the scheduled task green forever.
    const failures = await runCycles(
      ['a'],
      makeDeps(() =>
        Promise.resolve(metrics({ toolsExecuted: 3, toolsSucceeded: 0, toolsFailed: 3 }))
      )
    );

    expect(failures).toBe(1);
  });

  it('does not count a partial tool failure as a failure', async () => {
    const failures = await runCycles(
      ['a'],
      makeDeps(() =>
        Promise.resolve(metrics({ toolsExecuted: 3, toolsSucceeded: 1, toolsFailed: 2 }))
      )
    );

    expect(failures).toBe(0);
  });

  it('does not count a cycle that ran no tools as a failure', async () => {
    // toolsExecuted === 0 means nothing was attempted (e.g. every source
    // disabled), which is not the same as everything failing.
    const failures = await runCycles(
      ['a'],
      makeDeps(() => Promise.resolve(metrics({ toolsExecuted: 0, toolsSucceeded: 0, toolsFailed: 0 })))
    );

    expect(failures).toBe(0);
  });

  it('runs orgs sequentially rather than concurrently', async () => {
    // Concurrency here would fan out to the same rate-limited feeds at once.
    let inFlight = 0;
    let maxInFlight = 0;

    const failures = await runCycles(
      ['a', 'b', 'c'],
      makeDeps(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return metrics();
      })
    );

    expect(maxInFlight).toBe(1);
    expect(failures).toBe(0);
  });

  it('returns zero for an empty org list', async () => {
    const runCycle = vi.fn();

    expect(await runCycles([], makeDeps(runCycle))).toBe(0);
    expect(runCycle).not.toHaveBeenCalled();
  });
});
