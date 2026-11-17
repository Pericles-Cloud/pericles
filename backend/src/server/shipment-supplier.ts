/**
 * Tenant check for a shipment's supplier link (#95): a shipment may only be
 * linked to a supplier of its own organization.
 */
import type { Prisma } from '@prisma/client';

/** A supplierId that is not a supplier of the shipment's organization (#95). */
export class SupplierOrganizationMismatchError extends Error {
  constructor() {
    super('supplierId must be a supplier of the same organization as the shipment');
    this.name = 'SupplierOrganizationMismatchError';
  }
}

/**
 * Validate a shipment's supplierId against the shipment's organization (#95):
 * undefined = leave unchanged, null/'' = no supplier, otherwise it must be a
 * supplier OF THAT ORG. A missing id and another tenant's id get the same
 * error, so the check reveals nothing about other tenants. Runs on the write
 * transaction's client so the check and the write see the same data.
 */
export async function resolveShipmentSupplierId(
  tx: Pick<Prisma.TransactionClient, 'supplier'>,
  supplierId: unknown,
  organizationId: string
): Promise<string | null | undefined> {
  if (supplierId === undefined) return undefined;
  if (supplierId === null || supplierId === '') return null;
  if (typeof supplierId !== 'string') throw new SupplierOrganizationMismatchError();
  const supplier = await tx.supplier.findFirst({
    where: { id: supplierId, organization_id: organizationId },
    select: { id: true },
  });
  if (!supplier) throw new SupplierOrganizationMismatchError();
  return supplier.id;
}
