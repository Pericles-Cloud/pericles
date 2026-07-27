/**
 * Fixture: reproduce the production SIGTERM/SIGINT listener ordering.
 *
 * Run-once installs its own signal handlers, then reaches `getPrismaClient()`,
 * which installs a second pair that `process.exit(0)`. Node runs every listener
 * for a signal in registration order, so whether a killed run reports success or
 * failure depends entirely on run-once's handler exiting *synchronously*.
 *
 * A previous implementation deferred through an async helper, which handed
 * control back to the loop and let db-client's `$disconnect().then(exit(0))`
 * settle first — a killed run exited 0 and Coolify recorded it as successful.
 *
 * This fixture wires the real functions in the real order, then signals itself.
 * Exit 1 = run-once's handler won. Exit 0 = the regression is back.
 *
 * Usage: tsx test/fixtures/signal-order.ts <SIGTERM|SIGINT>
 */

import { installSignalHandlers } from '../../src/monitoring/run-once.js';
import { getPrismaClient } from '../../src/monitoring/db-client.js';

const signal = (process.argv[2] ?? 'SIGTERM') as NodeJS.Signals;

installSignalHandlers();

// Registers db-client's competing handlers. Constructing the client does not
// open a connection, so this needs no reachable database.
getPrismaClient();

// Hold the loop open so the process cannot exit for any other reason.
const keepAlive = setInterval(() => undefined, 1000);

process.kill(process.pid, signal);

// If no handler terminates us, fail loudly rather than hanging the test.
setTimeout(() => {
  clearInterval(keepAlive);
  console.error('fixture: no signal handler exited the process');
  process.exit(99);
}, 5000);
