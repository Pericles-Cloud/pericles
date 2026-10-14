/**
 * Consumer registry (Doctrine §13).
 *
 * A consumer is registered only when it has real behavior. The registry starts
 * empty: the agents and engines the dispatch table names are not built yet. A
 * route with no registered consumer is logged as `skipped_noop`, so the table
 * stays complete and testable, and nothing is marked done when it did not run.
 */

import type { ChangeRecord } from '../records/change-record.js';
import type { ConsumerName } from './dispatch-table.js';

export interface ConsumerContext {
  record: ChangeRecord;
  /** Aborts after the per-stage timeout. Consumers must pass it to their I/O. */
  signal: AbortSignal;
}

export type ConsumerHandler = (ctx: ConsumerContext) => Promise<void>;

export interface ConsumerRegistry {
  get(name: ConsumerName): ConsumerHandler | undefined;
}

/** Build a registry from explicit entries. Production code passes none yet. */
export function createConsumerRegistry(
  entries: Partial<Record<ConsumerName, ConsumerHandler>> = {}
): ConsumerRegistry {
  const handlers = new Map<ConsumerName, ConsumerHandler>(
    Object.entries(entries) as Array<[ConsumerName, ConsumerHandler]>
  );
  return {
    get: (name) => handlers.get(name),
  };
}
