/**
 * BOL trial adapter — transformer tests (Vitest, per pericles-testing).
 * Uses the stub geocoder so tests are deterministic and offline.
 */
import { describe, it, expect } from 'vitest';
import { transformBolDataToOrganizationContext } from './transformer.js';
import { createStubGeocoder } from './geocode.js';
import type { BolRow } from './types.js';

const geocode = createStubGeocoder({});

const rows: BolRow[] = [
  { bol_number: 'A1', shipment_date: '2026-05-01', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', consignee_name: 'Allient Inc', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', carrier_scac: 'MAEU' },
  { bol_number: 'A2', shipment_date: '2026-05-03', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', consignee_name: 'Allient Inc', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', carrier_scac: 'MAEU' },
  { bol_number: 'B1', shipment_date: '2026-05-04', supplier_name: 'Milano Servo SRL', supplier_city: 'Milan', supplier_country: 'IT', consignee_name: 'Allient Inc', destination_city: 'Newark', destination_state: 'NJ', destination_country: 'US', carrier_scac: 'MSCU' },
  { bol_number: 'B2', shipment_date: '2026-05-06', supplier_name: 'Milano Servo SRL', supplier_city: 'Milan', supplier_country: 'IT', consignee_name: 'Allient Inc', destination_city: 'Newark', destination_state: 'NJ', destination_country: 'US', carrier_scac: 'MSCU' },
  { bol_number: 'G1', shipment_date: '2026-05-07', supplier_name: 'OneOff Trading', supplier_city: 'Busan', supplier_country: 'KR', consignee_name: 'Allient Inc', destination_city: 'Savannah', destination_state: 'GA', destination_country: 'US' },
];

describe('transformBolDataToOrganizationContext', () => {
  it('emits the OrganizationContextData shape with all five keys', async () => {
    const ctx = await transformBolDataToOrganizationContext(rows, geocode);
    expect(ctx).toHaveProperty('plants');
    expect(ctx).toHaveProperty('warehouses');
    expect(ctx).toHaveProperty('suppliers');
    expect(ctx).toHaveProperty('shipping_lanes');
    expect(ctx.risk_preferences.monitored_risk_types).toHaveLength(10);
  });

  it('drops ghost suppliers below minShipmentsPerSupplier', async () => {
    const ctx = await transformBolDataToOrganizationContext(rows, geocode, {
      minShipmentsPerSupplier: 2,
    });
    expect(ctx.suppliers.map((s) => s.name)).not.toContain('OneOff Trading');
    expect(ctx.suppliers).toHaveLength(2);
  });

  it('flags high-volume suppliers critical and tags tier 1', async () => {
    const ctx = await transformBolDataToOrganizationContext(rows, geocode, {
      criticalShipmentThreshold: 2,
    });
    const shenzhen = ctx.suppliers.find((s) => s.name.startsWith('Shenzhen'));
    expect(shenzhen?.critical).toBe(true);
    expect(shenzhen?.tier).toBe(1);
  });

  it('builds SEA lanes with realistic transit-day estimates', async () => {
    const ctx = await transformBolDataToOrganizationContext(rows, geocode);
    const transpacific = ctx.shipping_lanes.find((l) =>
      l.origin.name.toLowerCase().includes('shenzhen'),
    );
    expect(transpacific?.mode).toBe('SEA');
    expect(transpacific?.carrier).toBe('MAEU');
    // Shenzhen → Long Beach is ~11,600 km → ~14 days at 833 km/day.
    expect(transpacific?.transit_days).toBeGreaterThan(10);
    expect(transpacific?.transit_days).toBeLessThan(20);
  });

  it('skips lanes whose supplier endpoint was dropped', async () => {
    const ctx = await transformBolDataToOrganizationContext(rows, geocode, {
      minShipmentsPerSupplier: 2,
    });
    // OneOff was dropped → its Savannah lane has no origin point → omitted.
    expect(
      ctx.shipping_lanes.find((l) => l.destination.name.toLowerCase().includes('savannah')),
    ).toBeUndefined();
  });
});
