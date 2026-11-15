/**
 * Profile back-matching (issue #76). Mocked Prisma client; no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => {
  const client = {
    globalEvent: { findMany: vi.fn() },
    messageQueue: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));

import { triggerBackMatching, profileFingerprint } from './client-exposure-profile.js';
import { routesFor } from '../workflow/dispatch/dispatch-table.js';
import { parseChangeRecord } from '../workflow/records/change-record.js';

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  fake.$transaction.mockReset().mockImplementation((fn: (tx: unknown) => unknown) => fn(fake));
  fake.globalEvent.findMany.mockReset();
  fake.messageQueue.createMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('triggerBackMatching', () => {
  it('enqueues one org-scoped global_event_change per active event', async () => {
    fake.globalEvent.findMany.mockResolvedValue([
      { id: 'ge-1', event_hash: 'h1', intrinsic_severity: 'high', status: 'ACTIVE' },
      { id: 'ge-2', event_hash: 'h2', intrinsic_severity: 'low', status: 'FORECAST' },
    ]);

    const count = await triggerBackMatching(ORG, 7);

    expect(count).toBe(2);
    expect(fake.globalEvent.findMany.mock.calls[0][0].where.status.in).toEqual([
      'FORECAST',
      'DEVELOPING',
      'ACTIVE',
      'DE_ESCALATING',
    ]);
    const rows = fake.messageQueue.createMany.mock.calls.map(([arg]) => arg.data[0]);
    expect(rows).toHaveLength(2);
    expect(rows[0].idempotency_key).toBe(`ge-1:backmatch:${ORG}:7`);

    const record = parseChangeRecord(rows[0].payload);
    expect(record.record_type).toBe('global_event_change');
    expect(record.payload).toMatchObject({ event_id: 'ge-1', target_organization_id: ORG });
    // Back-match must reach Client Monitoring only, never re-trigger Event Verification.
    expect(routesFor(record).map((r) => r.consumer)).toEqual(['client_monitoring']);
  });

  it('enqueues nothing when there are no active events', async () => {
    fake.globalEvent.findMany.mockResolvedValue([]);
    expect(await triggerBackMatching(ORG, 1)).toBe(0);
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('rejects a missing organization_id', async () => {
    await expect(triggerBackMatching('', 1)).rejects.toThrow('organization_id required');
  });
});

describe('profileFingerprint', () => {
  it('changes only when exposure-relevant content changes', () => {
    const base = { suppliers: [{ id: 's1' }], own_facilities: [] } as never;
    expect(profileFingerprint(base)).toBe(profileFingerprint({ ...(base as object) } as never));
    expect(profileFingerprint(base)).not.toBe(profileFingerprint({ suppliers: [{ id: 's2' }] } as never));
  });
});
