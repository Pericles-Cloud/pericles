/**
 * Shipment write checks (#95): a shipment may only link a supplier of its OWN
 * organization, and an existing carrier (carriers are global).
 *
 * The checks LOCK what they check, inside the write transaction:
 * - the organization (create), supplier and carrier with FOR KEY SHARE: a
 *   concurrent DELETE waits until this write commits, while ordinary UPDATEs
 *   of those rows (settings, seeding) are not blocked;
 * - (update) the shipment row with FOR UPDATE.
 *
 * Lock order is parent first, then the shipment: organization -> supplier ->
 * carrier -> shipment. That is the order a cascading DELETE locks in
 * (org -> its suppliers -> their shipments), so the two wait for each other
 * instead of deadlocking. A link the request re-sends unchanged is not
 * locked at all.
 *
 * So there is no window between check and write, and no Prisma error to
 * interpret afterwards: any other failure is a genuine 500.
 *
 * Failures are ShipmentRequestError (400 or 404). A missing supplier and
 * another tenant's supplier get the same message, so nothing is revealed
 * about other tenants.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export const SUPPLIER_LINK_MESSAGE = "supplierId must be an existing supplier of the shipment's organization";
export const CARRIER_LINK_MESSAGE = 'carrierId must be an existing carrier';

/** A shipment request that can't be applied: the status and body to send. */
export class ShipmentRequestError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    public readonly code: 'INVALID_LINK' | 'NOT_FOUND' | 'CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'ShipmentRequestError';
  }
}

const invalidLink = (message: string) => new ShipmentRequestError(400, 'INVALID_LINK', message);

/** undefined = leave unchanged, null or '' = clear, else an id (max 128). */
const LinkIdSchema = z
  .string()
  .max(128)
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v));

type LinkId = string | null | undefined;

function parseLinkId(value: unknown, message: string): LinkId {
  const parsed = LinkIdSchema.safeParse(value);
  if (!parsed.success) throw invalidLink(message);
  return parsed.data;
}

/** Only raw queries are needed: Prisma's query builder has no row locks. */
export type LockClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Create: the organization must exist; held (FOR KEY SHARE) until the write commits. */
export async function lockOrganization(tx: LockClient, organizationId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Organization" WHERE id = ${organizationId} FOR KEY SHARE`;
  if (rows.length === 0) throw new ShipmentRequestError(404, 'NOT_FOUND', 'Organization not found');
}

/** A shipment's current links. */
export interface ShipmentLinks {
  supplierId: string | null;
  carrierId: string | null;
}

/**
 * Update: lock the shipment row (FOR UPDATE), AFTER the links it will point
 * to (lock order). 404 if it no longer exists in that organization; 409 if
 * its links changed since the handler's snapshot, because the checks above
 * were decided on that snapshot (the client should reload and retry).
 */
export async function lockShipment(
  tx: LockClient,
  shipmentId: string,
  organizationId: string,
  snapshot: ShipmentLinks
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ supplier_id: string | null; carrier_id: string | null }>>`
    SELECT supplier_id, carrier_id FROM "Shipment" WHERE id = ${shipmentId} AND organization_id = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) throw new ShipmentRequestError(404, 'NOT_FOUND', 'Shipment not found');
  if (rows[0].supplier_id !== snapshot.supplierId || rows[0].carrier_id !== snapshot.carrierId) {
    throw new ShipmentRequestError(409, 'CONFLICT', 'The shipment was changed by someone else; reload and try again');
  }
}

/**
 * The supplier_id to write: undefined (unchanged), null (clear), or a
 * supplier of `organizationId`, locked FOR KEY SHARE until the write commits.
 *
 * `currentSupplierId` (update only: the handler's snapshot, confirmed by
 * lockShipment): re-sending it is not a change and is not locked. The edit form always sends it, so an existing cross-org link
 * doesn't block unrelated edits; any NEW link must be same-org.
 */
export async function resolveShipmentSupplierId(
  tx: LockClient,
  supplierId: unknown,
  organizationId: string,
  currentSupplierId?: string | null
): Promise<LinkId> {
  const id = parseLinkId(supplierId, SUPPLIER_LINK_MESSAGE);
  if (id === undefined || id === null) return id;
  if (currentSupplierId !== undefined && id === currentSupplierId) return undefined;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Supplier" WHERE id = ${id} AND organization_id = ${organizationId} FOR KEY SHARE`;
  if (rows.length === 0) throw invalidLink(SUPPLIER_LINK_MESSAGE);
  return rows[0].id;
}

/**
 * The carrier_id to write: undefined (unchanged), null (clear), or an existing
 * carrier (locked FOR KEY SHARE). `currentCarrierId` as for suppliers: the
 * edit form always sends it, and re-sending it is not a change.
 */
export async function resolveShipmentCarrierId(
  tx: LockClient,
  carrierId: unknown,
  currentCarrierId?: string | null
): Promise<LinkId> {
  const id = parseLinkId(carrierId, CARRIER_LINK_MESSAGE);
  if (id === undefined || id === null) return id;
  if (currentCarrierId !== undefined && id === currentCarrierId) return undefined;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Carrier" WHERE id = ${id} FOR KEY SHARE`;
  if (rows.length === 0) throw invalidLink(CARRIER_LINK_MESSAGE);
  return rows[0].id;
}

/** The supplier fields every shipment response selects (one place, #95). */
export const SHIPMENT_SUPPLIER_SELECT = { id: true, name: true, country: true, organization_id: true } as const;

/**
 * A shipment's supplier as the API returns it. `sameOrganization` is false
 * for a legacy link to another tenant's supplier; that tenant's org id is
 * never returned.
 */
export function toShipmentSupplier(
  shipmentOrganizationId: string,
  supplier: { id: string; name: string; country: string | null; organization_id: string; address?: string | null } | null
): { id: string; name: string; country: string | null; address?: string | null; sameOrganization: boolean } | null {
  if (!supplier) return null;
  return {
    id: supplier.id,
    name: supplier.name,
    country: supplier.country,
    ...(supplier.address !== undefined && { address: supplier.address }),
    sameOrganization: supplier.organization_id === shipmentOrganizationId,
  };
}
