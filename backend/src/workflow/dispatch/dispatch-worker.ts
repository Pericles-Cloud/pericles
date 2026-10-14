/**
 * Dispatch worker (Doctrine §13).
 *
 * Consumes change records from the queue and dispatches each one. A record that
 * fails schema validation is a permanent error and goes straight to DEAD_LETTER.
 * A record with a failed consumer is retried. Retries skip consumers that already
 * succeeded, because the dispatcher records each stage.
 *
 * Opt-in: start with DISPATCH_WORKER_ENABLED=true (see monitoring/start.ts).
 */

import type { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../monitoring/db-client.js';
import { CHANGE_RECORD_QUEUE, consumeFromQueue, PermanentMessageError } from '../../monitoring/queue-client.js';
import { logger } from '../../monitoring/logger.js';
import { changeRecordKey, parseChangeRecord } from '../records/change-record.js';
import { createConsumerRegistry, type ConsumerRegistry } from './consumer-registry.js';
import { dispatchRecord, DEFAULT_STAGE_TIMEOUT_MS } from './dispatcher.js';

export interface DispatchWorkerOptions {
  prisma?: PrismaClient;
  registry?: ConsumerRegistry;
  stageTimeoutMs?: number;
  batchSize?: number;
  pollIntervalMs?: number;
}

export function startDispatchWorker(options: DispatchWorkerOptions = {}): { stop: () => void } {
  const prisma = options.prisma ?? getPrismaClient();
  const registry = options.registry ?? createConsumerRegistry();
  const stageTimeoutMs = options.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;

  logger.info('[DispatchWorker] Starting change-record dispatch worker');

  return consumeFromQueue(
    CHANGE_RECORD_QUEUE,
    async (message, ctx) => {
      let record;
      try {
        record = parseChangeRecord(message.payload);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new PermanentMessageError(`invalid change record: ${reason}`);
      }

      const summary = await dispatchRecord(record, {
        prisma,
        registry,
        queueMessageId: ctx.id,
        stageTimeoutMs,
      });

      if (summary.failed > 0) {
        throw new Error(`${summary.failed} consumer(s) failed for ${changeRecordKey(record)}`);
      }
    },
    { batchSize: options.batchSize, pollIntervalMs: options.pollIntervalMs }
  );
}
