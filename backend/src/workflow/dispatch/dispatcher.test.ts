/**
 * dispatchRecord — per-stage isolation, duplicate handling, and retry (Doctrine §13).
 *
 * Uses an in-memory fake of the DispatchLog table; no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { dispatchRecord } from './dispatcher.js';
import { createConsumerRegistry, type ConsumerHandler } from './consumer-registry.js';
import type { ChangeRecord } from '../records/change-record.js';

const ORG = '11111111-1111-1111-1111-111111111111';

const RECORD: ChangeRecord = {
  record_id: 'exp-7',
  record_version: 2,
  record_type: 'candidate_exposure',
  organization_id: ORG,
  produced_at: '2026-10-13T12:00:00.000Z',
  payload: {},
};


interface Row {
  id: string;
  consumer: string;
  record_id: string;
  record_version: number;
  status: string;
  error_message: string | null;
}
let rows: Map<string, Row>;
let nextId: number;

const keyOf = (where: { consumer_record_id_record_version: { consumer: string; record_id: string; record_version: number } }) => {
  const k = where.consumer_record_id_record_version;
  return `${k.consumer}|${k.record_id}|${k.record_version}`;
};

const fakeDispatchLog = {
  findUnique: vi.fn(({ where }: { where: never }) => Promise.resolve(rows.get(keyOf(where)) ?? null)),
  create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
    const k = `${data.consumer}|${data.record_id}|${data.record_version}`;
    if (rows.has(k)) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
    const row: Row = {
      id: `row-${nextId++}`,
      consumer: String(data.consumer),
      record_id: String(data.record_id),
      record_version: Number(data.record_version),
      status: String(data.status),
      error_message: null,
    };
    rows.set(k, row);
    return row;
  }),
  update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
    const row = [...rows.values()].find((r) => r.id === where.id);
    if (!row) throw new Error('row not found');
    Object.assign(row, data);
    return row;
  }),
};

const prisma = { dispatchLog: fakeDispatchLog } as unknown as PrismaClient;

const statusOf = (consumer: string) =>
  [...rows.values()].find((r) => r.consumer === consumer)?.status;

beforeEach(() => {
  rows = new Map();
  nextId = 1;
  fakeDispatchLog.findUnique.mockClear();
  fakeDispatchLog.create.mockClear();
  fakeDispatchLog.update.mockClear();
});

describe('dispatchRecord', () => {
  it('marks unregistered consumers skipped_noop and reports no failures', async () => {
    const summary = await dispatchRecord(RECORD, { prisma, registry: createConsumerRegistry() });

    expect(summary.failed).toBe(0);
    expect(summary.results.map((r) => r.status)).toEqual(['skipped_noop', 'skipped_noop']);
    expect(statusOf('event_verification')).toBe('skipped_noop');
    expect(statusOf('exposure_validation')).toBe('skipped_noop');
  });

  it('runs a registered consumer and records it completed', async () => {
    const handler = vi.fn<ConsumerHandler>().mockResolvedValue(undefined);
    const registry = createConsumerRegistry({ event_verification: handler });

    const summary = await dispatchRecord(RECORD, { prisma, registry });

    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0][0];
    expect(ctx.record).toEqual(RECORD);
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(summary.results[0]).toEqual({ consumer: 'event_verification', status: 'completed' });
    expect(statusOf('event_verification')).toBe('completed');
  });

  it('keeps running the other stages when one consumer fails', async () => {
    const failing = vi.fn<ConsumerHandler>().mockRejectedValue(new Error('verification source down'));
    const ok = vi.fn<ConsumerHandler>().mockResolvedValue(undefined);
    const registry = createConsumerRegistry({ event_verification: failing, exposure_validation: ok });

    const summary = await dispatchRecord(RECORD, { prisma, registry });

    expect(failing).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]).toMatchObject({ consumer: 'event_verification', status: 'failed' });
    expect(summary.results[1]).toEqual({ consumer: 'exposure_validation', status: 'completed' });
    expect(rows.size).toBe(2);
    expect([...rows.values()].find((r) => r.consumer === 'event_verification')?.error_message).toBe(
      'verification source down'
    );
  });

  it('never runs a consumer again once it has completed (duplicate delivery)', async () => {
    const handler = vi.fn<ConsumerHandler>().mockResolvedValue(undefined);
    const registry = createConsumerRegistry({ event_verification: handler, exposure_validation: handler });

    await dispatchRecord(RECORD, { prisma, registry });
    const second = await dispatchRecord(RECORD, { prisma, registry });

    expect(handler).toHaveBeenCalledTimes(2); // once per consumer, not four times
    expect(second.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
  });

  it('reruns a consumer that failed on the previous attempt, and only that one', async () => {
    const flaky = vi.fn<ConsumerHandler>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(undefined);
    const ok = vi.fn<ConsumerHandler>().mockResolvedValue(undefined);
    const registry = createConsumerRegistry({ event_verification: flaky, exposure_validation: ok });

    await dispatchRecord(RECORD, { prisma, registry });
    const retry = await dispatchRecord(RECORD, { prisma, registry });

    expect(flaky).toHaveBeenCalledTimes(2);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(retry.failed).toBe(0);
    expect(retry.results.map((r) => r.status)).toEqual(['completed', 'duplicate']);
  });

  it('joins a row another worker created first, instead of failing on the unique violation', async () => {
    // Simulate the race: the lookup misses, then create finds a row that already exists.
    rows.set(`event_verification|${RECORD.record_id}|${RECORD.record_version}`, {
      id: 'row-raced',
      consumer: 'event_verification',
      record_id: RECORD.record_id,
      record_version: RECORD.record_version,
      status: 'completed',
      error_message: null,
    });
    fakeDispatchLog.findUnique.mockResolvedValueOnce(null);

    const summary = await dispatchRecord(RECORD, {
      prisma,
      registry: createConsumerRegistry({ event_verification: vi.fn().mockResolvedValue(undefined) }),
    });

    expect(summary.results[0]).toEqual({ consumer: 'event_verification', status: 'duplicate' });
  });

  it('logs every dispatch row with the record identity', async () => {
    await dispatchRecord(RECORD, { prisma, registry: createConsumerRegistry(), queueMessageId: 'msg-9' });

    expect(fakeDispatchLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        record_id: 'exp-7',
        record_version: 2,
        record_type: 'candidate_exposure',
        organization_id: ORG,
        queue_message_id: 'msg-9',
      }),
    });
  });
});
