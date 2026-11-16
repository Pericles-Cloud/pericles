/**
 * Dispatcher (Doctrine §13).
 *
 * For each route in the dispatch table, the dispatcher keeps one DispatchLog row
 * per (consumer, record_id, record_version). A row that is already `completed` or
 * `skipped_noop` is a duplicate delivery and does not run again. A row that is
 * `failed`, or left `dispatched` by a crashed worker, runs again. Delivery is at
 * least once, so a consumer must still be idempotent on the record version.
 *
 * One failing consumer does not stop the others. `failed > 0` tells the worker to
 * retry the queue message. The retry skips the consumers that already succeeded.
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '../../monitoring/logger.js';
import type { ChangeRecord } from '../records/change-record.js';
import { routesFor, type ConsumerName } from './dispatch-table.js';
import { isUniqueViolation } from '../../monitoring/prisma-errors.js';
import type { ConsumerRegistry } from './consumer-registry.js';

export const DEFAULT_STAGE_TIMEOUT_MS = 10_000;

/**
 * Default budgets for stages that run an LLM agent and cannot fit the general
 * default. client_monitoring evaluates one org per record (the fan-out enqueues
 * an org-scoped record per org), so this is one agent evaluation. The queue
 * renews a held row's lock while it runs. These are defaults only: an explicit
 * DispatchOptions.stageTimeoutMs set by the operator always applies, higher or
 * lower.
 */
export const STAGE_TIMEOUT_OVERRIDES_MS: Partial<Record<ConsumerName, number>> = {
  client_monitoring: 120_000,
};

export function stageTimeoutFor(consumer: ConsumerName, configuredMs?: number): number {
  return configuredMs ?? STAGE_TIMEOUT_OVERRIDES_MS[consumer] ?? DEFAULT_STAGE_TIMEOUT_MS;
}

export type StageStatus = 'completed' | 'skipped_noop' | 'duplicate' | 'failed';

export interface StageResult {
  consumer: ConsumerName;
  status: StageStatus;
  error?: string;
}

export interface DispatchSummary {
  results: StageResult[];
  failed: number;
}

export interface DispatchOptions {
  prisma: PrismaClient;
  registry: ConsumerRegistry;
  queueMessageId?: string;
  stageTimeoutMs?: number;
}

const FINISHED: ReadonlySet<string> = new Set(['completed', 'skipped_noop']);


async function findOrCreateRow(
  record: ChangeRecord,
  consumer: ConsumerName,
  options: DispatchOptions
) {
  const key = {
    consumer_record_id_record_version: {
      consumer,
      record_id: record.record_id,
      record_version: record.record_version,
    },
  };

  const existing = await options.prisma.dispatchLog.findUnique({ where: key });
  if (existing) return existing;

  try {
    return await options.prisma.dispatchLog.create({
      data: {
        queue_message_id: options.queueMessageId ?? null,
        record_id: record.record_id,
        record_version: record.record_version,
        record_type: record.record_type,
        organization_id: record.organization_id,
        consumer,
        status: 'dispatched',
      },
    });
  } catch (error) {
    // A concurrent dispatch created the row first.
    if (!isUniqueViolation(error)) throw error;
    const raced = await options.prisma.dispatchLog.findUnique({ where: key });
    if (!raced) throw error;
    return raced;
  }
}

async function runStage(
  record: ChangeRecord,
  consumer: ConsumerName,
  options: DispatchOptions
): Promise<StageResult> {
  const row = await findOrCreateRow(record, consumer, options);

  if (FINISHED.has(row.status)) {
    logger.debug({ consumer, record_id: record.record_id, record_version: record.record_version }, '[Dispatch] duplicate delivery skipped');
    return { consumer, status: 'duplicate' };
  }

  const handler = options.registry.get(consumer);
  if (!handler) {
    await options.prisma.dispatchLog.update({ where: { id: row.id }, data: { status: 'skipped_noop' } });
    return { consumer, status: 'skipped_noop' };
  }

  await options.prisma.dispatchLog.update({ where: { id: row.id }, data: { status: 'dispatched', error_message: null } });

  try {
    await handler({
      record,
      signal: AbortSignal.timeout(stageTimeoutFor(consumer, options.stageTimeoutMs)),
    });
    await options.prisma.dispatchLog.update({ where: { id: row.id }, data: { status: 'completed' } });
    return { consumer, status: 'completed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await options.prisma.dispatchLog.update({
      where: { id: row.id },
      data: { status: 'failed', error_message: message },
    });
    logger.error({ consumer, record_id: record.record_id, record_version: record.record_version, error }, '[Dispatch] consumer failed');
    return { consumer, status: 'failed', error: message };
  }
}

/**
 * Dispatch one change record to every route it matches.
 * Consumers run in table order. The result reports each stage.
 */
export async function dispatchRecord(record: ChangeRecord, options: DispatchOptions): Promise<DispatchSummary> {
  const results: StageResult[] = [];
  for (const route of routesFor(record)) {
    results.push(await runStage(record, route.consumer, options));
  }
  return { results, failed: results.filter((r) => r.status === 'failed').length };
}
