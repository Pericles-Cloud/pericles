/**
 * Shipment write checks (#95): a shipment may only link a supplier of its OWN
 * organization, and an existing carrier (carriers are global).
 *
 * The checks LOCK what they check, inside the write transaction:
 * - the supplier, carrier and (on create) organization with FOR SHARE, so a
 *   concurrent delete waits until this write commits;
 * - (on update) the shipment row with FOR UPDATE, which also gives the
 *   current supplier_id exactly.
 * So there is no window between check and write, and no need to interpret a
 * Prisma error afterwards: any other failure is a genuine 500.
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
    public readonly status: 400 | 404,
    public readonly code: 'INVALID_LINK' | 'NOT_FOUND',
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

/** Create: the organization must exist; held (FOR SHARE) until the write commits. */
export async function lockOrganization(tx: LockClient, organizationId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Organization" WHERE id = ${organizationId} FOR SHARE`;
  if (rows.length === 0) throw new ShipmentRequestError(404, 'NOT_FOUND', 'Organization not found');
}

/**
 * Update: lock the shipment row (FOR UPDATE) and return its current
 * supplier_id. 404 if it no longer exists in that organization.
 */
export async function lockShipment(
  tx: LockClient,
  shipmentId: string,
  organizationId: string
): Promise<{ supplierId: string | null }> {
  const rows = await tx.$queryRaw<Array<{ supplier_id: string | null }>>`
    SELECT supplier_id FROM "Shipment" WHERE id = ${shipmentId} AND organization_id = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) throw new ShipmentRequestError(404, 'NOT_FOUND', 'Shipment not found');
  return { supplierId: rows[0].supplier_id };
}

/**
 * The supplier_id to write: undefined (unchanged), null (clear), or a
 * supplier of `organizationId`, locked FOR SHARE until the write commits.
 *
 * `currentSupplierId` (update only, from lockShipment): re-sending it is not
 * a change. The edit form always sends it, so an existing cross-org link
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
    SELECT id FROM "Supplier" WHERE id = ${id} AND organization_id = ${organizationId} FOR SHARE`;
  if (rows.length === 0) throw invalidLink(SUPPLIER_LINK_MESSAGE);
  return rows[0].id;
}

/** The carrier_id to write: undefined (unchanged), null (clear), or an existing carrier (locked). */
export async function resolveShipmentCarrierId(tx: LockClient, carrierId: unknown): Promise<LinkId> {
  const id = parseLinkId(carrierId, CARRIER_LINK_MESSAGE);
  if (id === undefined || id === null) return id;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Carrier" WHERE id = ${id} FOR SHARE`;
  if (rows.length === 0) throw invalidLink(CARRIER_LINK_MESSAGE);
  return rows[0].id;
}
