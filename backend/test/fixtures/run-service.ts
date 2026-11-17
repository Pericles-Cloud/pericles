/**
 * Fixture for runService (monitoring/shutdown.ts), which ends in process.exit.
 * Usage: tsx test/fixtures/run-service.ts <mode>
 *   gives-up          loop returns on its own; drain takes 200ms -> exit 1, "drained"
 *   signal            SIGTERM, drain finishes in 200ms          -> exit 0, "drained"
 *   drain-hangs       SIGTERM, drain never finishes             -> exit 0 after the grace
 *   startup-signal    SIGTERM while start() is still running    -> exit 0, "drained"
 *   double-signal     drain hangs; a second SIGTERM             -> exit 1 at once
 */
import { runService } from '../../src/monitoring/shutdown.js';

const mode = process.argv[2] ?? 'signal';
let stop: () => void = () => undefined;

// Like a real loop, hold the event loop open while running (a real loop's
// sleep timer and the dispatch worker's polling do); without it the process
// would exit on its own before the signal is handled.
const loop = (): Promise<void> =>
  mode === 'gives-up'
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const keepAlive = setInterval(() => undefined, 1000);
        stop = () => {
          clearInterval(keepAlive);
          resolve();
        };
      });

const slowStartup = (): Promise<void> =>
  mode === 'startup-signal' ? new Promise((resolve) => setTimeout(resolve, 500)) : Promise.resolve();

void runService({
  name: '[Fixture]',
  start: async () => {
    await slowStartup();
    return {
    loop: loop(),
    stopLoop: () => {
      stop();
    },
    drain: () =>
      mode === 'drain-hangs' || mode === 'double-signal'
        ? new Promise<void>(() => {
            // Holds the process open, like a stuck in-flight request would.
            setInterval(() => undefined, 1000);
          })
        : new Promise<void>((resolve) =>
            setTimeout(() => {
              console.log('drained');
              resolve();
            }, 200)
          ),
    };
  },
});

if (mode !== 'gives-up') {
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
}
if (mode === 'double-signal') {
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 400);
}
