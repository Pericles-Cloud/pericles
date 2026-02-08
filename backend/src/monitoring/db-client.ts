import { PrismaClient } from '@prisma/client';
import { PostgresStore } from '@mastra/pg';

/**
 * Prisma Database Client Singleton
 *
 * Ensures only one Prisma client instance exists throughout the application.
 * Implements graceful disconnect on process termination.
 */

let prisma: PrismaClient;
let postgresStore: PostgresStore;

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
 */
export function getPostgresStore(): PostgresStore {
  if (!postgresStore) {
    const connectionString = process.env.MASTRA_DATABASE_URL;
    if (!connectionString) {
      throw new Error('MASTRA_DATABASE_URL environment variable is required');
    }

    // Enable SSL for production (Neon, Vercel, etc.)
    // In development, SSL is typically not required for local PostgreSQL
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

    postgresStore = new PostgresStore({
      connectionString,
      ssl: isProduction ? { rejectUnauthorized: false } : undefined,
    });
  }
  return postgresStore;
}
