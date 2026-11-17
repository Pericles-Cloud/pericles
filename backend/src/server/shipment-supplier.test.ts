/**
 * resolveShipmentSupplierId (#95): a shipment may only link a supplier of its
 * own organization. Fake transaction client; no DB.
 */
import { describe, it, expect } from 'vitest';
import type { Prisma } from '@prisma/client';
import { resolveShipmentSupplierId, SupplierOrganizationMismatchError } from './shipment-supplier.js';

const SUPPLIERS = [
  { id: 'sup-a', organization_id: 'org-a' },
  { id: 'sup-b', organization_id: 'org-b' },
];

const tx = {
  supplier: {
    // Prisma semantics: a field left out of `where` does not filter.
    findFirst: ({ where }: { where: { id?: string; organization_id?: string } }) =>
      Promise.resolve(
        SUPPLIERS.find(
          (s) =>
            (where.id === undefined || s.id === where.id) &&
            (where.organization_id === undefined || s.organization_id === where.organization_id)
        ) ?? null
      ),
  },
} as unknown as Pick<Prisma.TransactionClient, 'supplier'>;

const resolve = (supplierId: unknown, orgId = 'org-a') => resolveShipmentSupplierId(tx, supplierId, orgId);

describe('resolveShipmentSupplierId', () => {
  it('accepts a supplier of the same organization', async () => {
    expect(await resolve('sup-a')).toBe('sup-a');
  });

  it("rejects another organization's supplier", async () => {
    await expect(resolve('sup-b')).rejects.toBeInstanceOf(SupplierOrganizationMismatchError);
  });

  it('rejects a supplier that does not exist, with the same error (no cross-tenant oracle)', async () => {
    const missing = await resolve('nope').catch((e: unknown) => e);
    const foreign = await resolve('sup-b').catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(SupplierOrganizationMismatchError);
    expect((missing as Error).message).toBe((foreign as Error).message);
  });

  it('rejects a non-string id', async () => {
    for (const bad of [123, { contains: '' }, ['sup-a'], true]) {
      await expect(resolve(bad)).rejects.toBeInstanceOf(SupplierOrganizationMismatchError);
    }
  });

  it('undefined leaves the link unchanged; null or empty clears it', async () => {
    expect(await resolve(undefined)).toBeUndefined();
    expect(await resolve(null)).toBeNull();
    expect(await resolve('')).toBeNull();
  });
});
