/**
 * BOL trial adapter — relational seeder tests (Vitest, per pericles-testing).
 *
 * Verifies seedShipmentTables writes Supplier/Carrier/Shipment rows Atlas reads,
 * links shipments to their supplier + carrier, is idempotent on re-run, scopes
 * every Supplier/Shipment to the org, and skips rows it can't place. Stateful
 * fake Prisma + offline stub geocoder — deterministic, no DB, no network.
 */
import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { seedShipmentTables } from './seed-tables.js';
import { createStubGeocoder } from './geocode.js';
import type { BolRow } from './types.js';

const ORG = '11111111-2222-3333-4444-555555555555';

const geocode = createStubGeocoder({
  'shenzhen, cn': { name: 'Shenzhen, CN', latitude: 22.54, longitude: 114.06 },
  'milan, it': { name: 'Milan, IT', latitude: 45.46, longitude: 9.19 },
});

const rows: BolRow[] = [
  { bol_number: 'B1', shipment_date: '2026-05-01', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', consignee_name: 'Sun Hydraulics', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', origin_port: 'Yantian', carrier_scac: 'MAEU', vessel_name: 'MAERSK SELETAR', containers: 2, hs_codes: ['850131'] },
  { bol_number: 'B2', shipment_date: '2026-05-04', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', consignee_name: 'Sun Hydraulics', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', origin_port: 'Yantian', carrier_scac: 'MAEU', hs_codes: ['850131', '847989'] },
  // Single-row supplier — below minShipmentsPerSupplier=2, should be dropped,
  // and its shipment skipped (no supplier to link to).
  { bol_number: 'B3', shipment_date: '2026-05-06', supplier_name: 'Milano Servo SRL', supplier_city: 'Milan', supplier_country: 'IT', consignee_name: 'Sun Hydraulics', destination_city: 'Newark', destination_state: 'NJ', destination_country: 'US', carrier_scac: 'MSCU' },
];

interface Row { id: string; [k: string]: unknown }

function makePrisma() {
  const tables: Record<string, Map<string, Row>> = {
    supplier: new Map(),
    carrier: new Map(),
    shipment: new Map(),
  };
  const carrierByScac = new Map<string, Row>();

  const upsertById = (table: string) => ({ where, create, update }: { where: { id: string }; create: Row; update: Record<string, unknown> }) => {
    const map = tables[table];
    const existing = map.get(where.id);
    const row = existing ? { ...existing, ...update } : { ...create };
    map.set(row.id, row);
    return Promise.resolve(row);
  };

  const prisma = {
    supplier: { upsert: upsertById('supplier') },
    shipment: { upsert: upsertById('shipment') },
    carrier: {
      upsert: ({ where, create, update }: { where: { scac_code: string }; create: Row; update: Record<string, unknown> }) => {
        const existing = carrierByScac.get(where.scac_code);
        const row = existing ? { ...existing, ...update } : { ...create };
        carrierByScac.set(where.scac_code, row);
        tables.carrier.set(row.id, row);
        return Promise.resolve(row);
      },
    },
  } as unknown as PrismaClient;

  return { prisma, tables, carrierByScac };
}

describe('seedShipmentTables', () => {
  it('writes suppliers, carriers, and shipments Atlas can read', async () => {
    const { prisma, tables } = makePrisma();
    const result = await seedShipmentTables(prisma, ORG, rows, geocode);

    // Only the 2-row Shenzhen supplier clears the threshold; Milan is dropped.
    expect(result.suppliers).toBe(1);
    expect(result.shipments).toBe(2); // B1, B2; B3 skipped (supplier dropped)
    expect(result.carriers).toBe(2); // MAEU + MSCU both seen across rows

    const supplier = [...tables.supplier.values()][0];
    expect(supplier.organization_id).toBe(ORG);
    expect(supplier.latitude).toBe(22.54);
    expect(supplier.total_shipments).toBe(2);
    expect(supplier.hs_codes).toEqual(expect.arrayContaining(['850131', '847989']));
  });

  it('links each shipment to its supplier and carrier, scoped to the org', async () => {
    const { prisma, tables, carrierByScac } = makePrisma();
    await seedShipmentTables(prisma, ORG, rows, geocode);

    const supplierId = [...tables.supplier.values()][0].id;
    const maerskId = carrierByScac.get('MAEU')!.id;
    for (const shp of tables.shipment.values()) {
      expect(shp.organization_id).toBe(ORG);
      expect(shp.supplier_id).toBe(supplierId);
      expect(shp.carrier_id).toBe(maerskId);
      expect(shp.destination_port).toBe('Long Beach');
    }
    expect(carrierByScac.get('MAEU')!.name).toBe('Maersk');
  });

  it('is idempotent: re-running updates in place, no duplicates', async () => {
    const { prisma, tables } = makePrisma();
    await seedShipmentTables(prisma, ORG, rows, geocode);
    const r2 = await seedShipmentTables(prisma, ORG, rows, geocode);
    expect(r2.shipments).toBe(2);
    expect(tables.shipment.size).toBe(2);
    expect(tables.supplier.size).toBe(1);
  });

  it('skips rows whose supplier cannot be geocoded, without throwing', async () => {
    const { prisma, tables } = makePrisma();
    const nullGeocode = async () => null; // resolves nothing
    const result = await seedShipmentTables(prisma, ORG, rows, nullGeocode);
    expect(result.suppliers).toBe(0);
    expect(result.shipments).toBe(0);
    expect(tables.shipment.size).toBe(0);
  });
});
