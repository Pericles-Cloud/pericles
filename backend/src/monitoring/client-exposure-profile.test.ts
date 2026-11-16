/**
 * Profile back-matching (issue #76). Mocked Prisma client; no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  globalEvent: { findMany: vi.fn() },
  messageQueue: { createMany: vi.fn() },
  clientExposureProfile: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));

import { triggerBackMatching, profileFingerprint, backMatchIfProfileChanged } from './client-exposure-profile.js';
import { routesFor } from '../workflow/dispatch/dispatch-table.js';
import { parseChangeRecord } from '../workflow/records/change-record.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const FP = 'abcdef0123456789ffffffffffffffff';

const event = (n: number) => ({
  id: `ge-${String(n).padStart(4, '0')}`,
  event_hash: `h${n}`,
  intrinsic_severity: 'high',
  status: 'ACTIVE',
});

interface Row {
  payload: unknown;
  idempotency_key: string;
}
const insertCalls = (): Row[][] =>
  fake.messageQueue.createMany.mock.calls.map((call) => (call[0] as { data: Row[] }).data);

beforeEach(() => {
  fake.$transaction.mockReset();
  fake.globalEvent.findMany.mockReset();
  fake.clientExposureProfile.findUnique.mockReset();
  fake.clientExposureProfile.update.mockReset().mockResolvedValue({});
  fake.messageQueue.createMany.mockReset().mockImplementation(({ data }: { data: Row[] }) =>
    Promise.resolve({ count: data.length })
  );
});

describe('triggerBackMatching', () => {
  it('enqueues one org-scoped global_event_change per active event in a single insert', async () => {
    fake.globalEvent.findMany.mockResolvedValueOnce([event(1), event(2)]);

    const count = await triggerBackMatching(ORG, FP);

    expect(count).toBe(2);
    expect(fake.globalEvent.findMany.mock.calls[0][0].where.status.in).toEqual(['FORECAST', 'DEVELOPING', 'ACTIVE']);
    // One atomic INSERT, no interactive transaction to time out.
    expect(insertCalls()).toHaveLength(1);
    expect(fake.$transaction).not.toHaveBeenCalled();
    expect(fake.messageQueue.createMany.mock.calls[0][0].skipDuplicates).toBe(true);

    const [rows] = insertCalls();
    // Keyed by content, not profile version: a retry for the same content dedupes.
    expect(rows[0].idempotency_key).toBe(`ge-0001:backmatch:${ORG}:abcdef0123456789:1`);
    const record = parseChangeRecord(rows[0].payload);
    expect(record.record_type).toBe('global_event_change');
    expect(record.organization_id).toBe(ORG);
    expect(record.payload).toMatchObject({ event_id: 'ge-0001', target_organization_id: ORG });
    // Back-match must reach Client Monitoring only, never re-trigger Event Verification.
    expect(routesFor(record).map((r) => r.consumer)).toEqual(['client_monitoring']);
  });

  it('pages through every active event instead of capping', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => event(i));
    const page2 = Array.from({ length: 500 }, (_, i) => event(500 + i));
    const page3 = Array.from({ length: 120 }, (_, i) => event(1000 + i));
    fake.globalEvent.findMany
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce(page3);

    const count = await triggerBackMatching(ORG, FP);

    expect(count).toBe(1120);
    expect(insertCalls().map((rows) => rows.length)).toEqual([500, 500, 120]);
    const calls = fake.globalEvent.findMany.mock.calls.map((c) => c[0]);
    expect(calls[0].cursor).toBeUndefined();
    expect(calls[1]).toMatchObject({ cursor: { id: 'ge-0499' }, skip: 1 });
    expect(calls[2]).toMatchObject({ cursor: { id: 'ge-0999' }, skip: 1 });
  });

  it('enqueues nothing when there are no active events', async () => {
    fake.globalEvent.findMany.mockResolvedValueOnce([]);
    expect(await triggerBackMatching(ORG, FP)).toBe(0);
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('rejects a missing organization_id', async () => {
    await expect(triggerBackMatching('', FP)).rejects.toThrow('organization_id required');
  });
});

describe('profileFingerprint', () => {
  it('changes only when exposure-relevant content changes', () => {
    const base = { suppliers: [{ id: 's1' }], own_facilities: [] } as never;
    expect(profileFingerprint(base)).toBe(profileFingerprint({ ...(base as object) } as never));
    expect(profileFingerprint(base)).not.toBe(profileFingerprint({ suppliers: [{ id: 's2' }] } as never));
  });

  it('includes buffer_distances, which the agent uses to judge geographic exposure', () => {
    expect(profileFingerprint({ buffer_distances: { default: 50 } } as never)).not.toBe(
      profileFingerprint({ buffer_distances: { default: 200 } } as never)
    );
  });

  it('ignores ETA drift but not a new or re-routed shipment', () => {
    const shipment = { id: 'sh-1', origin: 'CNSHA', destination: 'USBAL', eta: '2026-11-20T00:00:00Z' };
    const base = profileFingerprint({ shipments_in_transit: [shipment] } as never);
    expect(profileFingerprint({ shipments_in_transit: [{ ...shipment, eta: '2026-11-22T00:00:00Z' }] } as never)).toBe(base);
    expect(profileFingerprint({ shipments_in_transit: [{ ...shipment, destination: 'USNYC' }] } as never)).not.toBe(base);
    expect(
      profileFingerprint({ shipments_in_transit: [shipment, { ...shipment, id: 'sh-2' }] } as never)
    ).not.toBe(base);
  });
});

describe('backMatchIfProfileChanged', () => {
  it('does nothing when content matches the last back-matched fingerprint', async () => {
    const profile = { suppliers: [{ id: 's1' }] };
    fake.clientExposureProfile.findUnique.mockResolvedValue({
      ...profile,
      back_match_fingerprint: profileFingerprint(profile as never),
    });

    expect(await backMatchIfProfileChanged(ORG)).toBe(0);
    expect(fake.globalEvent.findMany).not.toHaveBeenCalled();
    expect(fake.clientExposureProfile.update).not.toHaveBeenCalled();
  });

  it('back-matches and stores the fingerprint only after success', async () => {
    const profile = { suppliers: [{ id: 's2' }] };
    fake.clientExposureProfile.findUnique.mockResolvedValue({ ...profile, back_match_fingerprint: 'old' });
    fake.globalEvent.findMany.mockResolvedValueOnce([event(1)]);

    expect(await backMatchIfProfileChanged(ORG)).toBe(1);
    expect(fake.clientExposureProfile.update).toHaveBeenCalledWith({
      where: { organization_id: ORG },
      data: { back_match_fingerprint: profileFingerprint(profile as never) },
    });
  });

  it('leaves the fingerprint stale on failure so the next call retries', async () => {
    fake.clientExposureProfile.findUnique.mockResolvedValue({ suppliers: [], back_match_fingerprint: 'old' });
    fake.globalEvent.findMany.mockResolvedValueOnce([event(1)]);
    fake.messageQueue.createMany.mockRejectedValueOnce(new Error('db down'));

    await expect(backMatchIfProfileChanged(ORG)).rejects.toThrow('db down');
    expect(fake.clientExposureProfile.update).not.toHaveBeenCalled();
  });

  it('returns 0 when the org has no profile', async () => {
    fake.clientExposureProfile.findUnique.mockResolvedValue(null);
    expect(await backMatchIfProfileChanged(ORG)).toBe(0);
  });
});
