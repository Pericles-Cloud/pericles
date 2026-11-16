/**
 * Global Event Store writes (issue #76): locking, no reopening, no repeat resolve,
 * materiality from what changed. Mocked Prisma and Mastra; no DB, no LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  globalEvent: { findUnique: vi.fn(), update: vi.fn() },
  messageQueue: { createMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));
vi.mock('../mastra/index.js', () => ({ mastra: { getAgent: vi.fn() } }));

import { updateGlobalEvent, resolveGlobalEvent } from './global-index.js';

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'ge-1',
  event_hash: 'h',
  status: 'ACTIVE',
  intrinsic_severity: 'medium',
  latitude: 10,
  timeline: [],
  ...overrides,
});
const emitted = () => fake.messageQueue.createMany.mock.calls.map((c) => c[0].data[0].payload.payload);
const writes = () => fake.globalEvent.update.mock.calls.map((c) => c[0].data).filter((d) => !('change_seq' in d));

beforeEach(() => {
  fake.$transaction.mockReset().mockImplementation((fn: (tx: unknown) => unknown) => fn(fake));
  fake.$queryRaw.mockReset().mockResolvedValue([]);
  fake.globalEvent.findUnique.mockReset().mockResolvedValue(event());
  let seq = 0;
  fake.globalEvent.update.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve('change_seq' in data ? { change_seq: ++seq } : {})
  );
  fake.messageQueue.createMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('updateGlobalEvent', () => {
  it('reads the event under its row lock, inside the transaction', async () => {
    await updateGlobalEvent({ event_id: 'ge-1', changes: [{ field: 'latitude', new_value: 11 }] });
    expect((fake.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?')).toMatch(/FOR UPDATE/);
    expect(fake.$transaction).toHaveBeenCalledTimes(1);
  });

  it('emits for a material change even when the model says is_material false', async () => {
    await updateGlobalEvent({
      event_id: 'ge-1',
      is_material: false,
      changes: [{ field: 'intrinsic_severity', new_value: 'Critical' }],
    });
    // Severity is normalised and the upgrade is visible to routing.
    expect(emitted()[0]).toMatchObject({
      change_type: 'updated',
      intrinsic_severity: 'critical',
      previous_intrinsic_severity: 'medium',
      changed_fields: ['intrinsic_severity'],
    });
  });

  it('refuses to reopen an ended event, and refuses terminal statuses in an update', async () => {
    fake.globalEvent.findUnique.mockResolvedValue(event({ status: 'RESOLVED' }));
    await updateGlobalEvent({ event_id: 'ge-1', changes: [{ field: 'status', new_value: 'ACTIVE' }] });
    fake.globalEvent.findUnique.mockResolvedValue(event());
    await updateGlobalEvent({ event_id: 'ge-1', changes: [{ field: 'status', new_value: 'RESOLVED' }] });

    expect(writes()).toEqual([]);
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });

  it('ignores fields outside the allow-list and values that did not change', async () => {
    await updateGlobalEvent({
      event_id: 'ge-1',
      changes: [
        { field: 'change_seq', new_value: 1 },
        { field: 'verification_ref', new_value: 'x' },
        { field: 'latitude', new_value: 10 },
      ],
    });
    expect(writes()).toEqual([]);
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });
});

describe('resolveGlobalEvent', () => {
  it('resolves and emits under the row lock', async () => {
    await resolveGlobalEvent({ event_id: 'ge-1', resolution_basis: 'source_restoration' });
    expect(writes()[0]).toMatchObject({ status: 'RESOLVED', resolution_basis: 'source_restoration' });
    expect(emitted()[0]).toMatchObject({ change_type: 'resolved', status: 'RESOLVED' });
  });

  it('does nothing for an event that has already ended (no rewrite, no second fan-out)', async () => {
    fake.globalEvent.findUnique.mockResolvedValue(event({ status: 'RETRACTED' }));
    await resolveGlobalEvent({ event_id: 'ge-1', resolution_basis: 'no_signal_timeout' });
    expect(writes()).toEqual([]);
    expect(fake.messageQueue.createMany).not.toHaveBeenCalled();
  });
});
