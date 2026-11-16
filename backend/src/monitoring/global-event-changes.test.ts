/**
 * Global Event Store change records get a new version per change (issue #76).
 * Mocked Prisma client; no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  globalEvent: { update: vi.fn() },
  messageQueue: { createMany: vi.fn() },
}));

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));

import { emitGlobalEventChange } from './global-event-changes.js';
import { parseChangeRecord } from '../workflow/records/change-record.js';
import { routesFor } from '../workflow/dispatch/dispatch-table.js';

const payload = (change_type: 'created' | 'updated' | 'resolved') => ({
  event_id: 'ge-1',
  event_hash: 'h',
  change_type,
  intrinsic_severity: 'high',
  status: change_type === 'resolved' ? 'RESOLVED' : 'ACTIVE',
});

const rows = () =>
  fake.messageQueue.createMany.mock.calls.map(
    (c) => (c[0] as { data: Array<{ payload: unknown; idempotency_key: string }> }).data[0]
  );

beforeEach(() => {
  let seq = 0;
  fake.globalEvent.update.mockReset().mockImplementation(() => Promise.resolve({ change_seq: ++seq }));
  fake.messageQueue.createMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('emitGlobalEventChange', () => {
  it('gives create, update and resolve distinct versions so later changes are not deduplicated', async () => {
    await emitGlobalEventChange(fake as never, payload('created'));
    await emitGlobalEventChange(fake as never, payload('updated'));
    await emitGlobalEventChange(fake as never, payload('resolved'));

    expect(fake.globalEvent.update.mock.calls[0][0]).toEqual({
      where: { id: 'ge-1' },
      data: { change_seq: { increment: 1 } },
      select: { change_seq: true },
    });
    expect(rows().map((r) => r.idempotency_key)).toEqual([
      'global-event-ge-1:1',
      'global-event-ge-1:2',
      'global-event-ge-1:3',
    ]);
  });

  it('emits a valid global record that reaches client_monitoring', async () => {
    await emitGlobalEventChange(fake as never, payload('resolved'));

    const record = parseChangeRecord(rows()[0].payload);
    expect(record).toMatchObject({ record_type: 'global_event_change', organization_id: null, record_version: 1 });
    expect(routesFor(record).map((r) => r.consumer)).toContain('client_monitoring');
  });
});
