/**
 * Data Retention Cleanup Job
 *
 * Scheduled job to clean up old data according to retention policies:
 * - EventHash: 7 days (TTL already set, this cleans expired entries)
 * - Event: 90 days (configurable)
 * - MonitoringAuditLog: 30 days (configurable)
 * - MessageQueue (completed): 7 days
 * - KeyValueStore (expired): immediate cleanup
 *
 * Run as a cron job: 0 2 * * * (daily at 2 AM)
 */

import { PrismaClient } from '@prisma/client';
import pino from 'pino';

const logger = pino({
  name: 'data-retention-cleanup',
  level: process.env.LOG_LEVEL || 'info',
});

// Retention periods in days (configurable via env vars)
const RETENTION_CONFIG = {
  eventHashDays: parseInt(process.env.RETENTION_EVENT_HASH_DAYS || '7', 10),
  eventDays: parseInt(process.env.RETENTION_EVENT_DAYS || '90', 10),
  auditLogDays: parseInt(process.env.RETENTION_AUDIT_LOG_DAYS || '30', 10),
  messageQueueDays: parseInt(process.env.RETENTION_MESSAGE_QUEUE_DAYS || '7', 10),
};

interface CleanupResult {
  eventHashes: number;
  events: number;
  auditLogs: number;
  messageQueue: number;
  keyValueStore: number;
  durationMs: number;
}

/**
 * Run data retention cleanup
 */
export async function runDataRetentionCleanup(
  prisma: PrismaClient
): Promise<CleanupResult> {
  const startTime = Date.now();
  const result: CleanupResult = {
    eventHashes: 0,
    events: 0,
    auditLogs: 0,
    messageQueue: 0,
    keyValueStore: 0,
    durationMs: 0,
  };

  logger.info({ config: RETENTION_CONFIG }, 'Starting data retention cleanup');

  try {
    // 1. Clean up expired EventHash entries
    const eventHashCutoff = new Date(
      Date.now() - RETENTION_CONFIG.eventHashDays * 24 * 60 * 60 * 1000
    );
    const eventHashResult = await prisma.eventHash.deleteMany({
      where: {
        OR: [
          { expires_at: { lt: new Date() } },
          { first_seen_at: { lt: eventHashCutoff } },
        ],
      },
    });
    result.eventHashes = eventHashResult.count;
    logger.info({ count: result.eventHashes }, 'Cleaned up expired EventHash entries');

    // 2. Clean up old Events (keep recent ones for analysis)
    const eventCutoff = new Date(
      Date.now() - RETENTION_CONFIG.eventDays * 24 * 60 * 60 * 1000
    );
    // Only delete events that have been validated or rejected (not pending)
    const eventResult = await prisma.event.deleteMany({
      where: {
        created_at: { lt: eventCutoff },
        validation_status: { in: ['validated', 'rejected'] },
      },
    });
    result.events = eventResult.count;
    logger.info({ count: result.events }, 'Cleaned up old Event entries');

    // 3. Clean up old MonitoringAuditLog entries
    const auditLogCutoff = new Date(
      Date.now() - RETENTION_CONFIG.auditLogDays * 24 * 60 * 60 * 1000
    );
    const auditLogResult = await prisma.monitoringAuditLog.deleteMany({
      where: {
        created_at: { lt: auditLogCutoff },
      },
    });
    result.auditLogs = auditLogResult.count;
    logger.info({ count: result.auditLogs }, 'Cleaned up old MonitoringAuditLog entries');

    // 4. Clean up completed/dead-letter MessageQueue entries
    const messageQueueCutoff = new Date(
      Date.now() - RETENTION_CONFIG.messageQueueDays * 24 * 60 * 60 * 1000
    );
    const messageQueueResult = await prisma.messageQueue.deleteMany({
      where: {
        status: { in: ['COMPLETED', 'DEAD_LETTER'] },
        created_at: { lt: messageQueueCutoff },
      },
    });
    result.messageQueue = messageQueueResult.count;
    logger.info({ count: result.messageQueue }, 'Cleaned up old MessageQueue entries');

    // 5. Clean up expired KeyValueStore entries
    const keyValueResult = await prisma.keyValueStore.deleteMany({
      where: {
        expires_at: { lt: new Date() },
      },
    });
    result.keyValueStore = keyValueResult.count;
    logger.info({ count: result.keyValueStore }, 'Cleaned up expired KeyValueStore entries');

  } catch (error) {
    logger.error({ err: error }, 'Data retention cleanup failed');
    throw error;
  }

  result.durationMs = Date.now() - startTime;
  logger.info(
    {
      ...result,
      totalCleaned:
        result.eventHashes +
        result.events +
        result.auditLogs +
        result.messageQueue +
        result.keyValueStore,
    },
    'Data retention cleanup completed'
  );

  return result;
}

/**
 * CLI entry point for running cleanup manually or via cron
 */
async function main() {
  const prisma = new PrismaClient();

  try {
    const result = await runDataRetentionCleanup(prisma);
    console.log('Cleanup completed:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
