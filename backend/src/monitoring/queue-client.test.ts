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
