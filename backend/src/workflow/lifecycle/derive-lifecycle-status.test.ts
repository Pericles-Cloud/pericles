/**
 * deriveLifecycleStatus — precedence and invariant tests (Doctrine §13).
 * Pure: no I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveLifecycleStatus,
  type GlobalEventStatus,
  type ImpactSeverity,
  type LifecycleInputs,
} from './derive-lifecycle-status.js';

const BASE: LifecycleInputs = {
  exposure_state: 'active',
  is_strategic: false,
  plan_active: false,
  plan_escalation_open: false,
  impact_severity: 'medium',
  global_event_status: 'Active',
  all_assets_cleared: false,
  initiative_removed: false,
};

const EXPOSURE: Array<LifecycleInputs['exposure_state']> = ['active', 'ended'];
const BOOLS = [false, true];
const SEVERITIES: ImpactSeverity[] = ['low', 'medium', 'high', 'critical'];
const GLOBAL: GlobalEventStatus[] = ['Active', 'De-escalating', 'Resolved', 'Retracted'];

describe('deriveLifecycleStatus — named rows', () => {
  it('is Monitoring with no plan and no escalation', () => {
    expect(deriveLifecycleStatus(BASE)).toBe('Monitoring');
  });

  it('is Active Response when a plan is active', () => {
    expect(deriveLifecycleStatus({ ...BASE, plan_active: true })).toBe('Active Response');
  });

  it('is Escalated when a plan escalation is open', () => {
    expect(deriveLifecycleStatus({ ...BASE, plan_active: true, plan_escalation_open: true })).toBe(
      'Escalated'
    );
  });

  it('is Escalated when impact severity is Critical', () => {
    expect(deriveLifecycleStatus({ ...BASE, impact_severity: 'critical' })).toBe('Escalated');
  });

  it('is Resolving when the global event is De-escalating', () => {
    expect(deriveLifecycleStatus({ ...BASE, global_event_status: 'De-escalating' })).toBe('Resolving');
  });

  it('is Resolving when all assets are cleared while the exposure is still active', () => {
    expect(deriveLifecycleStatus({ ...BASE, all_assets_cleared: true })).toBe('Resolving');
  });

  it('is Closed when the exposure has ended', () => {
    expect(deriveLifecycleStatus({ ...BASE, exposure_state: 'ended', plan_active: true })).toBe('Closed');
  });

  it('gives Escalated precedence over Resolving', () => {
    expect(
      deriveLifecycleStatus({ ...BASE, impact_severity: 'critical', global_event_status: 'De-escalating' })
    ).toBe('Escalated');
  });

  it('gives Resolving precedence over Active Response', () => {
    expect(
      deriveLifecycleStatus({ ...BASE, plan_active: true, global_event_status: 'Resolved' })
    ).toBe('Resolving');
  });

  it('keeps a strategic item in Monitoring while its global event is active', () => {
    expect(deriveLifecycleStatus({ ...BASE, is_strategic: true, plan_active: true })).toBe('Monitoring');
  });

  it('closes a strategic item when the global event is Resolved', () => {
    expect(deriveLifecycleStatus({ ...BASE, is_strategic: true, global_event_status: 'Resolved' })).toBe(
      'Closed'
    );
  });

  it('closes a strategic item when the initiative is removed', () => {
    expect(deriveLifecycleStatus({ ...BASE, is_strategic: true, initiative_removed: true })).toBe('Closed');
  });
});

describe('deriveLifecycleStatus — invariants over every input combination', () => {
  // Enumerate the full input space: 2*2*2*2*4*4*2*2 = 1024 combinations.
  const combos: LifecycleInputs[] = [];
  for (const exposure_state of EXPOSURE)
    for (const is_strategic of BOOLS)
      for (const plan_active of BOOLS)
        for (const plan_escalation_open of BOOLS)
          for (const impact_severity of SEVERITIES)
            for (const global_event_status of GLOBAL)
              for (const all_assets_cleared of BOOLS)
                for (const initiative_removed of BOOLS)
                  combos.push({
                    exposure_state,
                    is_strategic,
                    plan_active,
                    plan_escalation_open,
                    impact_severity,
                    global_event_status,
                    all_assets_cleared,
                    initiative_removed,
                  });

  it('covers the full 1024-case input space', () => {
    expect(combos).toHaveLength(1024);
  });

  it('strategic items are only ever Monitoring or Closed', () => {
    for (const input of combos.filter((c) => c.is_strategic)) {
      expect(['Monitoring', 'Closed']).toContain(deriveLifecycleStatus(input));
    }
  });

  it('an ended non-strategic exposure is always Closed', () => {
    for (const input of combos.filter((c) => !c.is_strategic && c.exposure_state === 'ended')) {
      expect(deriveLifecycleStatus(input)).toBe('Closed');
    }
  });

  it('a Critical non-strategic active exposure is always Escalated', () => {
    for (const input of combos.filter(
      (c) => !c.is_strategic && c.exposure_state === 'active' && c.impact_severity === 'critical'
    )) {
      expect(deriveLifecycleStatus(input)).toBe('Escalated');
    }
  });

  it('never returns Escalated without an escalation or Critical impact on an active non-strategic exposure', () => {
    for (const input of combos.filter((c) => !c.is_strategic && c.exposure_state === 'active')) {
      if (deriveLifecycleStatus(input) === 'Escalated') {
        expect(input.plan_escalation_open || input.impact_severity === 'critical').toBe(true);
      }
    }
  });
});
