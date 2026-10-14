/**
 * Dispatch table (Doctrine §13). Maps each change-record type to the consumers
 * that receive it. The routes are data, so the table can be read and tested
 * against the Notion dispatch table directly.
 *
 * Route order is the order consumers run in. A failing consumer does not stop
 * the rest (see dispatcher.ts).
 */

import type { ChangeRecord, RecordType } from '../records/change-record.js';

/**
 * High-severity cutoff, 0.7. The monitoring tools use the same value for their
 * 'high' threshold. Critical has no separate cutoff yet, so both route here.
 */
export const HIGH_SEVERITY_THRESHOLD = 0.7;

export type ConsumerName =
  | 'client_monitoring'
  | 'event_verification'
  | 'exposure_validation'
  | 'impact_assessment'
  | 'summarization'
  | 'notification_rules'
  | 'threshold_evaluation'
  | 'plans_trigger_engine'
  | 'card_severity'
  | 'lifecycle_derivation'
  | 'accuracy_agent'
  | 'publish'
  | 'approval_gate'
  | 'notification_handler'
  | 'closure_summary'
  | 'organizational_memory_write';

export interface DispatchRoute {
  consumer: ConsumerName;
  /** Omit to route every record of this type. */
  when?: (record: ChangeRecord) => boolean;
}

const payloadString = (record: ChangeRecord, key: string): string | undefined => {
  const value = record.payload[key];
  return typeof value === 'string' ? value : undefined;
};

const severityAtLeastHigh = (record: ChangeRecord): boolean => {
  const severity = record.payload.severity;
  return typeof severity === 'number' && severity >= HIGH_SEVERITY_THRESHOLD;
};

const isStrategic = (record: ChangeRecord): boolean => record.payload.strategic === true;

const isMaterialImpact = (record: ChangeRecord): boolean => {
  const significance = payloadString(record, 'change_significance');
  return significance === 'initial' || significance === 'material';
};

export const DISPATCH_TABLE: Record<RecordType, DispatchRoute[]> = {
  global_event_change: [
    { consumer: 'client_monitoring' },
    {
      consumer: 'event_verification',
      when: (r) =>
        severityAtLeastHigh(r) &&
        (payloadString(r, 'change_kind') === 'created' || payloadString(r, 'change_kind') === 'upgraded'),
    },
  ],

  candidate_exposure: [
    { consumer: 'event_verification', when: (r) => r.payload.has_valid_verification !== true },
    { consumer: 'exposure_validation' },
  ],

  confirmed_exposure: [
    { consumer: 'notification_rules', when: isStrategic },
    { consumer: 'impact_assessment', when: (r) => !isStrategic(r) },
    { consumer: 'summarization', when: (r) => !isStrategic(r) },
  ],

  impact_assessment: [
    { consumer: 'threshold_evaluation' },
    { consumer: 'notification_rules' },
    { consumer: 'plans_trigger_engine' },
    { consumer: 'card_severity' },
    { consumer: 'lifecycle_derivation' },
    { consumer: 'summarization', when: isMaterialImpact },
  ],

  brief_version: [{ consumer: 'accuracy_agent' }, { consumer: 'publish' }],

  plan_execution_event: [
    { consumer: 'notification_rules' },
    { consumer: 'approval_gate', when: (r) => payloadString(r, 'kind') === 'communication_proposed' },
    { consumer: 'notification_handler', when: (r) => payloadString(r, 'kind') === 'communication_proposed' },
  ],

  exposure_ended: [{ consumer: 'closure_summary' }, { consumer: 'organizational_memory_write' }],
};

/** The consumers that should run for this record, in order. */
export function routesFor(record: ChangeRecord): DispatchRoute[] {
  return DISPATCH_TABLE[record.record_type].filter((route) => !route.when || route.when(record));
}
