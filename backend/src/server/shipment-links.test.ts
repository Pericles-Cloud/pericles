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
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('test', { code, clientVersion: 'test', meta: {} });

  // What still exists after the failed write.
  const world = (exists: { shipments?: string[]; suppliers?: string[]; carriers?: string[] }) => {
    const finder = (ids: string[] = []) => ({
      findUnique: ({ where }: { where: { id: string } }) => Promise.resolve(ids.includes(where.id) ? { id: where.id } : null),
    });
    return {
      shipment: finder(exists.shipments),
      supplier: finder(exists.suppliers),
      carrier: finder(exists.carriers),
    } as unknown as Parameters<typeof classifyShipmentWriteError>[1]['client'];
  };

  it('maps a ShipmentLinkError to 400 with its message', async () => {
    expect(await classifyShipmentWriteError(new ShipmentLinkError(SUPPLIER_LINK_MESSAGE), { client: world({}) })).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: SUPPLIER_LINK_MESSAGE,
    });
  });

  it('a supplier or carrier deleted concurrently -> 400 (P2003 or P2025, whatever the wording)', async () => {
    for (const code of ['P2003', 'P2025']) {
      expect(
        await classifyShipmentWriteError(prismaError(code), { client: world({ suppliers: [] }), supplierId: 'sup-x' })
      ).toEqual({ status: 400, code: 'VALIDATION_ERROR', message: LINK_GONE_MESSAGE });
      expect(
        await classifyShipmentWriteError(prismaError(code), {
          client: world({ suppliers: ['sup-x'], carriers: [] }),
          supplierId: 'sup-x',
          carrierId: 'car-x',
        })
      ).toEqual({ status: 400, code: 'VALIDATION_ERROR', message: LINK_GONE_MESSAGE });
    }
  });

  it('the shipment being updated was deleted concurrently -> 404', async () => {
    expect(
      await classifyShipmentWriteError(prismaError('P2025'), { client: world({ suppliers: ['sup-x'] }), shipmentId: 'shp-x', supplierId: 'sup-x' })
    ).toEqual({ status: 404, code: 'NOT_FOUND', message: 'Shipment not found' });
  });

  it('everything still exists -> null: another failure in the transaction is not blamed on the links', async () => {
    const ctx = {
      client: world({ shipments: ['shp-x'], suppliers: ['sup-x'], carriers: ['car-x'] }),
      shipmentId: 'shp-x',
      supplierId: 'sup-x',
      carrierId: 'car-x',
    };
    expect(await classifyShipmentWriteError(prismaError('P2003'), ctx)).toBeNull();
    expect(await classifyShipmentWriteError(prismaError('P2025'), { ...ctx, supplierId: undefined, carrierId: null })).toBeNull();
  });

  it('other errors -> null without any lookup', async () => {
    const throwing = {
      shipment: { findUnique: () => Promise.reject(new Error('should not look up')) },
      supplier: { findUnique: () => Promise.reject(new Error('should not look up')) },
      carrier: { findUnique: () => Promise.reject(new Error('should not look up')) },
    } as unknown as Parameters<typeof classifyShipmentWriteError>[1]['client'];
    expect(await classifyShipmentWriteError(prismaError('P2002'), { client: throwing, supplierId: 'sup-x' })).toBeNull();
    expect(await classifyShipmentWriteError(new Error('boom'), { client: throwing, supplierId: 'sup-x' })).toBeNull();
  });

  it('a failing lookup reports the original error (null), not a guess', async () => {
    const failing = {
      shipment: { findUnique: () => Promise.reject(new Error('db down')) },
      supplier: { findUnique: () => Promise.reject(new Error('db down')) },
      carrier: { findUnique: () => Promise.reject(new Error('db down')) },
    } as unknown as Parameters<typeof classifyShipmentWriteError>[1]['client'];
    expect(await classifyShipmentWriteError(prismaError('P2003'), { client: failing, supplierId: 'sup-x' })).toBeNull();
  });
});
