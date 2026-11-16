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
    $queryRaw: vi.fn(),
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
  fake.$queryRaw.mockReset().mockResolvedValue([]);
});

const keys = () =>
  fake.messageQueue.createMany.mock.calls.map((c) => (c[0] as { data: Array<{ idempotency_key: string }> }).data[0].idempotency_key);

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

  it('takes the event row lock and refuses an event that has already ended', async () => {
    fake.globalEvent.findUnique
      .mockResolvedValueOnce({ id: EVENT_ID, event_hash: 'h', status: 'ACTIVE', intrinsic_severity: 'high', timeline: [] })
      .mockResolvedValueOnce({ status: 'RETRACTED' });

    const result = await globalEventResolutionTool.execute({
      context: { event_id: EVENT_ID, action: 'resolve', resolution_basis: 'source_restoration' },
    } as never);

    expect((fake.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?')).toMatch(/FOR UPDATE/);
    expect(result).toMatchObject({ success: false });
    expect(fake.globalEvent.update).not.toHaveBeenCalled();
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('on merge, also notifies the surviving event', async () => {
    const SURVIVOR = '44444444-4444-4444-4444-444444444444';
    fake.globalEvent.findUnique
      .mockResolvedValueOnce({ id: EVENT_ID, event_hash: 'h', status: 'ACTIVE', intrinsic_severity: 'high', timeline: [] })
      .mockResolvedValueOnce({ status: 'ACTIVE' })
      .mockResolvedValueOnce({ id: SURVIVOR, event_hash: 'h2', status: 'ACTIVE', intrinsic_severity: 'high' });
    fake.globalEvent.update.mockResolvedValueOnce({}).mockResolvedValueOnce({ change_seq: 5 }).mockResolvedValueOnce({ change_seq: 9 });

    await globalEventResolutionTool.execute({
      context: { event_id: EVENT_ID, action: 'merge', merge_into_event_id: SURVIVOR },
    } as never);

    expect(keys()).toEqual([`global-event-${EVENT_ID}:5`, `global-event-${SURVIVOR}:9`]);
    const survivorRow = fake.messageQueue.createMany.mock.calls[1][0].data[0];
    expect(survivorRow.payload.payload).toMatchObject({ change_type: 'updated', changed_fields: ['merged_from'] });
  });
});

