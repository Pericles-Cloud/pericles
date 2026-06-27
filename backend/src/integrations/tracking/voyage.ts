/**
 * Voyage planning — real shipment → route geometry + clock.
 *
 * Takes a BOL-seeded shipment (real supplier origin, real destination port,
 * real vessel name) and produces a `VoyagePlan`: the sea-route polyline plus a
 * departure/arrival window. Timing anchors on the row's real arrival_date when
 * present; otherwise it synthesizes a deterministic, staggered window so the
 * fleet is spread across phases (some departing, some mid-ocean, some arriving)
 * rather than marching in lockstep.
 *
 * Only the timing/geometry is synthetic — every identifier on the dot is real.
 */

import type { LatLng, TrackableShipment, VoyagePlan, TrackingConfig } from './types.js';
import { planSeaRoute, cumulativeDistances, haversineKm } from './searoute.js';

/**
 * Compact US-destination + transshipment port gazetteer. Mirrors the frontend
 * port-coordinates list for the trial's dominant US discharge ports. Extend as
 * lanes grow; unresolved ports degrade gracefully (voyage skipped, never throws).
 */
const PORT_GAZETTEER: Record<string, LatLng> = {
  'los angeles': { lat: 33.7405, lng: -118.2723 },
  'long beach': { lat: 33.7542, lng: -118.2165 },
  oakland: { lat: 37.7956, lng: -122.2794 },
  seattle: { lat: 47.6062, lng: -122.3321 },
  tacoma: { lat: 47.2529, lng: -122.4443 },
  'new york': { lat: 40.6895, lng: -74.1745 },
  newark: { lat: 40.6895, lng: -74.1745 },
  savannah: { lat: 32.0835, lng: -81.0998 },
  charleston: { lat: 32.7833, lng: -79.9281 },
  norfolk: { lat: 36.8508, lng: -76.2859 },
  houston: { lat: 29.7604, lng: -95.3698 },
  baltimore: { lat: 39.2587, lng: -76.5797 },
  miami: { lat: 25.7743, lng: -80.1763 },
  jacksonville: { lat: 30.3322, lng: -81.6557 },
};

/** Resolve a destination port name to coordinates (partial, case-insensitive). */
export function resolvePort(name: string | null | undefined): LatLng | null {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  if (PORT_GAZETTEER[n]) return PORT_GAZETTEER[n];
  for (const [key, value] of Object.entries(PORT_GAZETTEER)) {
    if (n.includes(key) || key.includes(n)) return value;
  }
  return null;
}

/** Deterministic 32-bit hash of a string → used to stagger voyage phases. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function asMs(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const t = typeof d === 'string' ? Date.parse(d) : d.getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Build a voyage plan for one shipment, or null if its origin/destination can't
 * be resolved (no supplier coordinates, or unknown destination port).
 */
export function buildVoyagePlan(
  shipment: TrackableShipment,
  config: TrackingConfig,
  now: number = Date.now(),
): VoyagePlan | null {
  const lat = shipment.supplier?.latitude;
  const lng = shipment.supplier?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const origin: LatLng = { lat, lng };

  // Prefer geocoded destination coords (resolve any importer city, port or
  // inland); fall back to the port-name gazetteer for legacy/seeded data.
  const dLat = shipment.destination_latitude;
  const dLng = shipment.destination_longitude;
  const dest: LatLng | null =
    typeof dLat === 'number' && typeof dLng === 'number'
      ? { lat: dLat, lng: dLng }
      : resolvePort(shipment.destination_port);
  if (!dest) return null;

  const polyline = planSeaRoute(origin, dest);
  const { cumulativeKm, totalKm } = cumulativeDistances(polyline);
  if (totalKm <= 0) return null;

  // Transit duration from distance / ocean speed (min 3 days for short hops).
  const transitMs = Math.max(3, totalKm / config.oceanKmPerDay) * 24 * 60 * 60 * 1000;

  // Anchor timing: prefer the real arrival date; else synthesize a staggered
  // window so the fleet spreads across phases. phase0 = progress at `now`
  // (the reference moment); it drives the spread independently of how fast
  // time compression later advances the dots, so nothing collapses to 0.
  const realArrive = asMs(shipment.arrival_date) ?? asMs(shipment.estimated_arrival_date);
  let arriveMs: number;
  let phase0: number;
  if (realArrive && Math.abs(realArrive - now) < transitMs * 3) {
    arriveMs = realArrive;
    const departMs0 = arriveMs - transitMs;
    phase0 = Math.max(0, Math.min(0.999, (now - departMs0) / transitMs));
  } else {
    // Deterministic phase in [0,1) per shipment → fleet spread across the lane.
    phase0 = (hash(shipment.id) % 997) / 997;
    arriveMs = now + (1 - phase0) * transitMs;
  }
  const departMs = arriveMs - transitMs;

  return {
    shipmentId: shipment.id,
    vesselName: shipment.vessel_name ?? null,
    polyline,
    cumulativeKm,
    totalKm,
    departMs,
    arriveMs,
    referenceMs: now,
    phase0,
  };
}

/** Straight-line origin→dest distance (km), for sanity checks/tests. */
export function directKm(origin: LatLng, dest: LatLng): number {
  return haversineKm(origin, dest);
}
