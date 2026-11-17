/**
 * Validation of a shipment's links to a supplier and a carrier (#95).
 *
 * - Supplier: tenant-scoped. A shipment may only link a supplier of its OWN
 *   organization. A missing id and another tenant's id get the same error,
 *   so the check reveals nothing about other tenants.
 * - Carrier: global (not org-scoped); it only has to exist.
 *
 * Both run on the write transaction's client. The read takes no lock, so a
 * link deleted concurrently between the check and the write surfaces as a
 * Prisma P2025/P2003 from the write; the shipment routes map those to a 400
 * too. Any failure here is a ShipmentLinkError (a 400).
 */
import { Prisma } from '@prisma/client';
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
 * `currentSupplierId` (PATCH only: the shipment's supplier_id as the handler
 * loaded it, before the transaction): re-sending it is not a change. An
 * unchanged value is never written, so a stale snapshot can't restore a link
 * that was changed concurrently. The edit form always sends
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

/** An HTTP error response for a failed shipment write. */
export interface ShipmentWriteErrorResponse {
  status: 400 | 404;
  code: 'VALIDATION_ERROR' | 'NOT_FOUND';
  message: string;
}

export const LINK_GONE_MESSAGE = 'The supplier or carrier no longer exists';

/** The FKs whose violation means a linked supplier/carrier was deleted concurrently. */
const LINK_FK_CONSTRAINTS = new Set(['Shipment_supplier_id_fkey', 'Shipment_carrier_id_fkey']);

/**
 * Map a shipment create/update error to a response, or null for anything
 * else (the caller logs it and returns 500). Matched precisely on what Prisma
 * reports, so an unrelated failure in the same transaction (the org connect,
 * the audit row's FKs) is never blamed on the supplier or carrier:
 * - ShipmentLinkError: 400 with its message.
 * - P2003 on Shipment_supplier_id_fkey / Shipment_carrier_id_fkey (update),
 *   or P2025 "No 'Supplier'|'Carrier' record" (create's connect): the link
 *   was deleted between the check and the write, 400.
 * - P2025 "No record was found for an update": the shipment itself was
 *   deleted concurrently, 404.
 */
export function classifyShipmentWriteError(error: unknown): ShipmentWriteErrorResponse | null {
  if (error instanceof ShipmentLinkError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: error.message };
  }
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = (error.meta ?? {}) as { constraint?: unknown; cause?: unknown };
  const cause = typeof meta.cause === 'string' ? meta.cause : '';
  if (error.code === 'P2003' && typeof meta.constraint === 'string' && LINK_FK_CONSTRAINTS.has(meta.constraint)) {
    return { status: 400, code: 'VALIDATION_ERROR', message: LINK_GONE_MESSAGE };
  }
  if (error.code === 'P2025' && /^No '(Supplier|Carrier)' record/.test(cause)) {
    return { status: 400, code: 'VALIDATION_ERROR', message: LINK_GONE_MESSAGE };
  }
  if (error.code === 'P2025' && cause.startsWith('No record was found for an update')) {
    return { status: 404, code: 'NOT_FOUND', message: 'Shipment not found' };
  }
  return null;
}
