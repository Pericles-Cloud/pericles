/**
 * Fixture: run-once's signal handler must win against any later listener.
 *
 * Node runs every listener for a signal in registration order, so whether a
 * killed run reports success or failure depends on run-once's handler exiting
 * *synchronously*. An earlier implementation deferred through an async helper,
 * which let a later listener's `exit(0)` settle first (then db-client's, which
 * has since been removed) — a killed run exited 0 and Coolify recorded it as
 * successful.
 *
 * This fixture installs run-once's handlers, then a competing listener that
 * exits 0 asynchronously (what db-client's handler did), then signals itself.
 * Exit 1 = run-once's handler won. Exit 0 = the regression is back.
 *
 * Usage: tsx test/fixtures/signal-order.ts <SIGTERM|SIGINT>
 */

import { installSignalHandlers } from '../../src/monitoring/run-once.js';

const signal = (process.argv[2] ?? 'SIGTERM') as NodeJS.Signals;

installSignalHandlers();

// A later, asynchronous listener that would report success if it got the chance.
process.on(signal, () => {
  void Promise.resolve().then(() => process.exit(0));
});

// Hold the loop open so the process cannot exit for any other reason.
const keepAlive = setInterval(() => undefined, 1000);

process.kill(process.pid, signal);

// If no handler terminates us, fail loudly rather than hanging the test.
setTimeout(() => {
  clearInterval(keepAlive);
  console.error('fixture: no signal handler exited the process');
  process.exit(99);
}, 5000);
