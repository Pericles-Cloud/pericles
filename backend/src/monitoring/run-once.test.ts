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
import type { CycleMetrics } from './metrics.js';
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

/**
 * Minimal stand-in for `organization.findMany` that interprets the same `where`
 * clause the production query builds, so the test exercises the real filter
 * rather than a restatement of it.
 */
function makeClient(orgs: OrgRow[] = ORGS) {
  const findMany = vi.fn(
    ({ where }: { where?: Record<string, unknown> } = {}) => {
      const wantsRootExcluded = where?.is_root === false;
      const wantsContext = where?.context !== undefined;
      const orClause = where?.OR as
        | Array<{ settings: { is: null | { monitoring_agent_enabled: boolean } } }>
        | undefined;

      const matches = orgs.filter((org) => {
        if (wantsRootExcluded && org.is_root) return false;
        if (wantsContext && !org.hasContext) return false;

        if (orClause) {
          const allowsNullSettings = orClause.some((c) => c.settings.is === null);
          const requiredFlag = orClause.find((c) => c.settings.is !== null)?.settings.is;

          if (org.monitoringEnabled === null) return allowsNullSettings;
          if (requiredFlag && typeof requiredFlag !== 'object') return true;
          return org.monitoringEnabled === (requiredFlag as { monitoring_agent_enabled: boolean }).monitoring_agent_enabled;
        }

        return true;
      });

      return Promise.resolve(matches.map((org) => ({ id: org.id })));
    }
  );

  return { client: { organization: { findMany } } as unknown as PrismaClient, findMany };
}

const CONFIG = { organizationId: 'x' } as unknown as MonitoringConfig;

function metrics(overrides: Partial<CycleMetrics> = {}): CycleMetrics {
  return {
    durationMs: 10,
    eventsDetected: 0,
    eventsPublished: 0,
    duplicatesFiltered: 0,
    geographyFiltered: 0,
    severityFiltered: 0,
    toolsExecuted: 3,
    toolsSucceeded: 3,
    toolsFailed: 0,
    errors: [],
    ...overrides,
  } as unknown as CycleMetrics;
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
