import { describe, it, expect } from 'vitest';
import { cycleSkipCode, cycleTerminalEvent } from './cycle-outcome.js';

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('cycleTerminalEvent (#72)', () => {
  it('the root org (excluded) is a skip, not a failure', () => {
    expect(cycleTerminalEvent(named('MonitoringExcludedError', 'excluded'))).toEqual({
      type: 'error',
      outcome: 'skipped',
      code: 'ORGANIZATION_EXCLUDED',
      message: 'excluded',
    });
  });

  it('a missing provider key is a skip, with its message', () => {
    expect(cycleTerminalEvent(named('MissingApiKeyError', 'no key'))).toEqual({
      type: 'error',
      outcome: 'skipped',
      code: 'ORGANIZATION_SKIPPED',
      message: 'no key',
    });
  });

  it("keeps type 'error' for every outcome (a pre-#72 dialog only ends the stream on complete/error)", () => {
    for (const e of [named('MissingApiKeyError', 'x'), named('MonitoringExcludedError', 'x'), new Error('x')]) {
      expect(cycleTerminalEvent(e).type).toBe('error');
    }
  });

  it('anything else is a real failure', () => {
    expect(cycleTerminalEvent(new Error('boom'))).toEqual({
      type: 'error',
      outcome: 'failed',
      code: 'CYCLE_ERROR',
      message: 'boom',
    });
    expect(cycleTerminalEvent(undefined).message).toBe('Monitoring cycle failed');
    expect(cycleSkipCode(new TypeError('x'))).toBeNull();
  });
});
