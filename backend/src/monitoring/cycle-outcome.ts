/**
 * How a monitoring cycle that threw is reported to a streaming client (#72).
 *
 * Two outcomes are policy, not failure: the root org is never monitored
 * (MonitoringExcludedError) and an org without a provider key is skipped
 * (MissingApiKeyError). They end the stream as `type: 'skipped'`, so a
 * client switching on `type` never mistakes them for an error; the `code`
 * says which. Anything else is `type: 'error'`, code CYCLE_ERROR.
 */
export type CycleSkipCode = 'ORGANIZATION_EXCLUDED' | 'ORGANIZATION_SKIPPED';

export interface CycleTerminalEvent {
  type: 'skipped' | 'error';
  code: CycleSkipCode | 'CYCLE_ERROR';
  message: string;
}

/** The skip code for a policy outcome, or null if the error is a real failure. */
export function cycleSkipCode(error: unknown): CycleSkipCode | null {
  const name = (error as Error | null)?.name;
  if (name === 'MonitoringExcludedError') return 'ORGANIZATION_EXCLUDED';
  if (name === 'MissingApiKeyError') return 'ORGANIZATION_SKIPPED';
  return null;
}

export function cycleTerminalEvent(error: unknown): CycleTerminalEvent {
  const message = (error as Error | null)?.message || 'Monitoring cycle failed';
  const code = cycleSkipCode(error);
  return code ? { type: 'skipped', code, message } : { type: 'error', code: 'CYCLE_ERROR', message };
}
