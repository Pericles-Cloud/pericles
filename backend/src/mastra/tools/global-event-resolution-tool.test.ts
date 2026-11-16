/**
 * Global event resolution tool emits its change record (issue #76).
 * Mocked Prisma client; no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => {
  const client = {
    globalEvent: { findUnique: vi.fn(), update: vi.fn() },
    messageQueue: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return client;
});

vi.mock('../../monitoring/db-client.js', () => ({ getPrismaClient: () => fake }));

import { globalEventResolutionTool } from './global-event-resolution-tool.js';

const EVENT_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  fake.$transaction.mockReset().mockImplementation((fn: (tx: unknown) => unknown) => fn(fake));
  fake.globalEvent.findUnique.mockReset().mockResolvedValue({
    id: EVENT_ID,
    event_hash: 'h',
    status: 'ACTIVE',
    intrinsic_severity: 'high',
    timeline: [],
  });
  fake.globalEvent.update.mockReset().mockResolvedValue({ change_seq: 2 });
  fake.messageQueue.createMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('globalEventResolutionTool', () => {
  it('resolves the event and enqueues its change record in the same transaction', async () => {
    const result = await globalEventResolutionTool.execute({
      context: { event_id: EVENT_ID, action: 'resolve', resolution_basis: 'source_restoration', source: 'NOAA' },
    } as never);

    expect(result).toMatchObject({ success: true, new_status: 'RESOLVED' });
    expect(fake.$transaction).toHaveBeenCalledTimes(1);
    const [row] = fake.messageQueue.createMany.mock.calls[0][0].data;
    expect(row.idempotency_key).toBe(`global-event-${EVENT_ID}:2`);
    expect(row.payload.payload).toMatchObject({ change_type: 'resolved', status: 'RESOLVED' });
  });
});
