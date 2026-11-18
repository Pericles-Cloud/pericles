import { describe, it, expect } from 'vitest';
import { cycleSkipCode, cycleTerminalEvent } from './cycle-outcome.js';
import { MonitoringExcludedError } from './index.js';

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('cycleTerminalEvent (#72)', () => {
  it('the root org (excluded) ends the stream as skipped, not error', () => {
    const e = new MonitoringExcludedError('00000000-0000-0000-0000-000000000001');
    expect(cycleTerminalEvent(e)).toMatchObject({ type: 'skipped', code: 'ORGANIZATION_EXCLUDED' });
  });

  it('a missing provider key ends the stream as skipped, with its message', () => {
    expect(cycleTerminalEvent(named('MissingApiKeyError', 'no key'))).toEqual({
      type: 'skipped',
      code: 'ORGANIZATION_SKIPPED',
      message: 'no key',
    });
  });

  it('anything else is a real error', () => {
    expect(cycleTerminalEvent(new Error('boom'))).toEqual({ type: 'error', code: 'CYCLE_ERROR', message: 'boom' });
    expect(cycleTerminalEvent(undefined)).toEqual({ type: 'error', code: 'CYCLE_ERROR', message: 'Monitoring cycle failed' });
    expect(cycleSkipCode(new TypeError('x'))).toBeNull();
  });
});
