/**
 * Dispatch table — routes must match the Doctrine §13 table (Pure: no I/O).
 */
import { describe, it, expect } from 'vitest';
import type { ChangeRecord, RecordType } from '../records/change-record.js';
import { routesFor, HIGH_SEVERITY_THRESHOLD } from './dispatch-table.js';

const ORG = '11111111-1111-1111-1111-111111111111';

const make = (record_type: RecordType, payload: Record<string, unknown>, organization_id: string | null = ORG): ChangeRecord => ({
  record_id: 'r-1',
  record_version: 1,
  record_type,
  organization_id,
  produced_at: '2026-10-13T12:00:00.000Z',
  payload,
});

const names = (record: ChangeRecord) => routesFor(record).map((r) => r.consumer);

describe('routesFor — global_event_change', () => {
  it('sends a low-severity created event to client monitoring only', () => {
    expect(names(make('global_event_change', { change_kind: 'created', severity: 0.2 }))).toEqual(['client_monitoring']);
  });

  it('adds event verification at the high-severity cutoff', () => {
    expect(
      names(make('global_event_change', { change_kind: 'created', severity: HIGH_SEVERITY_THRESHOLD }))
    ).toEqual(['client_monitoring', 'event_verification']);
  });

  it('does not add verification for an update that is not an upgrade', () => {
    expect(names(make('global_event_change', { change_kind: 'updated', severity: 0.9 }))).toEqual(['client_monitoring']);
  });
});

describe('routesFor — candidate_exposure', () => {
  it('verifies first when no valid verification exists, then validates exposure', () => {
    expect(names(make('candidate_exposure', {}))).toEqual(['event_verification', 'exposure_validation']);
  });

  it('skips verification when a valid verification exists', () => {
    expect(names(make('candidate_exposure', { has_valid_verification: true }))).toEqual(['exposure_validation']);
  });
});

describe('routesFor — confirmed_exposure', () => {
  it('sends a non-strategic exposure to impact assessment and summarization', () => {
    expect(names(make('confirmed_exposure', { strategic: false }))).toEqual(['impact_assessment', 'summarization']);
  });

  it('sends a strategic exposure to notification rules only', () => {
    expect(names(make('confirmed_exposure', { strategic: true }))).toEqual(['notification_rules']);
  });
});

describe('routesFor — impact_assessment', () => {
  it('summarizes only on an initial or material change', () => {
    const base = ['threshold_evaluation', 'notification_rules', 'plans_trigger_engine', 'card_severity', 'lifecycle_derivation'];
    expect(names(make('impact_assessment', { change_significance: 'initial' }))).toEqual([...base, 'summarization']);
    expect(names(make('impact_assessment', { change_significance: 'material' }))).toEqual([...base, 'summarization']);
    expect(names(make('impact_assessment', { change_significance: 'minor' }))).toEqual(base);
  });
});

describe('routesFor — plan_execution_event', () => {
  it('routes a communication proposal through the approval gate, then the handler', () => {
    expect(names(make('plan_execution_event', { kind: 'communication_proposed' }))).toEqual([
      'notification_rules',
      'approval_gate',
      'notification_handler',
    ]);
  });

  it('routes other plan events to notification rules only', () => {
    expect(names(make('plan_execution_event', { kind: 'task_completed' }))).toEqual(['notification_rules']);
  });
});

describe('routesFor — fixed routes', () => {
  it('sends a brief version to accuracy review, then publish', () => {
    expect(names(make('brief_version', {}))).toEqual(['accuracy_agent', 'publish']);
  });

  it('sends an exposure end to the closure summary, then the memory write', () => {
    expect(names(make('exposure_ended', {}))).toEqual(['closure_summary', 'organizational_memory_write']);
  });

  it('has a route entry for every record type', () => {
    const types: RecordType[] = [
      'global_event_change', 'candidate_exposure', 'confirmed_exposure', 'impact_assessment',
      'brief_version', 'plan_execution_event', 'exposure_ended',
    ];
    for (const type of types) {
      expect(routesFor(make(type, {}, type === 'global_event_change' ? null : ORG)).length).toBeGreaterThan(0);
    }
  });
});
