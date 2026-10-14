/**
 * Producer for `global_event_change` records (Doctrine §13).
 *
 * Events are organization-scoped today, so the record carries the event's own
 * organization_id. This is a known deviation from the Doctrine's null-org global
 * record. See pericles-doctrine §13.
 */

import { parseChangeRecord, type ChangeRecord } from './change-record.js';

export interface CreatedEventForRecord {
  id: string;
  organization_id: string;
  severity: number;
  type: string;
}

export function globalEventChangeRecord(event: CreatedEventForRecord, producedAt: Date): ChangeRecord {
  // Validate at the boundary, the same as the consumer side.
  return parseChangeRecord({
    record_id: event.id,
    record_version: 1,
    record_type: 'global_event_change',
    organization_id: event.organization_id,
    produced_at: producedAt.toISOString(),
    payload: {
      change_kind: 'created',
      severity: event.severity,
      event_type: event.type,
    },
  });
}
