/**
 * Fixture for runService (monitoring/shutdown.ts), which ends in process.exit.
 * Usage: tsx test/fixtures/run-service.ts <mode>
 *   gives-up          loop returns on its own; drain takes 200ms -> exit 1, "drained"
 *   gives-up-signal   as gives-up, SIGTERM during that drain     -> exit 1 (kept), "drained"
 *   permanent         loop returns, restartable false            -> stays up; SIGTERM at 1500ms -> exit 0
 *   loop-rejects      SIGTERM; loop rejects, drain takes 500ms   -> exit 0, "drained"
 *   signal            SIGTERM, drain finishes in 200ms           -> exit 0, "drained"
 *   drain-hangs       SIGTERM, drain never finishes              -> exit 0 after the grace
 *   startup-signal    SIGTERM while start() is still running     -> exit 0, "drained"
 *   double-signal     drain hangs; a second SIGTERM              -> exit 1 at once
 */
import { runService } from '../../src/monitoring/shutdown.js';

const mode = process.argv[2] ?? 'signal';
const givesUp = mode === 'gives-up' || mode === 'gives-up-signal' || mode === 'permanent';
let stop: () => void = () => undefined;

// Like a real loop, hold the event loop open while running (a real loop's
// sleep timer and the dispatch worker's polling do); without it the process
// would exit on its own before the signal is handled.
const loop = (): Promise<void> =>
  givesUp
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        const keepAlive = setInterval(() => undefined, 1000);
        stop = () => {
          clearInterval(keepAlive);
          if (mode === 'loop-rejects') reject(new Error('loop failed while stopping'));
          else resolve();
        };
      });

const drainMs = mode === 'loop-rejects' ? 500 : 200;

void runService({
  name: '[Fixture]',
  start: async () => {
    if (mode === 'startup-signal') await new Promise((resolve) => setTimeout(resolve, 500));
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
              }, drainMs)
            ),
      restartable: () => mode !== 'permanent',
    };
  },
});

const at = (ms: number): void => {
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), ms);
};
if (!givesUp) at(100);
if (mode === 'double-signal') at(400);
if (mode === 'gives-up-signal') at(50);
if (mode === 'permanent') at(1500);
