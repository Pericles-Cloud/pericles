/**
 * Wait until every migration shipped in this image is applied (#76).
 *
 * Used by docker-entrypoint.sh for services that do not migrate themselves
 * (the global worker): the API service migrates, the worker waits, so it never
 * runs new code against an unmigrated database and the two never migrate at
 * once.
 *
 * "Applied" = every folder in prisma/migrations has a finished, not rolled
 * back row in _prisma_migrations. Rows the database has that this image does
 * not know about are fine (an older worker image after the API migrated ahead).
 *
 * Exits 0 when ready, 1 after MIGRATION_WAIT_SECONDS of wall-clock time
 * (default 900) so the platform retries. Errors (connection, auth, missing
 * table) are logged on each attempt instead of being reported as "waiting".
 */

import { readdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { withTimeout } from '../monitoring/durations.js';

const MIGRATIONS_DIR = 'prisma/migrations';
const POLL_MS = 5000;
const CHECK_TIMEOUT_MS = 10_000;

function waitLimitSeconds(): number {
  const raw = process.env.MIGRATION_WAIT_SECONDS;
  if (raw === undefined || raw === '') return 900;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`wait-for-migrations: MIGRATION_WAIT_SECONDS must be a positive integer (got '${raw}')`);
    process.exit(1);
  }
  return value;
}

function shippedMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function pending(prisma: PrismaClient, shipped: string[]): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  const applied = new Set(rows.map((row) => row.migration_name));
  return shipped.filter((name) => !applied.has(name));
}

/** Prisma errors span several lines and start with a blank one; keep the informative part. */
function oneLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' | ');
}

/**
 * Errors that will not fix themselves by waiting: fail at once (exit 1).
 * P1000 bad credentials, P1003 database does not exist, P1010 access denied,
 * P1012/P1013 invalid datasource URL. An unreachable host (P1001) is retried:
 * at deploy time the database may still be starting.
 */
const CONFIGURATION_CODES = new Set(['P1000', 'P1003', 'P1010', 'P1012', 'P1013']);
const CONFIGURATION_MESSAGES =
  /Authentication failed|does not exist on the database server|Error validating datasource|must start with the protocol|invalid (database|connection) (url|string)|permission denied/i;

function isConfigurationError(error: unknown, message: string): boolean {
  const code = (error as { errorCode?: unknown; code?: unknown } | null)?.errorCode ?? (error as { code?: unknown } | null)?.code;
  return (typeof code === 'string' && CONFIGURATION_CODES.has(code)) || CONFIGURATION_MESSAGES.test(message);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('wait-for-migrations: DATABASE_URL is not set');
    process.exit(1);
  }
  const deadline = Date.now() + waitLimitSeconds() * 1000;
  const shipped = shippedMigrations();
  const prisma = new PrismaClient();
  try {
    for (;;) {
      try {
        // Each check is capped (10s, or what is left of the deadline): a hung
        // check is abandoned and retried, so a database that recovers is seen.
        const missing = await withTimeout(
          pending(prisma, shipped),
          Math.max(1000, Math.min(CHECK_TIMEOUT_MS, deadline - Date.now())),
          'reject'
        );
        if (missing.length === 0) {
          console.log(`wait-for-migrations: all ${shipped.length} migrations applied`);
          process.exitCode = 0;
          return;
        }
        console.log(`wait-for-migrations: waiting for ${missing.length} migration(s): ${missing.join(', ')}`);
      } catch (error) {
        const message = oneLine(error);
        if (/42P01|_prisma_migrations.*does not exist|relation .* does not exist/i.test(message)) {
          // A fresh database: no migration table yet, so nothing is applied.
          console.log(`wait-for-migrations: waiting for ${shipped.length} migration(s): none applied yet`);
        } else if (isConfigurationError(error, message)) {
          console.error(`wait-for-migrations: configuration error, not retrying: ${message}`);
          process.exitCode = 1;
          return;
        } else {
          console.error(`wait-for-migrations: check failed (will retry): ${message}`);
        }
      }
      if (Date.now() >= deadline) {
        console.error('wait-for-migrations: schema still not up to date; exiting so the platform retries');
        // Exit now: a hung query would also keep $disconnect() from settling.
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    // Bounded, then exit explicitly: a check abandoned on its timeout can
    // still hold a connection, which would keep $disconnect() (and so this
    // process, and the service waiting on it) from ever finishing.
    await withTimeout(prisma.$disconnect(), 2000, 'resolve');
    process.exit(process.exitCode ?? 0);
  }
}

void main();
