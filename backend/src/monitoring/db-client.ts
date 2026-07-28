import { PrismaClient } from '@prisma/client';
import { PostgresStore } from '@mastra/pg';

/**
 * Prisma Database Client Singleton
 *
 * Ensures only one Prisma client instance exists throughout the application.
 * Implements graceful disconnect on process termination.
 */

let prisma: PrismaClient;
let postgresStore: PostgresStore | null = null;
let postgresStoreInitFailed = false;

/**
 * Get or create Prisma client singleton
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.LOG_LEVEL === 'debug' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });

    // Graceful shutdown handlers
    const disconnect = async () => {
      await prisma.$disconnect();
      process.exit(0);
    };

    process.on('SIGINT', () => void disconnect());
    process.on('SIGTERM', () => void disconnect());
  }

  return prisma;
}

/**
 * Manually disconnect Prisma client (for testing)
 */
export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}

/** sslmode values that mean "do not require SSL". Everything else requires it. */
const NON_SSL_MODES = new Set(['disable', 'allow', 'prefer']);

export interface MastraStoreConfig {
  connectionString: string;
  useSsl: boolean;
}

/**
 * Decide the Mastra PostgresStore connection config. Pure and exported for tests.
 *
 * SSL is driven by the **connection string**, never by `NODE_ENV`. The backend
 * and its Postgres share a private Coolify network and speak plaintext, while a
 * managed Postgres (Neon, RDS, …) carries `sslmode=require` in its URL. The old
 * code forced `sslmode=require` + an `ssl` option whenever `NODE_ENV` was
 * production, which made the store's `init()` fail against the internal DB with
 * "The server does not support SSL connections" — even though Prisma, which
 * respects the URL, connects to the same server fine.
 *
 * The connect/statement/pool timeouts are unrelated to SSL and harmless, so
 * they are always applied (they only set a default when the URL omits one).
 */
export function resolveMastraStoreConfig(rawUrl: string): MastraStoreConfig {
  const url = new URL(rawUrl);

  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '30');
  if (!url.searchParams.has('statement_timeout')) url.searchParams.set('statement_timeout', '30000');
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '30');

  const sslmode = url.searchParams.get('sslmode');
  const useSsl = sslmode !== null && !NON_SSL_MODES.has(sslmode);

  return { connectionString: url.toString(), useSsl };
}

/**
 * Get or create PostgresStore singleton for Mastra
 *
 * Ensures only one PostgresStore instance exists throughout the application
 * to avoid "Creating a duplicate database object" warnings.
 *
 * Returns undefined if storage cannot be initialized, allowing agents to run
 * without persistent storage (stateless mode).
 */
export function getPostgresStore(): PostgresStore | undefined {
  // If we've already tried and failed, don't retry in this process
  if (postgresStoreInitFailed) {
    console.warn('[db-client] PostgresStore initialization previously failed, using stateless mode');
    return undefined;
  }

  if (!postgresStore) {
    const rawUrl = process.env.MASTRA_DATABASE_URL;
    if (!rawUrl) {
      console.warn('[db-client] MASTRA_DATABASE_URL not set, using stateless mode');
      return undefined;
    }

    const { connectionString, useSsl } = resolveMastraStoreConfig(rawUrl);

    try {
      postgresStore = new PostgresStore({
        connectionString,
        // Only pass ssl when the connection string asks for it. Passing it
        // against a plaintext server is the failure this fixes.
        ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
        max: 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 30000,
      });
    } catch (error) {
      console.error('[db-client] Failed to create PostgresStore:', error);
      postgresStoreInitFailed = true;
      return undefined;
    }
  }
  return postgresStore;
}

/**
 * Check if PostgresStore is available
 */
export function isPostgresStoreAvailable(): boolean {
  return postgresStore !== null && !postgresStoreInitFailed;
}
