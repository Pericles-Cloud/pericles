/**
 * Dispatch worker — claim batch sized to the queue lease (issue #76).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../consumers/client-monitoring.js', () => ({ clientMonitoringConsumer: vi.fn() }));

import { leaseSafeBatchSize } from './dispatch-worker.js';
import { maxRecordBudgetMs, DEFAULT_STAGE_TIMEOUT_MS } from './dispatcher.js';
import { STALE_LOCK_SECONDS } from '../../monitoring/queue-client.js';

describe('leaseSafeBatchSize', () => {
  it('keeps batch × worst-case record time inside the lease', () => {
    const batch = leaseSafeBatchSize(undefined, DEFAULT_STAGE_TIMEOUT_MS);
    expect(batch).toBeGreaterThanOrEqual(1);
    expect(batch * maxRecordBudgetMs(DEFAULT_STAGE_TIMEOUT_MS)).toBeLessThan(STALE_LOCK_SECONDS * 1000);
  });

  it('caps a requested batch that would outlive the lease', () => {
    expect(leaseSafeBatchSize(10, DEFAULT_STAGE_TIMEOUT_MS)).toBeLessThan(10);
  });

  it('never goes below 1', () => {
    expect(leaseSafeBatchSize(10, 600_000)).toBe(1);
  });

  it('honours a smaller requested batch', () => {
    expect(leaseSafeBatchSize(1, DEFAULT_STAGE_TIMEOUT_MS)).toBe(1);
  });
});
