/**
 * Prisma error classification shared by the queue, dispatcher and stores.
 * Duck-typed on `code` so it also recognises errors from mocked clients.
 */

/** Unique-constraint violation (P2002): a concurrent writer won the key. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
