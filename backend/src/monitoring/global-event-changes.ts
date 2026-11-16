/**
 * The single producer of Global Event Store change records (Doctrine §13).
 *
 * Every create, material update and status change of a GlobalEvent goes
 * through here, so each gets the next per-event version and reaches
 * client_monitoring. Writers that change an event without calling this leave
 * customers' exposures stale.
 */

import type { Prisma } from '@prisma/client';
import { enqueueInTransaction, CHANGE_RECORD_QUEUE } from './queue-client.js';
import { changeRecordQueueItem } from '../workflow/records/change-record.js';
import {
  globalEventStoreChangeRecord,
  type GlobalEventStoreChangePayload,
} from '../workflow/records/global-event-change.js';

export async function emitGlobalEventChange(
  client: Prisma.TransactionClient,
  payload: GlobalEventStoreChangePayload,
  producedAt: Date = new Date()
): Promise<void> {
  const { change_seq } = await client.globalEvent.update({
    where: { id: payload.event_id },
    data: { change_seq: { increment: 1 } },
    select: { change_seq: true },
  });
  const { message, idempotencyKey } = changeRecordQueueItem(
    globalEventStoreChangeRecord(payload, change_seq, producedAt)
  );
  await enqueueInTransaction(client, CHANGE_RECORD_QUEUE, message, { idempotencyKey });
}
