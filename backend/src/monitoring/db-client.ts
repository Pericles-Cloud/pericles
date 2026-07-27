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

/**
 * Get or create PostgresStore singleton for Mastra
 *
 * Ensures only one PostgresStore instance exists throughout the application
 * to avoid "Creating a duplicate database object" warnings.
 *
 * In serverless environments, storage initialization may fail due to cold start timeouts.
 * The function will return null if storage cannot be initialized, allowing agents to
 * run without persistent storage (stateless mode).
 */
export function getPostgresStore(): PostgresStore | undefined {
  // If we've already tried and failed, don't retry in this process
  if (postgresStoreInitFailed) {
    console.warn('[db-client] PostgresStore initialization previously failed, using stateless mode');
    return undefined;
  }

  if (!postgresStore) {
    let connectionString = process.env.MASTRA_DATABASE_URL;
    if (!connectionString) {
      console.warn('[db-client] MASTRA_DATABASE_URL not set, using stateless mode');
      return undefined;
    }

    // Enable SSL for production (hosted Postgres). In development, SSL is
    // typically not required for local PostgreSQL. (The VERCEL=1 arm went with
    // the serverless deploy — the backend is a Coolify container now, where
    // NODE_ENV=production is set in the image.)
    const isProduction = process.env.NODE_ENV === 'production';

    // Generous connect timeout so a cold/held-up database doesn't fail the boot
    if (isProduction) {
      const url = new URL(connectionString);
      // Set connect_timeout to 30 seconds for cold starts
      if (!url.searchParams.has('connect_timeout')) {
        url.searchParams.set('connect_timeout', '30');
      }
      // Set statement_timeout to prevent long-running queries
      if (!url.searchParams.has('statement_timeout')) {
        url.searchParams.set('statement_timeout', '30000'); // 30 seconds
      }
      // Ensure sslmode is set
      if (!url.searchParams.has('sslmode')) {
        url.searchParams.set('sslmode', 'require');
      }
      // Add pool settings for serverless
      if (!url.searchParams.has('pool_timeout')) {
        url.searchParams.set('pool_timeout', '30');
      }
      connectionString = url.toString();
    }

    try {
      postgresStore = new PostgresStore({
        connectionString,
        ssl: isProduction ? { rejectUnauthorized: false } : undefined,
        // Increase connection pool settings for serverless
        ...(isProduction ? {
          max: 1, // Limit connections in serverless
          idleTimeoutMillis: 10000, // Release idle connections quickly
          connectionTimeoutMillis: 30000, // 30s connection timeout
        } : {}),
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
