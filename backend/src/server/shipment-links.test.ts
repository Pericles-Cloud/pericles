/**
 * Shipment write checks (#95). A fake $queryRaw over small in-memory tables
 * stands in for Postgres; it records each query so the tests can also check
 * that every lookup locks (FOR SHARE / FOR UPDATE) and is org-scoped.
 */
import { describe, it, expect } from 'vitest';
import {
  CARRIER_LINK_MESSAGE,
  SUPPLIER_LINK_MESSAGE,
  ShipmentRequestError,
  lockOrganization,
  lockShipment,
  resolveShipmentCarrierId,
  resolveShipmentSupplierId,
  toShipmentSupplier,
  type LockClient,
} from './shipment-links.js';

const DB = {
  Organization: [{ id: 'org-a' }],
  Supplier: [
    { id: 'sup-a', organization_id: 'org-a' },
    { id: 'sup-b', organization_id: 'org-b' },
  ],
  Carrier: [{ id: 'car-1' }],
  Shipment: [{ id: 'shp-a', organization_id: 'org-a', supplier_id: 'sup-b', carrier_id: 'car-1' }],
};

function fakeTx() {
  const queries: string[] = [];
  const tx = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      queries.push(sql);
      const [id, org] = values as string[];
      if (sql.includes('FROM "Organization"')) return Promise.resolve(DB.Organization.filter((r) => r.id === id));
      if (sql.includes('FROM "Supplier"'))
        return Promise.resolve(DB.Supplier.filter((r) => r.id === id && r.organization_id === org).map(({ id }) => ({ id })));
      if (sql.includes('FROM "Carrier"')) return Promise.resolve(DB.Carrier.filter((r) => r.id === id));
      if (sql.includes('FROM "Shipment"'))
        return Promise.resolve(
          DB.Shipment.filter((r) => r.id === id && r.organization_id === org).map((r) => ({
            supplier_id: r.supplier_id,
            carrier_id: r.carrier_id,
          }))
        );
      return Promise.reject(new Error(`unexpected query: ${  sql}`));
    },
  } as unknown as LockClient;
  return { tx, queries };
}

const rejection = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as ShipmentRequestError);

describe('resolveShipmentSupplierId', () => {
  const supplier = (id: unknown, current?: string | null) => resolveShipmentSupplierId(fakeTx().tx, id, 'org-a', current);

  it('accepts a supplier of the same organization, scoped by org and locked FOR SHARE', async () => {
    const { tx, queries } = fakeTx();
    expect(await resolveShipmentSupplierId(tx, 'sup-a', 'org-a')).toBe('sup-a');
    expect(queries[0]).toMatch(/organization_id = \?/);
    expect(queries[0]).toMatch(/FOR KEY SHARE/);
  });

  it("rejects another organization's supplier and a missing one, with the same 400", async () => {
    for (const id of ['sup-b', 'nope']) {
      const e = await rejection(supplier(id));
      expect(e).toBeInstanceOf(ShipmentRequestError);
      expect([e?.status, e?.code, e?.message]).toEqual([400, 'INVALID_LINK', SUPPLIER_LINK_MESSAGE]);
    }
  });

  it('rejects a non-string or over-long id', async () => {
    for (const bad of [123, { contains: '' }, ['sup-a'], true, 'x'.repeat(129)]) {
      await expect(supplier(bad)).rejects.toBeInstanceOf(ShipmentRequestError);
    }
  });

  it('undefined leaves the link unchanged; null or empty clears it; no query either way', async () => {
    const { tx, queries } = fakeTx();
    expect(await resolveShipmentSupplierId(tx, undefined, 'org-a')).toBeUndefined();
    expect(await resolveShipmentSupplierId(tx, null, 'org-a')).toBeNull();
    expect(await resolveShipmentSupplierId(tx, '', 'org-a')).toBeNull();
    expect(queries).toHaveLength(0);
  });

  describe('update: the current link', () => {
    it('re-sending the current link (even a legacy cross-org one) is unchanged', async () => {
      expect(await supplier('sup-b', 'sup-b')).toBeUndefined();
    });

    it('a NEW cross-org link is rejected', async () => {
      await expect(supplier('sup-b', 'sup-a')).rejects.toBeInstanceOf(ShipmentRequestError);
      await expect(supplier('sup-b', null)).rejects.toBeInstanceOf(ShipmentRequestError);
    });

    it('clearing a legacy link works', async () => {
      expect(await supplier(null, 'sup-b')).toBeNull();
    });
  });
});

describe('resolveShipmentCarrierId', () => {
  const carrier = (id: unknown) => resolveShipmentCarrierId(fakeTx().tx, id);

  it('accepts an existing carrier (locked FOR SHARE); undefined unchanged; null or empty clears', async () => {
    const { tx, queries } = fakeTx();
    expect(await resolveShipmentCarrierId(tx, 'car-1')).toBe('car-1');
    expect(queries[0]).toMatch(/FOR KEY SHARE/);
    expect(await carrier(undefined)).toBeUndefined();
    expect(await carrier(null)).toBeNull();
    expect(await carrier('')).toBeNull();
  });

  it('re-sending the current carrier is unchanged and takes no lock', async () => {
    const { tx, queries } = fakeTx();
    expect(await resolveShipmentCarrierId(tx, 'car-gone', 'car-gone')).toBeUndefined();
    expect(queries).toHaveLength(0);
  });

  it('rejects a missing carrier or a non-string id with a 400', async () => {
    for (const bad of ['nope', 42, {}]) {
      const e = await rejection(carrier(bad));
      expect([e?.status, e?.code, e?.message]).toEqual([400, 'INVALID_LINK', CARRIER_LINK_MESSAGE]);
    }
  });
});

describe('lockOrganization / lockShipment', () => {
  it('lockOrganization: passes for an existing org (FOR SHARE), 404 otherwise', async () => {
    const { tx, queries } = fakeTx();
    await expect(lockOrganization(tx, 'org-a')).resolves.toBeUndefined();
    expect(queries[0]).toMatch(/FOR KEY SHARE/);
    const e = await rejection(lockOrganization(tx, 'org-x'));
    expect([e?.status, e?.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('lockShipment: FOR UPDATE, org-scoped; 404 if gone or in another org', async () => {
    const { tx, queries } = fakeTx();
    const snap = { supplierId: 'sup-b', carrierId: 'car-1' };
    await expect(lockShipment(tx, 'shp-a', 'org-a', snap)).resolves.toBeUndefined();
    expect(queries[0]).toMatch(/organization_id = \?/);
    expect(queries[0]).toMatch(/FOR UPDATE/);
    for (const [id, org] of [['shp-x', 'org-a'], ['shp-a', 'org-b']]) {
      const e = await rejection(lockShipment(tx, id, org, snap));
      expect([e?.status, e?.code, e?.message]).toEqual([404, 'NOT_FOUND', 'Shipment not found']);
    }
  });

  it('lockShipment: 409 if the links changed since the snapshot the checks were decided on', async () => {
    const { tx } = fakeTx();
    for (const snap of [{ supplierId: 'sup-a', carrierId: 'car-1' }, { supplierId: 'sup-b', carrierId: null }]) {
      const e = await rejection(lockShipment(tx, 'shp-a', 'org-a', snap));
      expect([e?.status, e?.code]).toEqual([409, 'CONFLICT']);
    }
  });
});

describe('toShipmentSupplier', () => {
  it("flags a legacy cross-org link without exposing the other tenant's org id", () => {
    const out = toShipmentSupplier('org-a', { id: 'sup-b', name: 'B', country: null, organization_id: 'org-b' });
    expect(out).toEqual({ id: 'sup-b', name: 'B', country: null, sameOrganization: false });
    expect(JSON.stringify(out)).not.toContain('org-b');
  });

  it('same-org supplier, address passed through when selected, null stays null', () => {
    expect(
      toShipmentSupplier('org-a', { id: 'sup-a', name: 'A', country: 'US', organization_id: 'org-a', address: '1 Main' })
    ).toEqual({ id: 'sup-a', name: 'A', country: 'US', address: '1 Main', sameOrganization: true });
    expect(toShipmentSupplier('org-a', null)).toBeNull();
  });
});
