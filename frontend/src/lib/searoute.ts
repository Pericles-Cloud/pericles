/**
 * Sea-route arc generation (client-side mirror of the backend's
 * `backend/src/integrations/tracking/searoute.ts`).
 *
 * Atlas renders each maritime shipment's route line itself rather than
 * round-tripping geometry from the API, so the two copies MUST stay in sync —
 * when the backend router changes, change this one too. Straight lines between
 * an Asian port and a US port cut across continents; this threads the route
 * through the right canals/straits (Panama, Suez, Gibraltar, Malacca, Cape of
 * Good Hope) and densifies each leg with great-circle interpolation.
 *
 * This is a pragmatic gazetteer-driven router, NOT a full bathymetric
 * pathfinder. When the live feed lands, real AIS tracks drive position/percent
 * and the client splits its rendered route at that point — see the mock
 * feed's position sampling in backend/src/integrations/tracking.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing (deg) from a→b. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Spherical interpolation between two points; fraction t in [0,1]. */
function slerp(a: LatLng, b: LatLng, t: number): LatLng {
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lng);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lng);
  const d = haversineKm(a, b) / EARTH_KM; // angular distance
  if (d === 0) return { ...a };
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return {
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lng: toDeg(Math.atan2(y, x)),
  };
}

/** Maritime chokepoint waypoints the router threads voyages through. */
const WP = {
  PANAMA: { lat: 8.9, lng: -79.55 },
  PANAMA_PACIFIC: { lat: 7.5, lng: -80.5 },
  PANAMA_CARIB: { lat: 9.6, lng: -78.5 },
  GIBRALTAR: { lat: 35.95, lng: -5.6 },
  SUEZ_N: { lat: 31.25, lng: 32.35 },
  SUEZ_S: { lat: 29.9, lng: 32.55 },
  BAB_EL_MANDEB: { lat: 12.6, lng: 43.4 },
  MALACCA: { lat: 2.5, lng: 101.0 },
  GOOD_HOPE: { lat: -34.8, lng: 19.5 },
  // Open-ocean steering points to keep arcs off land.
  PACIFIC_MID: { lat: 25.0, lng: -150.0 },
  CARIBBEAN: { lat: 18.0, lng: -75.0 },
  ATLANTIC_MID: { lat: 36.0, lng: -40.0 },
} as const;

const isEastAsia = (p: LatLng) => p.lng >= 100 || p.lng <= -160;
const isSouthAsia = (p: LatLng) => p.lng >= 60 && p.lng < 100 && p.lat < 30;
const isMedOrEurope = (p: LatLng) => p.lng >= -10 && p.lng < 45 && p.lat > 30;
// Upper bound 46° so northern-Italy / Adriatic origins (e.g. Milan 45.46) are
// still treated as Mediterranean and routed out through Gibraltar.
const isMediterranean = (p: LatLng) => p.lng >= -5 && p.lng < 36 && p.lat >= 30 && p.lat <= 46;
const isUsWestCoast = (p: LatLng) => p.lng <= -115 && p.lat >= 30 && p.lat <= 49;
const isUsEastOrGulf = (p: LatLng) => p.lng > -100 && p.lng <= -64 && p.lat >= 24 && p.lat <= 47;

/**
 * Choose canal/strait waypoints between origin and destination. Heuristic,
 * lane-tuned; returns the intermediate points only (origin/dest appended by
 * caller).
 */
function chooseWaypoints(origin: LatLng, dest: LatLng): LatLng[] {
  // East Asia → US West Coast: direct transpacific great circle.
  if (isEastAsia(origin) && isUsWestCoast(dest)) return [WP.PACIFIC_MID];

  // East Asia → US East/Gulf: transpacific, then Panama, then Caribbean.
  if (isEastAsia(origin) && isUsEastOrGulf(dest)) {
    return [WP.PACIFIC_MID, WP.PANAMA_PACIFIC, WP.PANAMA, WP.PANAMA_CARIB, WP.CARIBBEAN];
  }

  // Med / Europe → US East/Gulf: out through Gibraltar, transatlantic.
  if (isMedOrEurope(origin) && isUsEastOrGulf(dest)) {
    return isMediterranean(origin) ? [WP.GIBRALTAR, WP.ATLANTIC_MID] : [WP.ATLANTIC_MID];
  }

  // Med / Europe → US West Coast: transatlantic, Panama, into the Pacific.
  if (isMedOrEurope(origin) && isUsWestCoast(dest)) {
    const head = isMediterranean(origin) ? [WP.GIBRALTAR] : [];
    return [...head, WP.ATLANTIC_MID, WP.PANAMA_CARIB, WP.PANAMA, WP.PANAMA_PACIFIC];
  }

  // South Asia (India) → US East: Suez → Med → Gibraltar → transatlantic.
  if (isSouthAsia(origin) && isUsEastOrGulf(dest)) {
    return [WP.BAB_EL_MANDEB, WP.SUEZ_S, WP.SUEZ_N, WP.GIBRALTAR, WP.ATLANTIC_MID];
  }

  // South Asia → US West: across the Pacific via Malacca.
  if (isSouthAsia(origin) && isUsWestCoast(dest)) {
    return [WP.MALACCA, WP.PACIFIC_MID];
  }

  // Fallback: no canal needed (or unknown lane) — gentle great-circle direct.
  return [];
}

/**
 * Build a sea-route polyline from origin to destination, threaded through the
 * appropriate chokepoints and densified with great-circle legs.
 */
export function planSeaRoute(origin: LatLng, dest: LatLng, pointsPerLeg = 24): LatLng[] {
  const waypoints = [origin, ...chooseWaypoints(origin, dest), dest];
  const out: LatLng[] = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    // Scale density by leg length so long ocean legs stay smooth.
    const legKm = haversineKm(a, b);
    const n = Math.max(2, Math.round((pointsPerLeg * legKm) / 4000));
    for (let k = 0; k < n; k++) {
      out.push(slerp(a, b, k / n));
    }
  }
  out.push(dest);
  return out;
}

/**
 * Straight, uniformly-spaced polyline between two points — used for
 * non-maritime legs (air/rail/road), which do not follow water.
 */
export function buildStraightPath(
  a: LatLng,
  b: LatLng,
  steps = 40,
): Array<{ lat: number; lng: number }> {
  const path: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return path;
}