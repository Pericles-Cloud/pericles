/**
 * Lifecycle for the long-running monitoring services (global-start, start.ts).
 *
 * db-client installs no signal handlers, so each service owns its shutdown;
 * this is the one implementation both use:
 * - SIGTERM / SIGINT: stop the loop (its sleep is cut short), then wait for the
 *   cycle and the dispatch record in flight, bounded by SHUTDOWN_GRACE_MS, and
 *   exit 0. Killing a cycle or a Client Monitoring evaluation mid-call wastes
 *   paid LLM calls that the retry then pays for again.
 * - The loop returning on its own (it gave up after repeated failures): exit 1
 *   so the platform restarts the service, instead of a process kept alive by
 *   the dispatch worker or timers that detects nothing.
 */

import { logger } from './logger.js';

const DEFAULT_GRACE_MS = 8_000;

/**
 * Drain time on shutdown (SHUTDOWN_GRACE_MS, default 8s: below Docker's
 * default 10s stop timeout; raise both together to drain longer). An invalid
 * value stops the process at startup rather than silently changing the drain.
 */
export function shutdownGraceMs(): number {
  const raw = process.env.SHUTDOWN_GRACE_MS;
  if (raw === undefined || raw === '') return DEFAULT_GRACE_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1000) {
    logger.fatal({ raw }, 'SHUTDOWN_GRACE_MS must be an integer number of milliseconds >= 1000');
    process.exit(1);
  }
  return value;
}

/** What a service has running once started. */
export interface ServiceParts {
  /** The main loop; resolves when it stops. */
  loop: Promise<void>;
  /** Stops the main loop (its sleep ends at once). */
  stopLoop: () => void;
  /** Work to finish before exit, e.g. the dispatch worker's stop(). */
  drain?: () => Promise<void>;
  /** Timers etc. to clear on any exit. */
  cleanup?: () => void;
}

export interface ServiceOptions {
  /** Log prefix, e.g. "[GlobalStart]". */
  name: string;
  /**
   * Starts everything (workers, timers, the loop). Called AFTER the signal
   * handlers are installed: as PID 1 a process ignores signals it has no
   * handler for, so a SIGTERM during startup would otherwise be dropped.
   */
  start: () => Promise<ServiceParts> | ServiceParts;
}

/** Wait for p, but no longer than ms. */
function bounded(p: Promise<unknown>, ms: number): Promise<void> {
  const grace = new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
  return Promise.race([p.then(() => undefined, () => undefined), grace]);
}

/** Close the shared Prisma client (and its connections) before exit, best effort. */
async function closeDatabase(): Promise<void> {
  try {
    const { getPrismaClient } = await import('./db-client.js');
    await bounded(getPrismaClient().$disconnect(), 2000);
  } catch {
    // Nothing to close, or it failed: exiting anyway.
  }
}

/**
 * Run a service until it is stopped by a signal (exit 0) or its loop gives up
 * (exit 1). A second signal while draining forces an immediate exit 1.
 */
export async function runService(options: ServiceOptions): Promise<void> {
  const graceMs = shutdownGraceMs(); // validated at startup, before any side effect
  let parts: ServiceParts | null = null;
  let shuttingDown = false;

  const finish = async (code: number): Promise<never> => {
    parts?.cleanup?.();
    await bounded(Promise.all([parts?.loop, parts?.drain?.()]), graceMs);
    await closeDatabase();
    process.exit(code);
  };

  const onSignal = (signal: string): void => {
    if (shuttingDown) {
      logger.warn(`${options.name} Received ${signal} again; exiting now`);
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`${options.name} Received ${signal}, draining (up to ${graceMs}ms)...`);
    parts?.stopLoop();
    // If startup is still running, the drain happens once start() returns.
    if (parts) void finish(0);
  };
  process.on('SIGINT', () => {
    onSignal('SIGINT');
  });
  process.on('SIGTERM', () => {
    onSignal('SIGTERM');
  });

  parts = await options.start();
  if (shuttingDown) {
    // A signal arrived during startup: stop what just started and drain.
    parts.stopLoop();
    await finish(0);
  }

  await parts.loop;

  // A requested stop also ends the loop; the signal handler owns that exit.
  if (shuttingDown) return;
  logger.fatal(`${options.name} Loop stopped on its own; exiting so the service is restarted`);
  await finish(1);
}
