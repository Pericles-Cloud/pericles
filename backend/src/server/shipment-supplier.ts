/**
 * Validation of a shipment's links to a supplier and a carrier (#95).
 *
 * - Supplier: tenant-scoped. A shipment may only link a supplier of its OWN
 *   organization. A missing id and another tenant's id get the same error,
 *   so the check reveals nothing about other tenants.
 * - Carrier: global (not org-scoped); it only has to exist.
 *
 * Both run on the write transaction's client, so the check and the write see
 * the same data. Any failure is a ShipmentLinkError (a 400).
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export const SUPPLIER_LINK_MESSAGE = 'supplierId must be a supplier of the same organization as the shipment';
export const CARRIER_LINK_MESSAGE = 'carrierId must be an existing carrier';

/** A supplierId/carrierId the shipment may not link to: a 400. */
export class ShipmentLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShipmentLinkError';
  }
}

/** undefined = leave unchanged, null or '' = clear, else an id. */
const LinkIdSchema = z.union([z.string().min(1).max(128), z.null(), z.literal('')]).optional();

type LinkId = string | null | undefined;

function parseLinkId(value: unknown, message: string): LinkId {
  const parsed = LinkIdSchema.safeParse(value);
  if (!parsed.success) throw new ShipmentLinkError(message);
  return parsed.data === '' ? null : parsed.data;
}

type LinkClient = Pick<Prisma.TransactionClient, 'supplier' | 'carrier'>;

/**
 * The supplier_id to write: undefined (unchanged), null (clear), or a
 * supplier of `organizationId`.
 *
 * `currentSupplierId` (PATCH only, read in the same transaction): re-sending
 * the shipment's current supplier is not a change. The edit form always sends
 * it, so an existing cross-org link doesn't block unrelated edits; any NEW
 * link must be same-org.
 */
export async function resolveShipmentSupplierId(
  tx: LinkClient,
  supplierId: unknown,
  organizationId: string,
  currentSupplierId?: string | null
): Promise<LinkId> {
  const id = parseLinkId(supplierId, SUPPLIER_LINK_MESSAGE);
  if (id === undefined || id === null) return id;
  if (currentSupplierId !== undefined && id === currentSupplierId) return undefined;
  const supplier = await tx.supplier.findFirst({
    where: { id, organization_id: organizationId },
    select: { id: true },
  });
  if (!supplier) throw new ShipmentLinkError(SUPPLIER_LINK_MESSAGE);
  return supplier.id;
}

/** The carrier_id to write: undefined (unchanged), null (clear), or an existing carrier. */
export async function resolveShipmentCarrierId(tx: LinkClient, carrierId: unknown): Promise<LinkId> {
  const id = parseLinkId(carrierId, CARRIER_LINK_MESSAGE);
  if (id === undefined || id === null) return id;
  const carrier = await tx.carrier.findUnique({ where: { id }, select: { id: true } });
  if (!carrier) throw new ShipmentLinkError(CARRIER_LINK_MESSAGE);
  return carrier.id;
}
