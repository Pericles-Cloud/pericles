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

export interface ServiceOptions {
  /** Log prefix, e.g. "[GlobalStart]". */
  name: string;
  /** Starts the main loop; resolves when the loop stops. */
  loop: () => Promise<void>;
  /** Stops the main loop (and cuts its sleep short). */
  stopLoop: () => void;
  /** Work to finish before exit, e.g. the dispatch worker's stop(). */
  drain?: () => Promise<void>;
  /** Timers etc. to clear on any exit. */
  cleanup?: () => void;
}

/** Run a service until it is stopped by a signal (exit 0) or its loop gives up (exit 1). */
export async function runService(options: ServiceOptions): Promise<void> {
  const graceMs = shutdownGraceMs();
  let shuttingDown = false;
  let loopDone: Promise<void> = Promise.resolve();

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${options.name} Received ${signal}, draining (up to ${graceMs}ms)...`);
    options.stopLoop();
    options.cleanup?.();
    const grace = new Promise<void>((resolve) => setTimeout(resolve, graceMs).unref());
    const work = Promise.all([loopDone, options.drain?.() ?? Promise.resolve()]).then(() => undefined);
    void Promise.race([work, grace]).finally(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  loopDone = options.loop();
  await loopDone;

  // A requested stop also ends the loop; the signal handler owns that exit.
  if (shuttingDown) return;
  logger.fatal(`${options.name} Loop stopped on its own; exiting so the service is restarted`);
  options.cleanup?.();
  void options.drain?.();
  process.exit(1);
}
