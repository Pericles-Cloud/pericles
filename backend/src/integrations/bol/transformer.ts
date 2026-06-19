/**
 * BOL trial adapter — transformer.
 *
 * Converts normalized bill-of-lading rows into the SAME OrganizationContextData
 * shape the SAP adapter emits, so trial data flows through the identical
 * downstream Atlas/monitoring path. Output type is re-exported from the SAP
 * transformer to guarantee they never drift.
 *
 * Mapping:
 *   foreign shippers      → suppliers   (geocoded, tier 1, critical by volume)
 *   distinct US dests     → plants      (the importer's receiving points)
 *   (warehouses)          → []          (BOL can't distinguish; left empty, honestly)
 *   origin→dest pairs     → shipping_lanes (mode SEA, SCAC carrier, est. transit)
 *   risk_preferences      → default set (identical to SAP default)
 *
 * Companion build skills: pericles-erp-adapter, pericles-atlas-ui,
 * pericles-monitoring-pipeline.
 */

import type {
  OrganizationContextData,
  SupplierLocation,
  PlantLocation,
  ShippingLane,
  RiskPreferences,
} from '../sap/transformer.js';
import type { BolRow, Geocoder, GeoPoint, BolTransformOptions } from './types.js';

const DEFAULTS: Required<BolTransformOptions> = {
  criticalShipmentThreshold: 10,
  oceanKmPerDay: 833, // ~18 knots sustained
  minShipmentsPerSupplier: 2,
};

/** Same default risk preferences the SAP adapter uses (keep them identical). */
function getDefaultRiskPreferences(): RiskPreferences {
  return {
    monitored_risk_types: [
      'flood',
      'earthquake',
      'typhoon',
      'strike',
      'port_closure',
      'cyberattack',
      'trade_restriction',
      'pandemic',
      'geopolitical_conflict',
      'economic_crisis',
    ],
    geographic_radius_km: 100,
    severity_threshold: 0.3,
    notification_channels: ['email', 'slack'],
  };
}

/** Great-circle distance (km) — same Haversine the monitoring pipeline uses. */
function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function placeQuery(city?: string, region?: string, country?: string): string {
  return [city, region, country].filter(Boolean).join(', ');
}

/**
 * Main transform. Async because geocoding is async. The geocoder is injected so
 * this stays testable and provider-agnostic (Google in prod, stub in tests).
 */
export async function transformBolDataToOrganizationContext(
  rows: BolRow[],
  geocode: Geocoder,
  options: BolTransformOptions = {},
): Promise<OrganizationContextData> {
  const opts = { ...DEFAULTS, ...options };

  // ── Suppliers: group rows by foreign shipper ──────────────────────────────
  const bySupplier = new Map<string, BolRow[]>();
  for (const row of rows) {
    if (!row.supplier_name) continue;
    const key = row.supplier_name.trim();
    (bySupplier.get(key) ?? bySupplier.set(key, []).get(key)!).push(row);
  }

  const suppliers: SupplierLocation[] = [];
  const supplierPoints = new Map<string, GeoPoint>(); // name → geocoded point
  for (const [name, supplierRows] of bySupplier) {
    if (supplierRows.length < opts.minShipmentsPerSupplier) continue;
    const sample = supplierRows[0];
    const point = await geocode(
      placeQuery(sample.supplier_city, undefined, sample.supplier_country),
    );
    if (!point) continue; // can't place it → skip (graceful)
    supplierPoints.set(name, point);
    suppliers.push({
      supplier_id: `BOL-SUP-${slug(name)}`.slice(0, 60),
      name,
      location: {
        name: point.name,
        latitude: point.latitude,
        longitude: point.longitude,
      },
      country: sample.supplier_country ?? 'XX',
      tier: 1, // direct shipper on the importer's BOLs
      critical: supplierRows.length >= opts.criticalShipmentThreshold,
    });
  }

  // ── Plants: distinct US destinations (the importer's receiving points) ─────
  const byDestination = new Map<string, BolRow[]>();
  for (const row of rows) {
    const destKey = placeQuery(
      row.destination_city,
      row.destination_state,
      row.destination_country ?? 'US',
    );
    if (!destKey) continue;
    (byDestination.get(destKey) ?? byDestination.set(destKey, []).get(destKey)!).push(row);
  }

  const plants: PlantLocation[] = [];
  const destPoints = new Map<string, GeoPoint>();
  for (const [destKey, destRows] of byDestination) {
    const point = await geocode(destKey);
    if (!point) continue;
    destPoints.set(destKey, point);
    plants.push({
      plant_id: `BOL-DEST-${slug(destKey)}`.slice(0, 60),
      name: destRows[0].consignee_name || destKey,
      location: {
        name: point.name,
        latitude: point.latitude,
        longitude: point.longitude,
      },
      country: destRows[0].destination_country ?? 'US',
      plant_type: 'import_destination',
    });
  }

  // ── Shipping lanes: one per (supplier origin → US destination) pair ────────
  const laneMap = new Map<string, { row: BolRow; count: number }>();
  for (const row of rows) {
    if (!row.supplier_name) continue;
    const destKey = placeQuery(
      row.destination_city,
      row.destination_state,
      row.destination_country ?? 'US',
    );
    const laneKey = `${row.supplier_name.trim()}__${destKey}`;
    const existing = laneMap.get(laneKey);
    if (existing) existing.count += 1;
    else laneMap.set(laneKey, { row, count: 1 });
  }

  const shipping_lanes: ShippingLane[] = [];
  for (const [laneKey, { row, count }] of laneMap) {
    const origin = supplierPoints.get(row.supplier_name.trim());
    const destKey = placeQuery(
      row.destination_city,
      row.destination_state,
      row.destination_country ?? 'US',
    );
    const dest = destPoints.get(destKey);
    if (!origin || !dest) continue; // need both endpoints placed

    const distanceKm = haversineKm(origin, dest);
    const transitDays = Math.max(1, Math.round(distanceKm / opts.oceanKmPerDay));

    shipping_lanes.push({
      lane_id: `BOL-LANE-${slug(laneKey)}`.slice(0, 60),
      origin: {
        plant_id: `BOL-SUP-${slug(row.supplier_name.trim())}`.slice(0, 60),
        name: origin.name,
        latitude: origin.latitude,
        longitude: origin.longitude,
      },
      destination: {
        plant_id: `BOL-DEST-${slug(destKey)}`.slice(0, 60),
        name: dest.name,
        latitude: dest.latitude,
        longitude: dest.longitude,
      },
      mode: 'SEA',
      carrier: row.carrier_scac,
      transit_days: transitDays,
      active: count > 0,
    });
  }

  return {
    plants,
    warehouses: [], // BOL can't reliably distinguish warehouses; left empty.
    suppliers,
    shipping_lanes,
    risk_preferences: getDefaultRiskPreferences(),
  };
}
