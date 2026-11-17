/**
 * Fixture for runService (monitoring/shutdown.ts), which ends in process.exit.
 * Usage: tsx test/fixtures/run-service.ts <gives-up|signal|drain-hangs>
 *   gives-up     loop returns on its own            -> expect exit 1
 *   signal       SIGTERM, drain finishes in 200ms   -> expect exit 0, "drained"
 *   drain-hangs  SIGTERM, drain never finishes      -> expect exit 0 after the grace
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

void runService({
  name: '[Fixture]',
  loop,
  stopLoop: () => {
    stop();
  },
  drain: () =>
    mode === 'drain-hangs'
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
});

if (mode !== 'gives-up') {
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
}
