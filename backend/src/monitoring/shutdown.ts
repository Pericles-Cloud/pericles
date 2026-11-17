/**
 * Lifecycle for the long-running monitoring services (global-start, start.ts).
 *
 * db-client installs no signal handlers, so each service owns its shutdown;
 * this is the one implementation both use:
 * - SIGTERM / SIGINT: stop the loop (its sleep is cut short), then wait for the
 *   cycle and the dispatch record in flight, bounded by SHUTDOWN_GRACE_MS, and
 *   exit 0. Killing a cycle or a Client Monitoring evaluation mid-call wastes
 *   paid LLM calls that the retry then pays for again.
 * - The loop returning on its own (it gave up after repeated failures): drain
 *   the same way, then exit 1 so the platform restarts the service, instead of
 *   a process kept alive by the dispatch worker or timers that detects
 *   nothing. A service can mark the stop permanent (restartable), in which
 *   case it stays up idle rather than looping through paid restarts.
 * - Any further signal while exiting forces exit 1 at once.
 */

import { disconnectPrisma } from './db-client.js';
import { envMs, withTimeout } from './durations.js';
import { logger } from './logger.js';

const DEFAULT_GRACE_MS = 7_000;
/** Bound on closing the database after the drain. */
const DISCONNECT_MS = 1_000;

/**
 * Drain time on shutdown (SHUTDOWN_GRACE_MS, default 7s). Worst case the
 * process exits after grace + 1s (closing the database): 8s, below Docker's
 * default 10s stop timeout. To drain longer, raise the platform's stop
 * timeout above SHUTDOWN_GRACE_MS + 2s as well. An invalid value stops the
 * process at startup rather than silently changing the drain.
 */
export function shutdownGraceMs(): number {
  return envMs('SHUTDOWN_GRACE_MS', DEFAULT_GRACE_MS);
}

/** What a service has running once started. */
export interface ServiceParts {
  /** The main loop; resolves when it stops. */
  loop: Promise<void>;
  /** Stops the main loop (its sleep ends at once). */
  stopLoop: () => void;
  /** Work to finish before exit, e.g. the dispatch worker's stop(). */
  drain?: () => Promise<unknown>;
  /** Timers etc. to clear on any exit. */
  cleanup?: () => void;
  /**
   * After the loop gave up on its own: true (default) exits 1 so the platform
   * restarts the service. false (a permanent fault, e.g. an invalid key)
   * stays up idle until stopped, since a restart would only repeat the fault
   * and pay for another cycle each time.
   */
  restartable?: () => boolean;
}

export interface ServiceOptions {
  /** Log prefix, e.g. "[GlobalStart]". */
  name: string;
  /**
   * Starts everything (config load, workers, timers, the loop). Called AFTER
   * the signal handlers are installed: as PID 1 a process ignores signals it
   * has no handler for, so a SIGTERM during startup would otherwise be dropped.
   */
  start: () => Promise<ServiceParts> | ServiceParts;
}

/** Close the shared Prisma client, if one was created, best effort and bounded. */
async function closeDatabase(): Promise<void> {
  await withTimeout(disconnectPrisma(), DISCONNECT_MS, 'resolve');
}

/**
 * Run a service until it is stopped by a signal (exit 0) or its loop gives up
 * (exit 1, after draining). Any further signal while exiting forces exit 1.
 */
export async function runService(options: ServiceOptions): Promise<void> {
  const graceMs = shutdownGraceMs(); // validated before start(), i.e. before any side effect
  let parts: ServiceParts | null = null;
  let signalled = false;
  let exiting: Promise<never> | null = null;

  /** The one exit path; runs once (later calls get the same promise). */
  const exit = (code: number): Promise<never> => {
    exiting ??= (async () => {
      parts?.cleanup?.();
      // allSettled: a loop that rejects must not cut the dispatch drain short.
      await withTimeout(Promise.allSettled([parts?.loop, parts?.drain?.()]), graceMs, 'resolve');
      await closeDatabase();
      process.exit(code);
    })();
    return exiting;
  };

  const onSignal = (signal: string): void => {
    if (signalled) {
      logger.warn(`${options.name} Received ${signal} again; exiting now`);
      process.exit(1);
    }
    signalled = true;
    if (exiting) {
      // Already exiting (the loop gave up): let that drain finish, keep its code.
      logger.info(`${options.name} Received ${signal} while exiting; still draining`);
      return;
    }
    logger.info(`${options.name} Received ${signal}, draining (up to ${graceMs}ms)...`);
    if (parts) {
      parts.stopLoop();
      void exit(0);
    }
    // Otherwise start() is still running; the drain follows once it returns.
  };
  process.on('SIGINT', () => {
    onSignal('SIGINT');
  });
  process.on('SIGTERM', () => {
    onSignal('SIGTERM');
  });

  parts = await options.start();
  if (signalled) {
    // A signal arrived during startup: stop what just started and drain.
    parts.stopLoop();
    await exit(0);
  }

  // A loop that rejects is treated like one that returned: it must not escape
  // to the caller's catch-and-exit, which would cut a drain in progress short.
  await parts.loop.catch((error: unknown) => {
    logger.error({ error }, `${options.name} Loop failed`);
  });

  // A requested stop also ends the loop; the signal handler owns that exit.
  if (signalled) return;
  if (parts.restartable?.() === false) {
    logger.fatal(
      `${options.name} Loop stopped on a permanent error; staying up idle (fix the cause, then restart)`
    );
    // The signal handlers stay installed; this keeps the process alive.
    setInterval(() => undefined, 60_000);
    return;
  }
  logger.fatal(`${options.name} Loop stopped on its own; exiting so the service is restarted`);
  await exit(1);
}
