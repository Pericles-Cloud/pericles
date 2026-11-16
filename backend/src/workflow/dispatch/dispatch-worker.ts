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
import { dispatchRecord } from './dispatcher.js';
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
    // Add more consumers as they are implemented.
    // #78: until these two are registered, candidate_exposure stages are logged
    // skipped_noop (final for that version). When registering them, run
    // reemitCandidateHandoffs(orgId) (monitoring/candidate-exposure-store.ts)
    // for each organization so pending CANDIDATE exposures reach Validation.
    // event_verification: eventVerificationConsumer,
    // exposure_validation: exposureValidationConsumer,
    // impact_assessment: impactAssessmentConsumer,
    // notification_rules: notificationRulesConsumer,
  });
}

/** Records claimed per poll by the dispatch worker. */
export const DISPATCH_CLAIM_BATCH_SIZE = 1;

export function startDispatchWorker(options: DispatchWorkerOptions = {}): { stop: () => void } {
  const prisma = options.prisma ?? getPrismaClient();
  const registry = options.registry ?? createDefaultRegistry();
  // Undefined unless the operator sets it: per-stage defaults then apply.
  const stageTimeoutMs = options.stageTimeoutMs;

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
    // One record at a time: stages can run an LLM for minutes, and a large
    // claim would hold rows other workers could take. The queue no longer
    // sleeps between non-empty polls, so this costs no throughput.
    { batchSize: options.batchSize ?? DISPATCH_CLAIM_BATCH_SIZE, pollIntervalMs: options.pollIntervalMs }
  );
}
