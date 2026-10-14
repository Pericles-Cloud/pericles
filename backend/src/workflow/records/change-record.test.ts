/**
 * Change-record contract tests (Doctrine §13). Pure: no I/O.
 */
import { describe, it, expect } from 'vitest';
import { parseChangeRecord, changeRecordKey, RECORD_TYPES } from './change-record.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const NOW = '2026-10-13T12:00:00.000Z';

const base = {
  record_id: 'evt-1',
  record_version: 1,
  record_type: 'global_event_change' as const,
  organization_id: ORG_ID,
  produced_at: NOW,
  payload: { change_kind: 'created', severity: 0.8 },
};

describe('parseChangeRecord', () => {
  it('accepts a well-formed record', () => {
    expect(parseChangeRecord(base)).toEqual(base);
  });

  it('allows a null organization_id only for global_event_change', () => {
    expect(parseChangeRecord({ ...base, organization_id: null }).organization_id).toBeNull();
  });

  it('rejects a null organization_id for every other record type', () => {
    for (const record_type of RECORD_TYPES.filter((t) => t !== 'global_event_change')) {
      expect(() =>
        parseChangeRecord({ ...base, record_type, organization_id: null })
      ).toThrow(/organization_id is required/);
    }
  });

  it('rejects a record_version below 1', () => {
    expect(() => parseChangeRecord({ ...base, record_version: 0 })).toThrow();
  });

  it('rejects a non-integer record_version', () => {
    expect(() => parseChangeRecord({ ...base, record_version: 1.5 })).toThrow();
  });

  it('rejects an unknown record_type', () => {
    expect(() => parseChangeRecord({ ...base, record_type: 'something_else' })).toThrow();
  });

  it('rejects a produced_at that is not an ISO datetime', () => {
    expect(() => parseChangeRecord({ ...base, produced_at: 'yesterday' })).toThrow();
  });

  it('rejects a missing record_id', () => {
    const { record_id: _omit, ...rest } = base;
    expect(() => parseChangeRecord(rest)).toThrow();
  });
});

describe('changeRecordKey', () => {
  it('joins record_id and record_version', () => {
    expect(changeRecordKey(base)).toBe('evt-1:1');
  });
});
