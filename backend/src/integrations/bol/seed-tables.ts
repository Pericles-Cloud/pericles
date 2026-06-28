/**
 * BOL trial adapter — relational table seeder.
 *
 * Writes the BOL-native `Supplier`, `Carrier`, and `Shipment` rows that Atlas and
 * the position mocker read DIRECTLY (frontend builds routes from
 * `Supplier.latitude/longitude` + `Shipment.destination_port`). This is the data
 * path the map consumes — distinct from `OrganizationContext` (the JSON rollup the
 * monitoring pipeline reads). Onboarding writes BOTH from the same rows; see the
 * dual-path note in pericles-customer-onboarding.
 *
 * Idempotent: deterministic ids keyed on (organization, natural key) so re-running
 * an onboard updates rows in place instead of duplicating. Tenant-scoped: every
 * Supplier/Shipment write carries `organization_id`; Carrier is global, keyed on
 * its unique SCAC. Geocoding is injected (Google in prod, stub offline) and any
 * row that can't be placed is skipped rather than throwing — see
 * pericles-external-feeds, pericles-tenant-isolation.
 */

import type { PrismaClient } from '@prisma/client';
import type { BolRow, Geocoder, GeoPoint, BolTransformOptions } from './types.js';

/** Carrier SCAC → display name for the common ocean lines on trial lanes. */
const SCAC_NAMES: Record<string, string> = {
  MAEU: 'Maersk',
  MSCU: 'MSC',
  CMDU: 'CMA CGM',
  COSU: 'COSCO',
  HLCU: 'Hapag-Lloyd',
  OOLU: 'OOCL',
  ONEY: 'Ocean Network Express',
  EGLV: 'Evergreen',
  YMLU: 'Yang Ming',
  HMMU: 'HMM',
  ZIMU: 'ZIM',
  APLU: 'APL',
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Stable, collision-resistant id for a row scoped to an org. */
function rowId(prefix: string, organizationId: string, natural: string): string {
  return `${prefix}-${organizationId.slice(0, 8)}-${slug(natural)}`.slice(0, 80);
}

function toDate(v: string | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

export interface SeedTablesResult {
  suppliers: number;
  carriers: number;
  shipments: number;
}

interface SupplierAgg {
  name: string;
  country?: string;
  city?: string;
  latitude: number;
  longitude: number;
  shipmentCount: number;
  departurePorts: Set<string>;
  destinationPorts: Set<string>;
  hsCodes: Set<string>;
}

/**
 * Seed Supplier / Carrier / Shipment rows for ONE organization (a branded
 * subsidiary) from its BOL rows. Returns the counts written.
 */
export async function seedShipmentTables(
  prisma: PrismaClient,
  organizationId: string,
  rows: BolRow[],
  geocode: Geocoder,
  options: BolTransformOptions = {},
): Promise<SeedTablesResult> {
  const minShipments = options.minShipmentsPerSupplier ?? 2;

  // ── 1. Aggregate + geocode suppliers (foreign shippers) ───────────────────
  const bySupplier = new Map<string, BolRow[]>();
  for (const row of rows) {
    if (!row.supplier_name) continue;
    const key = row.supplier_name.trim();
    (bySupplier.get(key) ?? bySupplier.set(key, []).get(key)!).push(row);
  }

  const supplierIdByName = new Map<string, string>();
  let suppliersWritten = 0;

  for (const [name, supplierRows] of bySupplier) {
    if (supplierRows.length < minShipments) continue; // drop ghost records
    const sample = supplierRows[0];
    const point = await geocode(
      [sample.supplier_city, sample.supplier_country].filter(Boolean).join(', '),
    );
    if (!point) continue; // unplaceable → skip (graceful)

    const agg: SupplierAgg = {
      name,
      country: sample.supplier_country,
      city: sample.supplier_city,
      latitude: point.latitude,
      longitude: point.longitude,
      shipmentCount: supplierRows.length,
      departurePorts: new Set(),
      destinationPorts: new Set(),
      hsCodes: new Set(),
    };
    for (const r of supplierRows) {
      if (r.origin_port) agg.departurePorts.add(r.origin_port);
      if (r.destination_city) agg.destinationPorts.add(r.destination_city);
      for (const hs of r.hs_codes ?? []) agg.hsCodes.add(hs);
    }

    const id = rowId('BOL-SUP', organizationId, name);
    supplierIdByName.set(name, id);

    const data = {
      organization_id: organizationId,
      name,
      country: agg.country ?? null,
      country_code: agg.country ?? null,
      latitude: agg.latitude,
      longitude: agg.longitude,
      total_shipments: agg.shipmentCount,
      departure_ports: [...agg.departurePorts],
      destination_ports: [...agg.destinationPorts],
      hs_codes: [...agg.hsCodes],
    };
    await prisma.supplier.upsert({ where: { id }, create: { id, ...data }, update: data });
    suppliersWritten++;
  }

  // ── 2. Upsert carriers (global, keyed on unique SCAC) ─────────────────────
  const carrierCounts = new Map<string, number>();
  for (const row of rows) {
    const scac = row.carrier_scac?.trim().toUpperCase();
    if (!scac) continue;
    carrierCounts.set(scac, (carrierCounts.get(scac) ?? 0) + 1);
  }

  const carrierIdByScac = new Map<string, string>();
  let carriersWritten = 0;
  for (const [scac, count] of carrierCounts) {
    const id = rowId('BOL-CAR', 'global00', scac);
    const data = { scac_code: scac, name: SCAC_NAMES[scac] ?? scac, total_shipments: count };
    const carrier = await prisma.carrier.upsert({
      where: { scac_code: scac },
      create: { id, ...data },
      update: { name: data.name, total_shipments: data.total_shipments },
    });
    carrierIdByScac.set(scac, carrier.id);
    carriersWritten++;
  }

  // ── 3. Upsert one Shipment per BOL row, linked to supplier + carrier ──────
  // Geocode each distinct US destination once (importer city — often inland, not
  // a port) so the Atlas feed has real coords without re-resolving a gazetteer.
  const destPointByKey = new Map<string, GeoPoint | null>();
  const geocodeDest = async (row: BolRow): Promise<GeoPoint | null> => {
    const key = [row.destination_city, row.destination_state, row.destination_country]
      .filter(Boolean)
      .join(', ');
    if (!key) return null;
    let point = destPointByKey.get(key);
    if (point === undefined) {
      point = await geocode(key);
      destPointByKey.set(key, point);
    }
    return point;
  };

  let shipmentsWritten = 0;
  for (const row of rows) {
    if (!row.supplier_name) continue;
    const supplierId = supplierIdByName.get(row.supplier_name.trim());
    if (!supplierId) continue; // supplier was dropped/unplaceable → skip its rows

    const scac = row.carrier_scac?.trim().toUpperCase();
    const carrierId = scac ? carrierIdByScac.get(scac) ?? null : null;
    const arrival = toDate(row.shipment_date);
    const destPoint = await geocodeDest(row);

    const id = rowId('BOL-SHP', organizationId, row.bol_number);
    const data = {
      organization_id: organizationId,
      supplier_id: supplierId,
      carrier_id: carrierId,
      bol_number: row.bol_number,
      // Atlas reads supplier lat/lon = origin and the destination coords =
      // importer location; destination_port keeps the human-readable city name.
      departure_port: row.origin_port ?? null,
      destination_port: row.destination_city ?? null,
      destination_latitude: destPoint?.latitude ?? null,
      destination_longitude: destPoint?.longitude ?? null,
      destination_port_code: null as string | null,
      departure_port_code: null as string | null,
      vessel_name: row.vessel_name ?? null,
      vessel_code: row.vessel_code ?? null,
      voyage: row.voyage ?? null,
      value_usd: row.value_usd ?? null,
      arrival_date: arrival,
      estimated_arrival_date: arrival,
      containers_count: row.containers ?? null,
      hs_codes: row.hs_codes ?? [],
      product_description: row.product_description ?? null,
      quantity: row.quantity ?? null,
      weight: row.weight_kg ?? null,
    };
    await prisma.shipment.upsert({ where: { id }, create: { id, ...data }, update: data });
    shipmentsWritten++;
  }

  return { suppliers: suppliersWritten, carriers: carriersWritten, shipments: shipmentsWritten };
}
