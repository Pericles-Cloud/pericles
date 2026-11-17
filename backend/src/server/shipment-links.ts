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
  if (!parsed.success) throw new ShipmentLinkError(message);
  return parsed.data;
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

/** What the failed write was given; used to find out what disappeared. */
export interface ShipmentWriteContext {
  client: Pick<Prisma.TransactionClient, 'shipment' | 'supplier' | 'carrier'>;
  /** Update only: the shipment being updated. */
  shipmentId?: string;
  /** The request's supplierId / carrierId, as sent. */
  supplierId?: unknown;
  carrierId?: unknown;
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;

/**
 * Map a shipment create/update error to a response, or null for anything
 * else (the caller logs it and returns 500).
 *
 * - ShipmentLinkError: 400 with its message.
 * - A Prisma "related record missing" error (P2003 FK, P2025 not found): the
 *   check passed, so something was deleted concurrently. Rather than parse
 *   Prisma's wording (which changes between versions), look it up: the
 *   shipment gone -> 404; the requested supplier or carrier gone -> 400.
 *   If everything still exists, the failure was something else in the same
 *   transaction (the org connect, the audit row's FKs) -> null, so it is
 *   logged as a 500 and never blamed on the supplier or carrier.
 */
export async function classifyShipmentWriteError(
  error: unknown,
  ctx: ShipmentWriteContext
): Promise<ShipmentWriteErrorResponse | null> {
  if (error instanceof ShipmentLinkError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: error.message };
  }
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (error.code !== 'P2003' && error.code !== 'P2025') return null;
  try {
    if (ctx.shipmentId && !(await ctx.client.shipment.findUnique({ where: { id: ctx.shipmentId }, select: { id: true } }))) {
      return { status: 404, code: 'NOT_FOUND', message: 'Shipment not found' };
    }
    const supplierGone =
      isId(ctx.supplierId) && !(await ctx.client.supplier.findUnique({ where: { id: ctx.supplierId }, select: { id: true } }));
    const carrierGone =
      isId(ctx.carrierId) && !(await ctx.client.carrier.findUnique({ where: { id: ctx.carrierId }, select: { id: true } }));
    if (supplierGone || carrierGone) {
      return { status: 400, code: 'VALIDATION_ERROR', message: LINK_GONE_MESSAGE };
    }
  } catch {
    // The lookup itself failed: report the original error as a 500.
  }
  return null;
}
