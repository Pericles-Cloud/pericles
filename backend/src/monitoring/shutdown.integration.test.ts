/**
 * runService lifecycle (monitoring/shutdown.ts) — spawns a real process, since
 * every outcome ends in process.exit.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSX = path.join(BACKEND_ROOT, 'node_modules/.bin/tsx');
const FIXTURE = path.join(BACKEND_ROOT, 'test/fixtures/run-service.ts');
const TIMEOUT = 30_000;

function run(mode: string, env: Record<string, string> = {}): Promise<{ code: number | null; output: string; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(TSX, [FIXTURE, mode], { cwd: BACKEND_ROOT, env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('close', (code) => {
      resolve({ code, output, ms: Date.now() - started });
    });
  });
}

describe('runService', () => {
  it('exits 1 when the loop stops on its own, so the platform restarts the service', async () => {
    const { code, output } = await run('gives-up');
    expect(code).toBe(1);
    expect(output).toContain('Loop stopped on its own');
  }, TIMEOUT);

  it('on SIGTERM waits for the drain, then exits 0', async () => {
    const { code, output } = await run('signal');
    expect(code).toBe(0);
    expect(output).toContain('drained');
  }, TIMEOUT);

  it('bounds a drain that never finishes by SHUTDOWN_GRACE_MS, then exits 0', async () => {
    const { code, ms } = await run('drain-hangs', { SHUTDOWN_GRACE_MS: '1000' });
    expect(code).toBe(0);
    // Exited because the grace ran out (signal at ~100ms + 1000ms grace), not earlier.
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThan(15_000);
  }, TIMEOUT);
});
