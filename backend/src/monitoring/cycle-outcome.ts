/**
 * How a monitoring cycle that threw is reported to a streaming client (#72).
 *
 * Two outcomes are policy, not failure: the root org is never monitored
 * (MonitoringExcludedError) and an org without a provider key is skipped
 * (MissingApiKeyError). They carry `outcome: 'skipped'` and a skip `code`;
 * anything else is `outcome: 'failed'`, code CYCLE_ERROR.
 *
 * The event `type` stays 'error' for every outcome on purpose: the frontend
 * (Vercel) and backend (Coolify) deploy separately, and a dialog built before
 * #72 only treats 'complete' and 'error' as the end of the stream. A new
 * dialog reads `outcome`/`code` and shows a skip as neutral.
 */
export type CycleSkipCode = 'ORGANIZATION_EXCLUDED' | 'ORGANIZATION_SKIPPED';

export interface CycleTerminalEvent {
  type: 'error';
  outcome: 'skipped' | 'failed';
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
  return code
    ? { type: 'error', outcome: 'skipped', code, message }
    : { type: 'error', outcome: 'failed', code: 'CYCLE_ERROR', message };
}
