/**
 * globalEventChangeRecord — producer output must satisfy the change-record contract.
 */
import { describe, it, expect } from 'vitest';
import { globalEventChangeRecord } from './global-event-change.js';
import { ChangeRecordSchema } from './change-record.js';

const EVENT = {
  id: 'evt-42',
  organization_id: '11111111-1111-1111-1111-111111111111',
  severity: 0.82,
  type: 'WEATHER_DISASTER',
};

describe('globalEventChangeRecord', () => {
  it('builds a version-1 created record for the event', () => {
    const record = globalEventChangeRecord(EVENT, new Date('2026-10-13T12:00:00Z'));

    expect(record).toEqual({
      record_id: 'evt-42',
      record_version: 1,
      record_type: 'global_event_change',
      organization_id: EVENT.organization_id,
      produced_at: '2026-10-13T12:00:00.000Z',
      payload: { change_kind: 'created', severity: 0.82, event_type: 'WEATHER_DISASTER' },
    });
  });

  it('always produces a record the contract accepts', () => {
    const record = globalEventChangeRecord(EVENT, new Date());
    expect(ChangeRecordSchema.safeParse(record).success).toBe(true);
  });
});
