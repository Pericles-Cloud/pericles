/**
 * Message Queue Client (PostgreSQL-based)
 *
 * Interface for publishing events to message queues using PostgreSQL.
 * Replaces Redis with a durable PostgreSQL-backed queue.
 *
 * Used for:
 * - Emitting events to downstream consumers
 * - Triggering notifications
 * - Inter-agent communication
 */

import { logger } from './logger.js';
import { getPrismaClient } from './db-client.js';

export interface QueueMessage {
  type: 'event' | 'incident' | 'notification';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic payload supports any message type
  payload: any;
  timestamp: string;
  organizationId: string;
}

/**
 * Publish message to queue (PostgreSQL-backed)
 *
 * @param queueName - Target queue name
 * @param message - Message to publish
 */
export async function publishToQueue(queueName: string, message: QueueMessage): Promise<void> {
  const prisma = getPrismaClient();

  try {
    await prisma.messageQueue.create({
      data: {
        queue_name: queueName,
        message_type: message.type,
        organization_id: message.organizationId,
        payload: message.payload,
        scheduled_at: new Date(message.timestamp),
      },
    });

    logger.debug(
      {
        queueName,
        messageType: message.type,
        organizationId: message.organizationId,
      },
      '[Queue] Message published to PostgreSQL'
    );
  } catch (error) {
    logger.error(
      {
        queueName,
        messageType: message.type,
        organizationId: message.organizationId,
        error,
      },
      '[Queue] Failed to publish message'
    );
    // Don't throw - queue publishing should not block main operations
  }
}

/**
 * Publish batch of messages to queue
 */
export async function publishBatchToQueue(queueName: string, messages: QueueMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const prisma = getPrismaClient();

  try {
    await prisma.messageQueue.createMany({
      data: messages.map((message) => ({
        queue_name: queueName,
        message_type: message.type,
        organization_id: message.organizationId,
        payload: message.payload,
        scheduled_at: new Date(message.timestamp),
      })),
    });

    logger.debug(
      {
        queueName,
        count: messages.length,
        organizationId: messages[0]?.organizationId,
      },
      '[Queue] Batch messages published to PostgreSQL'
    );
  } catch (error) {
    logger.error(
      {
        queueName,
        count: messages.length,
        error,
      },
      '[Queue] Failed to publish batch messages'
    );
  }
}

/**
 * Consume messages from queue (for worker processes)
 *
 * @param queueName - Queue to consume from
 * @param handler - Message handler function
 * @param options - Consumer options
 */
export function consumeFromQueue(
  queueName: string,
   
  handler: (message: QueueMessage) => Promise<void>,
  options: { batchSize?: number; pollIntervalMs?: number } = {}
): { stop: () => void } {
  const { batchSize = 10, pollIntervalMs = 1000 } = options;
  const prisma = getPrismaClient();
  let running = true;

  const poll = async () => {
    while (running) {
      try {
        // Fetch pending messages
        const messages = await prisma.messageQueue.findMany({
          where: {
            queue_name: queueName,
            status: 'PENDING',
            scheduled_at: { lte: new Date() },
          },
          take: batchSize,
          orderBy: { scheduled_at: 'asc' },
        });

        for (const msg of messages) {
          // Mark as processing
          await prisma.messageQueue.update({
            where: { id: msg.id },
            data: { status: 'PROCESSING', attempts: { increment: 1 } },
          });

          try {
            await handler({
              type: msg.message_type as QueueMessage['type'],
              payload: msg.payload,
              timestamp: msg.scheduled_at.toISOString(),
              organizationId: msg.organization_id || '',
            });

            // Mark as completed
            await prisma.messageQueue.update({
              where: { id: msg.id },
              data: { status: 'COMPLETED', processed_at: new Date() },
            });
          } catch (error) {
            const attempts = msg.attempts + 1;
            const status = attempts >= msg.max_attempts ? 'DEAD_LETTER' : 'PENDING';

            await prisma.messageQueue.update({
              where: { id: msg.id },
              data: {
                status,
                failed_at: new Date(),
                error_message: (error as Error).message,
              },
            });

            logger.error(
              {
                queueName,
                messageId: msg.id,
                attempts,
                error,
              },
              '[Queue] Message processing failed'
            );
          }
        }
      } catch (error) {
        logger.error({ queueName, error }, '[Queue] Poll error');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  };

  // Start polling in background
  void poll();

  return {
    stop: () => {
      running = false;
    },
  };
}

// ============================================================================
// Key-Value Store Operations (PostgreSQL-backed)
// ============================================================================

/**
 * Set a key-value pair
 */
export async function kvSet(
  key: string,
  value: unknown,
  options: { namespace?: string; organizationId?: string; ttlSeconds?: number } = {}
): Promise<void> {
  const { namespace = 'default', organizationId, ttlSeconds } = options;
  const prisma = getPrismaClient();

  const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;

  // Use type assertion for compound unique key where Prisma expects string
  // but we need to pass null for global keys
  const orgId = (organizationId ?? null)!;

  await prisma.keyValueStore.upsert({
    where: {
      organization_id_namespace_key: {
        organization_id: orgId,
        namespace,
        key,
      },
    },
    create: {
      organization_id: orgId,
      namespace,
      key,
      value: value as object,
      expires_at: expiresAt,
    },
    update: {
      value: value as object,
      expires_at: expiresAt,
    },
  });
}

/**
 * Get a value by key
 */
export async function kvGet<T = unknown>(
  key: string,
  options: { namespace?: string; organizationId?: string } = {}
): Promise<T | null> {
  const { namespace = 'default', organizationId } = options;
  const prisma = getPrismaClient();
  // Use type assertion for compound unique key where Prisma expects string
  const orgId = (organizationId ?? null)!;

  const record = await prisma.keyValueStore.findUnique({
    where: {
      organization_id_namespace_key: {
        organization_id: orgId,
        namespace,
        key,
      },
    },
  });

  // Check if expired
  if (record?.expires_at && record.expires_at < new Date()) {
    // Delete expired record
    await prisma.keyValueStore.delete({
      where: { id: record.id },
    }).catch(() => { /* ignore if already deleted */ });
    return null;
  }

  return record?.value as T | null;
}

/**
 * Delete a key
 */
export async function kvDelete(
  key: string,
  options: { namespace?: string; organizationId?: string } = {}
): Promise<boolean> {
  const { namespace = 'default', organizationId } = options;
  const prisma = getPrismaClient();
  // Use type assertion for compound unique key where Prisma expects string
  const orgId = (organizationId ?? null)!;

  try {
    await prisma.keyValueStore.delete({
      where: {
        organization_id_namespace_key: {
          organization_id: orgId,
          namespace,
          key,
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up expired keys (run periodically)
 */
export async function kvCleanupExpired(): Promise<number> {
  const prisma = getPrismaClient();

  const result = await prisma.keyValueStore.deleteMany({
    where: {
      expires_at: { lt: new Date() },
    },
  });

  if (result.count > 0) {
    logger.info({ count: result.count }, '[KV] Cleaned up expired keys');
  }

  return result.count;
}
