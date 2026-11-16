/**
 * Dispatch worker — claim size (issue #76).
 */
import { describe, it, expect, vi } from 'vitest';

const consume = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ stop: vi.fn() })));

vi.mock('../consumers/client-monitoring.js', () => ({ clientMonitoringConsumer: vi.fn() }));
vi.mock('../../monitoring/db-client.js', () => ({ getPrismaClient: () => ({}) }));
vi.mock('../../monitoring/queue-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Queue>()),
  consumeFromQueue: consume,
}));

import type * as Queue from '../../monitoring/queue-client.js';
import { startDispatchWorker, DISPATCH_CLAIM_BATCH_SIZE } from './dispatch-worker.js';

describe('startDispatchWorker', () => {
  it('claims one record per poll by default, so long LLM stages do not hold rows other workers could take', () => {
    startDispatchWorker();
    expect(DISPATCH_CLAIM_BATCH_SIZE).toBe(1);
    expect(consume.mock.calls[0][2]).toMatchObject({ batchSize: 1 });
  });

  it('honours an explicit batch size', () => {
    startDispatchWorker({ batchSize: 4 });
    expect(consume.mock.calls.at(-1)?.[2]).toMatchObject({ batchSize: 4 });
  });
});
