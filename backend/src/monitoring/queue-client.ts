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
 * - Change records dispatched by the workflow engine (Doctrine §13)
 *
 * Delivery is at least once. Publishing with an idempotency key is a no-op when
 * the key is already queued. Consumers claim rows atomically (SKIP LOCKED), back
 * off between retries, and dead-letter after max_attempts.
 */

import { hostname } from 'node:os';
import type { Prisma } from '@prisma/client';
import { logger } from './logger.js';
import { getPrismaClient } from './db-client.js';

export const CHANGE_RECORD_QUEUE = 'change-records';

export interface QueueMessage {
  type: 'event' | 'incident' | 'notification' | 'change_record';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic payload supports any message type
  payload: any;
  timestamp: string;
  organizationId: string;
}

export interface PublishOptions {
  /** Rows with the same (queue, key) are stored once. Use record_id:record_version. */
  idempotencyKey?: string;
  /** Rethrow publish errors instead of logging them. Use when the caller must fail with the publish. */
  required?: boolean;
}

export interface PublishResult {
  /** True when an existing row already held the idempotency key. */
  deduplicated: boolean;
}

/** A message that can never succeed. It goes straight to DEAD_LETTER and is not retried. */
export class PermanentMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentMessageError';
  }
}

function toRow(queueName: string, message: QueueMessage, idempotencyKey?: string) {
  return {
    queue_name: queueName,
    message_type: message.type,
    organization_id: message.organizationId,
    payload: message.payload,
    scheduled_at: new Date(message.timestamp),
    idempotency_key: idempotencyKey ?? null,
  };
}

/**
 * Publish message to queue (PostgreSQL-backed)
 *
 * By default a publish error is logged and not thrown, so queue trouble does not
 * block the caller. Pass `required: true` to rethrow.
 *
 * @param queueName - Target queue name
 * @param message - Message to publish
 * @param options - Idempotency key and error behavior
 */
export async function publishToQueue(
  queueName: string,
  message: QueueMessage,
  options: PublishOptions = {}
): Promise<PublishResult> {
  const prisma = getPrismaClient();

  try {
    // createMany + skipDuplicates (ON CONFLICT DO NOTHING) instead of create + P2002:
    // a unique violation inside a Postgres transaction aborts that transaction.
    const { count } = await prisma.messageQueue.createMany({
      data: [toRow(queueName, message, options.idempotencyKey)],
      skipDuplicates: true,
    });

    logger.debug(
      {
        queueName,
        messageType: message.type,
        organizationId: message.organizationId,
      },
      '[Queue] Message published to PostgreSQL'
    );

    return { deduplicated: count === 0 };
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
    if (options.required) throw error;
    return { deduplicated: false };
  }
}

/**
 * Enqueue a message inside an existing Prisma transaction.
 *
 * Use this when the message describes a row written in the same transaction.
 * The row and its message commit together. An error here is always thrown, so
 * the transaction rolls back and the row is not written without its message.
 */
export async function enqueueInTransaction(
  tx: Prisma.TransactionClient,
  queueName: string,
  message: QueueMessage,
  options: { idempotencyKey?: string } = {}
): Promise<PublishResult> {
  const { count } = await tx.messageQueue.createMany({
    data: [toRow(queueName, message, options.idempotencyKey)],
    skipDuplicates: true,
  });
  return { deduplicated: count === 0 };
}

/**
 * Publish batch of messages to queue
 */
export async function publishBatchToQueue(queueName: string, messages: QueueMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const prisma = getPrismaClient();

  try {
    await prisma.messageQueue.createMany({
      data: messages.map((message) => toRow(queueName, message)),
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

// ============================================================================
// Claim, retry, and dead-letter
// ============================================================================

/** A claimed row lock older than this is treated as abandoned by its worker. */
export const STALE_LOCK_SECONDS = 300;

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Delay before the next retry, after `attempts` failed tries.
 * Exponential from 1s, capped at 60s, with up to 20% jitter. `random` is injectable for tests.
 */
export function computeBackoffMs(attempts: number, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(exponential * 0.2 * random());
  return Math.min(MAX_BACKOFF_MS, exponential + jitter);
}

export interface ClaimedMessage {
  id: string;
  queue_name: string;
  message_type: string;
  organization_id: string | null;
  payload: Prisma.JsonValue;
  attempts: number;
  max_attempts: number;
  scheduled_at: Date;
}

/** Stable identity for this worker process, recorded on each claimed row. */
export function workerIdentity(): string {
  return `${hostname()}:${process.pid}`;
}

/**
 * Atomically claim up to `limit` due messages for this worker.
 *
 * `FOR UPDATE SKIP LOCKED` lets concurrent workers claim disjoint rows without
 * blocking. A PROCESSING row whose lock is older than STALE_LOCK_SECONDS is
 * reclaimed, so a crashed worker cannot strand a message.
 */
export async function claimNextBatch(
  queueName: string,
  limit: number,
  workerId: string,
  prisma = getPrismaClient()
): Promise<ClaimedMessage[]> {
  return prisma.$queryRaw<ClaimedMessage[]>`
    UPDATE "MessageQueue"
    SET status = 'PROCESSING'::"MessageStatus",
        locked_at = now(),
        locked_by = ${workerId},
        attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "MessageQueue"
      WHERE queue_name = ${queueName}
        AND attempts < max_attempts
        AND (
          (status = 'PENDING'::"MessageStatus" AND scheduled_at <= now())
          OR (
            status = 'PROCESSING'::"MessageStatus"
            AND locked_at < now() - make_interval(secs => ${STALE_LOCK_SECONDS})
          )
        )
      ORDER BY scheduled_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, queue_name, message_type, organization_id, payload,
              attempts, max_attempts, scheduled_at
  `;
}

/**
 * Dead-letter PROCESSING rows whose lock expired after their final attempt.
 * claimNextBatch never reclaims these, so without this sweep they would stay stuck.
 */
export async function sweepExhaustedLocks(queueName: string, prisma = getPrismaClient()): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "MessageQueue"
    SET status = 'DEAD_LETTER'::"MessageStatus",
        failed_at = now(),
        error_message = 'lock expired after final attempt',
        locked_at = NULL,
        locked_by = NULL
    WHERE queue_name = ${queueName}
      AND status = 'PROCESSING'::"MessageStatus"
      AND attempts >= max_attempts
      AND locked_at < now() - make_interval(secs => ${STALE_LOCK_SECONDS})
  `;
}

export async function completeMessage(id: string, prisma = getPrismaClient()): Promise<void> {
  await prisma.messageQueue.update({
    where: { id },
    data: { status: 'COMPLETED', processed_at: new Date(), locked_at: null, locked_by: null },
  });
}

/**
 * Record a failed attempt. A permanent error or an exhausted attempt budget goes
 * to DEAD_LETTER. Otherwise the row returns to PENDING after an exponential delay.
 */
export async function failMessage(
  row: Pick<ClaimedMessage, 'id' | 'attempts' | 'max_attempts'>,
  error: unknown,
  prisma = getPrismaClient()
): Promise<'retry' | 'dead_letter'> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const permanent = error instanceof PermanentMessageError;
  const exhausted = permanent || row.attempts >= row.max_attempts;

  if (exhausted) {
    await prisma.messageQueue.update({
      where: { id: row.id },
      data: {
        status: 'DEAD_LETTER',
        failed_at: new Date(),
        error_message: errorMessage,
        locked_at: null,
        locked_by: null,
      },
    });
    return 'dead_letter';
  }

  await prisma.messageQueue.update({
    where: { id: row.id },
    data: {
      status: 'PENDING',
      scheduled_at: new Date(Date.now() + computeBackoffMs(row.attempts)),
      failed_at: new Date(),
      error_message: errorMessage,
      locked_at: null,
      locked_by: null,
    },
  });
  return 'retry';
}

/**
 * Consume messages from queue (for worker processes)
 *
 * Each handler gets the row id and attempt number as its second argument. A
 * handler that throws is retried with backoff. A PermanentMessageError goes
 * straight to DEAD_LETTER.
 *
 * @param queueName - Queue to consume from
 * @param handler - Message handler function
 * @param options - Consumer options
 */
export function consumeFromQueue(
  queueName: string,
  handler: (message: QueueMessage, ctx: { id: string; attempts: number }) => Promise<void>,
  options: { batchSize?: number; pollIntervalMs?: number } = {}
): { stop: () => void } {
  const { batchSize = 10, pollIntervalMs = 1000 } = options;
  const prisma = getPrismaClient();
  const workerId = workerIdentity();
  let running = true;

  const poll = async () => {
    while (running) {
      try {
        await sweepExhaustedLocks(queueName, prisma);

        const rows = await claimNextBatch(queueName, batchSize, workerId, prisma);

        for (const row of rows) {
          try {
            await handler(
              {
                type: row.message_type as QueueMessage['type'],
                payload: row.payload,
                timestamp: row.scheduled_at.toISOString(),
                organizationId: row.organization_id || '',
              },
              { id: row.id, attempts: row.attempts }
            );
            await completeMessage(row.id, prisma);
          } catch (error) {
            const outcome = await failMessage(row, error, prisma);
            logger.error(
              { queueName, messageId: row.id, attempts: row.attempts, outcome, error },
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
