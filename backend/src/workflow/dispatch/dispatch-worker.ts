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
import {
  CHANGE_RECORD_QUEUE,
  consumeFromQueue,
  DEFAULT_CLAIM_BATCH_SIZE,
  PermanentMessageError,
  STALE_LOCK_SECONDS,
} from '../../monitoring/queue-client.js';
import { logger } from '../../monitoring/logger.js';
import { changeRecordKey, parseChangeRecord } from '../records/change-record.js';
import { createConsumerRegistry, type ConsumerRegistry } from './consumer-registry.js';
import { dispatchRecord, DEFAULT_STAGE_TIMEOUT_MS, maxRecordBudgetMs } from './dispatcher.js';
import { clientMonitoringConsumer } from '../consumers/client-monitoring.js';

export interface DispatchWorkerOptions {
  prisma?: PrismaClient;
  registry?: ConsumerRegistry;
  stageTimeoutMs?: number;
  batchSize?: number;
  pollIntervalMs?: number;
}

/**
 * Default consumer registry with registered consumers.
 * Add new consumers here as they are implemented.
 */
function createDefaultRegistry(): ConsumerRegistry {
  return createConsumerRegistry({
    client_monitoring: clientMonitoringConsumer,
    // Add more consumers as they are implemented:
    // event_verification: eventVerificationConsumer,
    // exposure_validation: exposureValidationConsumer,
    // impact_assessment: impactAssessmentConsumer,
    // notification_rules: notificationRulesConsumer,
  });
}

/** Share of the queue lease a claimed batch may use; the rest is margin. */
const LEASE_SAFETY = 0.8;

/**
 * A claimed batch is processed sequentially, and a row still waiting after
 * STALE_LOCK_SECONDS is reclaimed by another worker (and run twice). Cap the
 * batch so that batch × worst-case record time fits the lease, never below 1.
 */
export function leaseSafeBatchSize(requested: number | undefined, stageTimeoutMs: number): number {
  const leaseMs = STALE_LOCK_SECONDS * 1000 * LEASE_SAFETY;
  const safe = Math.max(1, Math.floor(leaseMs / maxRecordBudgetMs(stageTimeoutMs)));
  const wanted = requested ?? DEFAULT_CLAIM_BATCH_SIZE;
  if (wanted > safe) {
    logger.warn({ requested: wanted, safe }, '[DispatchWorker] Batch size capped to fit the queue lease');
  }
  return Math.min(wanted, safe);
}

export function startDispatchWorker(options: DispatchWorkerOptions = {}): { stop: () => void } {
  const prisma = options.prisma ?? getPrismaClient();
  const registry = options.registry ?? createDefaultRegistry();
  const stageTimeoutMs = options.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;
  const batchSize = leaseSafeBatchSize(options.batchSize, stageTimeoutMs);

  logger.info({ batchSize }, '[DispatchWorker] Starting change-record dispatch worker');

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
    { batchSize, pollIntervalMs: options.pollIntervalMs }
  );
}
