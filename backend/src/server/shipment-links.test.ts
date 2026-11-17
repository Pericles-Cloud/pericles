/**
 * Shipment link validation (#95): a shipment may only link a supplier of its
 * own organization, and an existing carrier. Fake transaction client that
 * follows Prisma's `where` semantics (an omitted field does not filter); no DB.
 */
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  CARRIER_LINK_MESSAGE,
  LINK_GONE_MESSAGE,
  classifyShipmentWriteError,
  SUPPLIER_LINK_MESSAGE,
  ShipmentLinkError,
  resolveShipmentCarrierId,
  resolveShipmentSupplierId,
} from './shipment-links.js';

const SUPPLIERS = [
  { id: 'sup-a', organization_id: 'org-a' },
  { id: 'sup-b', organization_id: 'org-b' },
];
const CARRIERS = [{ id: 'car-1' }];

const tx = {
  supplier: {
    findFirst: ({ where }: { where: { id?: string; organization_id?: string } }) =>
      Promise.resolve(
        SUPPLIERS.find(
          (s) =>
            (where.id === undefined || s.id === where.id) &&
            (where.organization_id === undefined || s.organization_id === where.organization_id)
        ) ?? null
      ),
  },
  carrier: {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(CARRIERS.find((c) => c.id === where.id) ?? null),
  },
} as unknown as Pick<Prisma.TransactionClient, 'supplier' | 'carrier'>;

const supplier = (id: unknown, current?: string | null) => resolveShipmentSupplierId(tx, id, 'org-a', current);
const rejection = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

describe('resolveShipmentSupplierId', () => {
  it('accepts a supplier of the same organization', async () => {
    expect(await supplier('sup-a')).toBe('sup-a');
  });

  it("rejects another organization's supplier", async () => {
    await expect(supplier('sup-b')).rejects.toBeInstanceOf(ShipmentLinkError);
  });

  it('rejects a missing supplier with the same error (no cross-tenant oracle)', async () => {
    const missing = await rejection(supplier('nope'));
    const foreign = await rejection(supplier('sup-b'));
    expect((missing as Error).message).toBe(SUPPLIER_LINK_MESSAGE);
    expect((foreign as Error).message).toBe(SUPPLIER_LINK_MESSAGE);
  });

  it('rejects a non-string or over-long id', async () => {
    for (const bad of [123, { contains: '' }, ['sup-a'], true, 'x'.repeat(129)]) {
      await expect(supplier(bad)).rejects.toBeInstanceOf(ShipmentLinkError);
    }
  });

  it('undefined leaves the link unchanged; null or empty clears it', async () => {
    expect(await supplier(undefined)).toBeUndefined();
    expect(await supplier(null)).toBeNull();
    expect(await supplier('')).toBeNull();
  });

  describe('PATCH: the current link', () => {
    it('re-sending the current link (even a legacy cross-org one) is unchanged', async () => {
      expect(await supplier('sup-b', 'sup-b')).toBeUndefined();
    });

    it('a NEW cross-org link is still rejected', async () => {
      await expect(supplier('sup-b', 'sup-a')).rejects.toBeInstanceOf(ShipmentLinkError);
      await expect(supplier('sup-b', null)).rejects.toBeInstanceOf(ShipmentLinkError);
    });

    it('clearing a legacy link works', async () => {
      expect(await supplier(null, 'sup-b')).toBeNull();
    });
  });
});

describe('resolveShipmentCarrierId', () => {
  const carrier = (id: unknown) => resolveShipmentCarrierId(tx, id);

  it('accepts an existing carrier; undefined unchanged; null or empty clears', async () => {
    expect(await carrier('car-1')).toBe('car-1');
    expect(await carrier(undefined)).toBeUndefined();
    expect(await carrier(null)).toBeNull();
    expect(await carrier('')).toBeNull();
  });

  it('rejects a missing carrier or a non-string id with a 400 error', async () => {
    for (const bad of ['nope', 42, {}]) {
      const e = await rejection(carrier(bad));
      expect(e).toBeInstanceOf(ShipmentLinkError);
      expect((e as Error).message).toBe(CARRIER_LINK_MESSAGE);
    }
  });
});

describe('classifyShipmentWriteError (error -> response)', () => {
  // Shapes observed from Prisma 6 against Postgres for each case.
  const prismaError = (code: string, meta: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('test', { code, clientVersion: 'test', meta });

  it('maps a ShipmentLinkError to 400 with its message', () => {
    expect(classifyShipmentWriteError(new ShipmentLinkError(SUPPLIER_LINK_MESSAGE))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: SUPPLIER_LINK_MESSAGE,
    });
  });

  it('maps a concurrently deleted supplier/carrier to 400 (update FK, create connect)', () => {
    for (const e of [
      prismaError('P2003', { modelName: 'Shipment', constraint: 'Shipment_supplier_id_fkey' }),
      prismaError('P2003', { modelName: 'Shipment', constraint: 'Shipment_carrier_id_fkey' }),
      prismaError('P2025', { modelName: 'Shipment', cause: "No 'Supplier' record (needed to inline the relation on 'Shipment' record(s)) was found for a nested connect on one-to-many relation 'ShipmentToSupplier'." }),
      prismaError('P2025', { modelName: 'Shipment', cause: "No 'Carrier' record (needed to inline the relation on 'Shipment' record(s)) was found for a nested connect on one-to-many relation 'CarrierToShipment'." }),
    ]) {
      expect(classifyShipmentWriteError(e)).toEqual({ status: 400, code: 'VALIDATION_ERROR', message: LINK_GONE_MESSAGE });
    }
  });

  it('maps an update of a shipment deleted concurrently to 404', () => {
    const e = prismaError('P2025', { modelName: 'Shipment', cause: 'No record was found for an update.' });
    expect(classifyShipmentWriteError(e)).toEqual({ status: 404, code: 'NOT_FOUND', message: 'Shipment not found' });
  });

  it('does NOT blame the supplier/carrier for other failures in the same transaction (left to the 500 path)', () => {
    for (const e of [
      prismaError('P2025', { modelName: 'Shipment', cause: "No 'Organization' record (needed to inline the relation on 'Shipment' record(s)) was found for a nested connect on one-to-many relation 'OrganizationToShipment'." }),
      prismaError('P2003', { modelName: 'AuthAuditLog', constraint: 'AuthAuditLog_user_id_fkey' }),
      prismaError('P2002', { modelName: 'Shipment', target: ['id'] }),
      new Error('boom'),
    ]) {
      expect(classifyShipmentWriteError(e)).toBeNull();
    }
  });
});
