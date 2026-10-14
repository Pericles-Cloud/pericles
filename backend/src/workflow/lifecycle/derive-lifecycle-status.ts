/**
 * Customer event lifecycle, derived (Doctrine §13).
 *
 * No agent sets this status. It is computed from record state on read. The
 * precedence is fixed and tested:
 *
 *   1. Strategic items: Closed when the global event is Resolved or Retracted,
 *      or the initiative is removed; otherwise Monitoring. Never any other status.
 *   2. exposure_state ended: Closed.
 *   3. A plan escalation is open, or impact is Critical: Escalated.
 *   4. The global event is De-escalating or Resolved, or all assets are cleared
 *      (exposure still active): Resolving.
 *   5. A plan is active: Active Response.
 *   6. Otherwise: Monitoring.
 */

export type LifecycleStatus = 'Monitoring' | 'Active Response' | 'Escalated' | 'Resolving' | 'Closed';

export type GlobalEventStatus = 'Active' | 'De-escalating' | 'Resolved' | 'Retracted';

export type ImpactSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface LifecycleInputs {
  exposure_state: 'active' | 'ended';
  is_strategic: boolean;
  plan_active: boolean;
  plan_escalation_open: boolean;
  impact_severity: ImpactSeverity;
  global_event_status: GlobalEventStatus;
  all_assets_cleared: boolean;
  initiative_removed: boolean;
}

export function deriveLifecycleStatus(inputs: LifecycleInputs): LifecycleStatus {
  if (inputs.is_strategic) {
    const closed =
      inputs.initiative_removed ||
      inputs.global_event_status === 'Resolved' ||
      inputs.global_event_status === 'Retracted';
    return closed ? 'Closed' : 'Monitoring';
  }

  if (inputs.exposure_state === 'ended') return 'Closed';

  if (inputs.plan_escalation_open || inputs.impact_severity === 'critical') return 'Escalated';

  if (
    inputs.global_event_status === 'De-escalating' ||
    inputs.global_event_status === 'Resolved' ||
    inputs.all_assets_cleared
  ) {
    return 'Resolving';
  }

  if (inputs.plan_active) return 'Active Response';

  return 'Monitoring';
}
