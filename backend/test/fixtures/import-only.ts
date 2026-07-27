/**
 * Fixture: importing run-once must not run it.
 *
 * The module is both a script and a unit under test. If the entry-point guard
 * regresses, merely importing it starts a monitoring run and calls
 * process.exit out from under whatever imported it — including the test runner.
 *
 * Prints a marker and exits 0. Any '[RunOnce]' output, or a non-zero exit,
 * means the guard is broken.
 */

import * as runOnce from '../../src/monitoring/run-once.js';

// Touch an export so the import cannot be elided.
if (typeof runOnce.parseArgs !== 'function') {
  console.error('fixture: expected parseArgs to be exported');
  process.exit(98);
}

console.log('IMPORT_OK');
