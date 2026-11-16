/**
 * Queue client — idempotent publish, claim, retry, and dead-letter (Doctrine §13).
 *
 * Uses a mocked Prisma client (vi.mock of db-client); no DB.
 * The atomic SKIP LOCKED claim is verified by its SQL shape and parameters only.
 * Real concurrency needs a Postgres integration test, which is out of scope here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  messageQueue: {
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
}));

vi.mock('./db-client.js', () => ({
  getPrismaClient: () => fake,
}));

import {
  computeBackoffMs,
  publishToQueue,
  enqueueInTransaction,
  claimNextBatch,
  failMessage,
  completeMessage,
  PermanentMessageError,
  STALE_LOCK_SECONDS,
  LOCK_RENEW_INTERVAL_MS,
  MAX_LOCK_HOLD_MS,
  renewLocks,
  consumeFromQueue,
} from './queue-client.js';

const QUEUE = 'change-records';
const MESSAGE = {
  type: 'change_record' as const,
  payload: { record_id: 'evt-1' },
  timestamp: '2026-10-13T12:00:00.000Z',
  organizationId: '11111111-1111-1111-1111-111111111111',
};

beforeEach(() => {
  fake.messageQueue.createMany.mockReset().mockResolvedValue({ count: 1 });
  fake.messageQueue.update.mockReset().mockResolvedValue({});
  fake.messageQueue.updateMany.mockReset().mockResolvedValue({ count: 1 });
  fake.$queryRaw.mockReset().mockResolvedValue([]);
  fake.$executeRaw.mockReset().mockResolvedValue(0);
});

describe('computeBackoffMs', () => {
  const noJitter = () => 0;

  it('starts at 1s and doubles', () => {
    expect(computeBackoffMs(1, noJitter)).toBe(1_000);
    expect(computeBackoffMs(2, noJitter)).toBe(2_000);
    expect(computeBackoffMs(3, noJitter)).toBe(4_000);
  });

  it('caps at 60s', () => {
    expect(computeBackoffMs(20, noJitter)).toBe(60_000);
  });

  it('adds at most 20% jitter, and never exceeds the cap', () => {
    expect(computeBackoffMs(1, () => 1)).toBe(1_200);
    expect(computeBackoffMs(20, () => 1)).toBe(60_000);
  });
});

describe('publishToQueue', () => {
  it('stores the idempotency key and skips duplicates', async () => {
    const result = await publishToQueue(QUEUE, MESSAGE, { idempotencyKey: 'evt-1:1' });

    expect(fake.messageQueue.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          queue_name: QUEUE,
          idempotency_key: 'evt-1:1',
          organization_id: MESSAGE.organizationId,
        }),
      ],
      skipDuplicates: true,
    });
    expect(result).toEqual({ deduplicated: false });
  });

  it('reports deduplicated when the key already exists', async () => {
    fake.messageQueue.createMany.mockResolvedValue({ count: 0 });
    const result = await publishToQueue(QUEUE, MESSAGE, { idempotencyKey: 'evt-1:1' });
    expect(result).toEqual({ deduplicated: true });
  });

  it('logs and swallows errors by default', async () => {
    fake.messageQueue.createMany.mockRejectedValue(new Error('db down'));
    await expect(publishToQueue(QUEUE, MESSAGE)).resolves.toEqual({ deduplicated: false });
  });

  it('rethrows errors when required', async () => {
    fake.messageQueue.createMany.mockRejectedValue(new Error('db down'));
    await expect(publishToQueue(QUEUE, MESSAGE, { required: true })).rejects.toThrow('db down');
  });
});

describe('enqueueInTransaction', () => {
  it('writes through the transaction client and does not swallow errors', async () => {
    const tx = { messageQueue: { createMany: vi.fn().mockRejectedValue(new Error('constraint')) } };

    await expect(
      enqueueInTransaction(tx as never, QUEUE, MESSAGE, { idempotencyKey: 'evt-1:1' })
    ).rejects.toThrow('constraint');
    expect(tx.messageQueue.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
  });
});

describe('claimNextBatch', () => {
  it('issues one atomic claim scoped to the queue, with SKIP LOCKED and the stale-lock window', async () => {
    fake.$queryRaw.mockResolvedValue([{ id: 'row-1' }]);

    const rows = await claimNextBatch(QUEUE, 5, 'worker-a');

    expect(rows).toEqual([{ id: 'row-1' }]);
    const [strings, ...values] = fake.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('?');
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/attempts < max_attempts/);
    expect(values).toEqual(expect.arrayContaining([QUEUE, 'worker-a', 5, STALE_LOCK_SECONDS]));
  });
});

describe('failMessage', () => {
  it('returns the row to PENDING with a future scheduled_at while attempts remain', async () => {
    const before = Date.now();
    const outcome = await failMessage({ id: 'row-1', attempts: 1, max_attempts: 3 }, new Error('feed 500'));

    expect(outcome).toBe('retry');
    const { data } = fake.messageQueue.update.mock.calls[0][0];
    expect(data.status).toBe('PENDING');
    expect(data.scheduled_at.getTime()).toBeGreaterThan(before);
    expect(data.error_message).toBe('feed 500');
    expect(data.locked_at).toBeNull();
  });

  it('dead-letters once the attempt budget is spent', async () => {
    const outcome = await failMessage({ id: 'row-1', attempts: 3, max_attempts: 3 }, new Error('still failing'));

    expect(outcome).toBe('dead_letter');
    expect(fake.messageQueue.update.mock.calls[0][0].data.status).toBe('DEAD_LETTER');
  });

  it('dead-letters a permanent error immediately, even with attempts left', async () => {
    const outcome = await failMessage(
      { id: 'row-1', attempts: 1, max_attempts: 3 },
      new PermanentMessageError('malformed record')
    );

    expect(outcome).toBe('dead_letter');
    expect(fake.messageQueue.update.mock.calls[0][0].data.error_message).toBe('malformed record');
  });
});

describe('completeMessage', () => {
  it('marks the row COMPLETED and clears the lock', async () => {
    await completeMessage('row-1');
    const { data } = fake.messageQueue.update.mock.calls[0][0];
    expect(data.status).toBe('COMPLETED');
    expect(data.locked_at).toBeNull();
    expect(data.locked_by).toBeNull();
  });
});

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');
const renewCalls = () => fake.$executeRaw.mock.calls.filter((c) => sqlOf(c).includes('SET locked_at = now()'));

describe('renewLocks', () => {
  it('renews only rows this worker still holds as PROCESSING', async () => {
    fake.$executeRaw.mockResolvedValue(2);

    expect(await renewLocks(['row-1', 'row-2'], 'worker-a')).toBe(2);
    const [call] = renewCalls();
    expect(sqlOf(call)).toMatch(/locked_by = \?/);
    expect(sqlOf(call)).toMatch(/status = 'PROCESSING'/);
    expect(call.slice(1)).toEqual([['row-1', 'row-2'], 'worker-a']);
  });

  it('does nothing for an empty set', async () => {
    expect(await renewLocks([], 'worker-a')).toBe(0);
    expect(fake.$executeRaw).not.toHaveBeenCalled();
  });

  it('renews well inside the lease', () => {
    expect(LOCK_RENEW_INTERVAL_MS).toBeLessThan(STALE_LOCK_SECONDS * 1000);
  });
});

describe('consumeFromQueue', () => {
  const row = (id: string) => ({
    id,
    queue_name: QUEUE,
    message_type: 'change_record',
    organization_id: null,
    payload: {},
    attempts: 1,
    max_attempts: 5,
    scheduled_at: new Date('2026-11-16T00:00:00Z'),
  });

  it('keeps renewing a long-running row and a waiting row until each finishes', async () => {
    vi.useFakeTimers();
    try {
      fake.$queryRaw.mockResolvedValueOnce([row('row-1'), row('row-2')]).mockResolvedValue([]);
      let finishFirst: () => void = () => undefined;
      const handler = vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
        .mockResolvedValue(undefined);

      const consumer = consumeFromQueue(QUEUE, handler, { pollIntervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS + 1);

      // row-1 is still running and row-2 is waiting behind it: both are renewed.
      expect(renewCalls().at(-1)?.[1]).toEqual(['row-1', 'row-2']);

      finishFirst();
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(2);

      // The batch is done and the loop is idle: the only live timer is the
      // poll wait. A leaked renewal interval would add one per batch.
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      consumer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls again immediately after a non-empty batch, and waits only when idle', async () => {
    vi.useFakeTimers();
    try {
      fake.$queryRaw.mockResolvedValueOnce([row('row-1')]).mockResolvedValue([]);
      const consumer = consumeFromQueue(QUEUE, vi.fn().mockResolvedValue(undefined), { pollIntervalMs: 60_000 });

      await vi.advanceTimersByTimeAsync(0);
      // Second claim happened without the 60s idle wait.
      expect(fake.$queryRaw).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(fake.$queryRaw).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(60_000);
      consumer.stop();
      expect(fake.$queryRaw).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops renewing a batch held past the max hold, so a hung handler cannot keep its row forever', async () => {
    vi.useFakeTimers();
    try {
      fake.$queryRaw.mockResolvedValueOnce([row('row-1')]).mockResolvedValue([]);
      const hung = vi.fn(() => new Promise<void>(() => undefined));
      const consumer = consumeFromQueue(QUEUE, hung, { maxLockHoldMs: LOCK_RENEW_INTERVAL_MS * 2 });

      await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS * 2 + 1);
      const renewsAtLimit = renewCalls().length;
      expect(renewsAtLimit).toBeGreaterThanOrEqual(1);

      await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS * 5);
      expect(renewCalls().length).toBe(renewsAtLimit);
      consumer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the exhausted-lock sweep at most once per renewal interval, not once per record', async () => {
    vi.useFakeTimers();
    try {
      fake.$queryRaw
        .mockResolvedValueOnce([row('a')])
        .mockResolvedValueOnce([row('b')])
        .mockResolvedValueOnce([row('c')])
        .mockResolvedValue([]);
      const consumer = consumeFromQueue(QUEUE, vi.fn().mockResolvedValue(undefined), { pollIntervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      consumer.stop();

      const sweeps = fake.$executeRaw.mock.calls.filter((c) => sqlOf(c).includes('lock expired after final attempt'));
      expect(fake.$queryRaw.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(sweeps).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the max hold well above a single stage budget', () => {
    expect(MAX_LOCK_HOLD_MS).toBeGreaterThan(120_000);
  });

  it('completes and fails only rows this worker still holds', async () => {
    vi.useFakeTimers();
    try {
      fake.$queryRaw.mockResolvedValueOnce([row('ok'), row('bad')]).mockResolvedValue([]);
      const handler = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
      const consumer = consumeFromQueue(QUEUE, handler);
      await vi.advanceTimersByTimeAsync(0);
      consumer.stop();

      const wheres = fake.messageQueue.updateMany.mock.calls.map((c) => c[0].where);
      expect(wheres).toEqual([
        { id: 'ok', locked_by: expect.any(String) },
        { id: 'bad', locked_by: expect.any(String) },
      ]);
      expect(wheres[0].locked_by).toBe(wheres[1].locked_by);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after a row passes the max hold, keeps renewing the rows waiting behind it', async () => {
    vi.useFakeTimers();
    try {
      fake.$queryRaw.mockResolvedValueOnce([row('hung'), row('next')]).mockResolvedValue([]);
      const handler = vi.fn(() => new Promise<void>(() => undefined));
      const consumer = consumeFromQueue(QUEUE, handler, { maxLockHoldMs: LOCK_RENEW_INTERVAL_MS * 2 });

      await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS * 4 + 1);
      consumer.stop();

      const lastRenewed = renewCalls().at(-1)?.[1];
      expect(lastRenewed).toEqual(['next']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off after a poll error even if rows were claimed', async () => {
    vi.useFakeTimers();
    try {
      fake.$queryRaw.mockResolvedValueOnce([row('r1')]).mockResolvedValue([row('r2')]);
      fake.messageQueue.updateMany.mockRejectedValue(new Error('db down'));
      const consumer = consumeFromQueue(QUEUE, vi.fn().mockResolvedValue(undefined), { pollIntervalMs: 60_000 });

      await vi.advanceTimersByTimeAsync(1_000);
      const claimsDuringBackoff = fake.$queryRaw.mock.calls.length;
      consumer.stop();
      expect(claimsDuringBackoff).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

