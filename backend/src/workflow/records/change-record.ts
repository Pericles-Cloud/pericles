/**
 * Change-record contract (Doctrine §13).
 *
 * Agents emit change records onto the message queue; the workflow engine
 * dispatches each record to its consumers. Delivery is at least once, so every
 * consumer is idempotent on (record_id, record_version).
 *
 * `organization_id` is required for every record type except
 * `global_event_change`. Events are organization-scoped today, so the first
 * global records carry the event's own org. See pericles-doctrine §13.
 */

import { z } from 'zod';

export const RECORD_TYPES = [
  'global_event_change',
  'candidate_exposure',
  'confirmed_exposure',
  'impact_assessment',
  'brief_version',
  'plan_execution_event',
  'exposure_ended',
] as const;

export const RecordTypeSchema = z.enum(RECORD_TYPES);
export type RecordType = z.infer<typeof RecordTypeSchema>;

export const ChangeRecordSchema = z
  .object({
    record_id: z.string().min(1),
    record_version: z.number().int().positive(),
    record_type: RecordTypeSchema,
    organization_id: z.string().min(1).nullable(),
    produced_at: z.string().datetime(),
    // Per-type payload shape is validated where routing needs it (dispatch-table.ts).
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((record, ctx) => {
    if (record.organization_id === null && record.record_type !== 'global_event_change') {
      ctx.addIssue({
        code: 'custom',
        path: ['organization_id'],
        message: `organization_id is required for ${record.record_type} records`,
      });
    }
  });

export type ChangeRecord = z.infer<typeof ChangeRecordSchema>;

/** Parse an untrusted queue payload. Throws a ZodError on invalid input. */
export function parseChangeRecord(input: unknown): ChangeRecord {
  return ChangeRecordSchema.parse(input);
}

/** Idempotency key shared by the queue row and every consumer. */
export function changeRecordKey(record: Pick<ChangeRecord, 'record_id' | 'record_version'>): string {
  return `${record.record_id}:${record.record_version}`;
}
