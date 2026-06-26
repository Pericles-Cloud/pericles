/**
 * BOL trial adapter — geocoding.
 *
 * Resolves "City, Country" / port names to coordinates via Google Geocoding
 * (same Google account as @react-google-maps/api in the frontend). Results are
 * cached in KeyValueStore (namespace 'geocode') so repeated trial runs don't
 * re-bill the same lookups — mirrors the KeyValueStore caching pattern from
 * pericles-postgres-queue.
 *
 * If GOOGLE_MAPS_API_KEY is unset, falls back to a small built-in port/city
 * gazetteer so a trial can run fully offline for the most common lanes. Always
 * degrades gracefully (returns null) rather than throwing — pericles-external-feeds.
 */

import type { Geocoder, GeoPoint } from './types.js';

const UA = 'Pericles-SupplyChainMonitor/1.0 (contact@pericles.cloud)';

/** Minimal offline gazetteer for common trial lanes (extend as needed). */
const GAZETTEER: Record<string, GeoPoint> = {
  'shanghai, cn': { name: 'Shanghai, CN', latitude: 31.2304, longitude: 121.4737 },
  'shenzhen, cn': { name: 'Shenzhen, CN', latitude: 22.5431, longitude: 114.0579 },
  'ningbo, cn': { name: 'Ningbo, CN', latitude: 29.8683, longitude: 121.544 },
  'busan, kr': { name: 'Busan, KR', latitude: 35.1796, longitude: 129.0756 },
  'kaohsiung, tw': { name: 'Kaohsiung, TW', latitude: 22.6273, longitude: 120.3014 },
  'ho chi minh city, vn': { name: 'Ho Chi Minh City, VN', latitude: 10.8231, longitude: 106.6297 },
  'milan, it': { name: 'Milan, IT', latitude: 45.4642, longitude: 9.19 },
  'hamburg, de': { name: 'Hamburg, DE', latitude: 53.5511, longitude: 9.9937 },
  'los angeles, us': { name: 'Los Angeles, US', latitude: 33.7405, longitude: -118.2723 },
  'long beach, us': { name: 'Long Beach, US', latitude: 33.7542, longitude: -118.2165 },
  'newark, us': { name: 'Newark, US', latitude: 40.6895, longitude: -74.1745 },
  'savannah, us': { name: 'Savannah, US', latitude: 32.0835, longitude: -81.0998 },
  'houston, us': { name: 'Houston, US', latitude: 29.7604, longitude: -95.3698 },
};

function gazetteerLookup(query: string): GeoPoint | null {
  const key = query.trim().toLowerCase();
  if (GAZETTEER[key]) return GAZETTEER[key];
  // Fall back to "first, last" (e.g. "long beach, ca, us" → "long beach, us"),
  // so a query carrying a state/region still resolves offline. A real geocoder
  // handles the full string directly; this keeps the keyless trial path working.
  const parts = key.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 2) {
    const collapsed = `${parts[0]}, ${parts[parts.length - 1]}`;
    if (GAZETTEER[collapsed]) return GAZETTEER[collapsed];
  }
  return null;
}

interface KvLike {
  get(key: string, namespace?: string): Promise<string | null>;
  set(key: string, value: string, namespace?: string): Promise<void>;
}

/**
 * Build a cached Google geocoder. `kv` is optional; when provided, resolved
 * points are memoized under namespace 'geocode'.
 */
export function createGoogleGeocoder(opts?: {
  apiKey?: string;
  kv?: KvLike;
}): Geocoder {
  const apiKey = opts?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const kv = opts?.kv;

  return async (query: string): Promise<GeoPoint | null> => {
    const key = query.trim().toLowerCase();
    if (!key) return null;

    // 1. Cache.
    if (kv) {
      const cached = await kv.get(key, 'geocode').catch(() => null);
      if (cached) {
        try {
          return JSON.parse(cached) as GeoPoint;
        } catch {
          /* fall through to re-resolve */
        }
      }
    }

    // 2. Offline gazetteer (covers common lanes; lets a trial run keyless).
    const local = gazetteerLookup(key);
    if (local) {
      if (kv) await kv.set(key, JSON.stringify(local), 'geocode').catch(() => {
        /* best-effort cache write; ignore failures */
      });
      return local;
    }

    // 3. Google Geocoding API.
    if (!apiKey) return null;
    try {
      const url =
        'https://maps.googleapis.com/maps/api/geocode/json' +
        `?address=${encodeURIComponent(query)}&key=${apiKey}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        status: string;
        results: Array<{
          formatted_address: string;
          geometry: { location: { lat: number; lng: number } };
        }>;
      };
      if (body.status !== 'OK' || body.results.length === 0) return null;
      const top = body.results[0];
      const point: GeoPoint = {
        name: top.formatted_address,
        latitude: top.geometry.location.lat,
        longitude: top.geometry.location.lng,
      };
      if (kv) await kv.set(key, JSON.stringify(point), 'geocode').catch(() => {
        /* best-effort cache write; ignore failures */
      });
      return point;
    } catch {
      // Graceful degradation — a geocode miss skips the row, never crashes.
      return null;
    }
  };
}

/** Pure in-memory geocoder for tests: pass a { "city, cc": GeoPoint } map. */
export function createStubGeocoder(table: Record<string, GeoPoint>): Geocoder {
  return async (query: string) =>
    table[query.trim().toLowerCase()] ?? gazetteerLookup(query);
}
