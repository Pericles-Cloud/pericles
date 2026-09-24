/**
 * run-once — process-level behaviour (Vitest, per pericles-testing).
 *
 * The exit code is the only signal Coolify records for a Scheduled Task, and
 * everything that determines it — `shutdown`, the signal handlers, `main`'s
 * wiring, the entry-point guard — ends in `process.exit` and cannot be asserted
 * in-process. These spawn the real script and assert on exit codes and output.
 *
 * The SIGTERM/SIGINT cases guard a defect that shipped and was caught in review
 * rather than by the code failing: an async signal handler lost the race to
 * db-client's `exit(0)`, so a killed run reported success. Reinstating that
 * implementation fails those two tests.
 *
 * No database and no OpenAI: DATABASE_URL points at a closed port, and no path
 * exercised here opens a connection.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSX = path.join(BACKEND_ROOT, 'node_modules/.bin/tsx');
const SCRIPT = path.join(BACKEND_ROOT, 'src/monitoring/run-once.ts');
const FIXTURES = path.join(BACKEND_ROOT, 'test/fixtures');

/** Syntactically valid, deliberately unreachable — nothing here should connect. */
const UNREACHABLE_DB = 'postgresql://user:pass@127.0.0.1:1/nodb';

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

function run(
  script: string,
  { args = [], env = {} }: { args?: string[]; env?: Record<string, string | undefined> } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [script, ...args], {
      cwd: BACKEND_ROOT,
      env: {
        // A clean base: inheriting the runner's env would mask missing-var cases.
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'test',
        DATABASE_URL: UNREACHABLE_DB,
        OPENAI_API_KEY: 'test-key',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, output });
    });
  });
}

const TIMEOUT = 45_000;

describe('run-once (process level)', () => {
  it(
    'exits 1 and prints usage when given no target',
    async () => {
      const { code, output } = await run(SCRIPT);

      expect(code).toBe(1);
      expect(output).toContain('--all');
      expect(output).toContain('--organization-id=');
    },
    TIMEOUT
  );

  it(
    'exits 1 and names DATABASE_URL when the global env contract is broken',
    async () => {
      // Asserts the observable contract: a misconfigured task fails loudly with
      // the variable named, rather than a bare exit 1 an operator cannot act on.
      //
      // DATABASE_URL is the only globally required var — AI keys resolve
      // per-org (Secrets Manager first, provider env var as platform fallback).
      const { code, output } = await run(SCRIPT, {
        args: ['--all'],
        env: { DATABASE_URL: undefined },
      });

      expect(code).toBe(1);
      expect(output).toContain('Missing required environment variables');
      expect(output).toContain('DATABASE_URL');
    },
    TIMEOUT
  );

  it(
    'does not gate startup on OPENAI_API_KEY — keys resolve per-org',
    async () => {
      // Regression guard for the per-org key refactor: a global OPENAI key is
      // only the platform fallback. Without it, startup must proceed to org
      // resolution (which fails here on the unreachable DB) instead of dying
      // at env validation — an OpenRouter-only org must not be blocked by a
      // missing OpenAI key.
      const { code, output } = await run(SCRIPT, {
        args: ['--all'],
        env: { OPENAI_API_KEY: undefined },
      });

      expect(code).toBe(1);
      expect(output).not.toContain('Missing required environment variables');
    },
    TIMEOUT
  );

  it(
    'reports failure — not success — when killed by SIGTERM',
    async () => {
      // Regression guard. db-client registers its own SIGTERM handler that
      // exits 0; run-once must exit synchronously so its handler wins. If this
      // returns 0, a run cut short by the task timeout or a redeploy is being
      // recorded as a successful scheduled task.
      const { code, output } = await run(path.join(FIXTURES, 'signal-order.ts'), {
        args: ['SIGTERM'],
      });

      expect(code).toBe(1);
      expect(output).toContain('Terminated before completing');
    },
    TIMEOUT
  );

  it(
    'reports failure when killed by SIGINT',
    async () => {
      const { code } = await run(path.join(FIXTURES, 'signal-order.ts'), { args: ['SIGINT'] });

      expect(code).toBe(1);
    },
    TIMEOUT
  );

  it(
    'does not execute a monitoring run when the module is merely imported',
    async () => {
      // The module is both a script and a unit under test. Without the
      // entry-point guard, importing it starts a run and calls process.exit
      // under whatever imported it — the test runner included.
      const { code, output } = await run(path.join(FIXTURES, 'import-only.ts'));

      expect(code).toBe(0);
      expect(output).toContain('IMPORT_OK');
      expect(output).not.toContain('[RunOnce]');
    },
    TIMEOUT
  );
});
