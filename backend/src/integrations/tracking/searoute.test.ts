/**
 * Sea-route geometry tests (Vitest, per pericles-testing). Pure + offline.
 */
import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  bearingDeg,
  planSeaRoute,
  cumulativeDistances,
  pointAtDistance,
} from './searoute.js';
import type { LatLng } from './types.js';

const SHANGHAI: LatLng = { lat: 31.23, lng: 121.47 };
const SAVANNAH: LatLng = { lat: 32.08, lng: -81.1 };
const LONG_BEACH: LatLng = { lat: 33.75, lng: -118.22 };
const MILAN: LatLng = { lat: 45.46, lng: 9.19 };

describe('haversineKm', () => {
  it('is zero for identical points and positive otherwise', () => {
    expect(haversineKm(SHANGHAI, SHANGHAI)).toBe(0);
    expect(haversineKm(SHANGHAI, SAVANNAH)).toBeGreaterThan(0);
  });
});

describe('planSeaRoute', () => {
  it('routes East Asia → US East coast through the Panama area (not over land)', () => {
    const route = planSeaRoute(SHANGHAI, SAVANNAH);
    expect(route.length).toBeGreaterThan(10);
    // A Panama-routed voyage passes near the canal (~9°N, ~-79°E).
    const nearPanama = route.some((p) => Math.abs(p.lat - 8.9) < 4 && Math.abs(p.lng + 79.5) < 4);
    expect(nearPanama).toBe(true);
    // First/last vertices are the endpoints.
    expect(haversineKm(route[0], SHANGHAI)).toBeLessThan(50);
    expect(haversineKm(route[route.length - 1], SAVANNAH)).toBeLessThan(50);
  });

  it('routes East Asia → US West coast directly (no Panama detour)', () => {
    const route = planSeaRoute(SHANGHAI, LONG_BEACH);
    const nearPanama = route.some((p) => Math.abs(p.lat - 8.9) < 4 && Math.abs(p.lng + 79.5) < 4);
    expect(nearPanama).toBe(false);
  });

  it('routes Mediterranean → US East through Gibraltar', () => {
    const route = planSeaRoute(MILAN, SAVANNAH);
    const nearGibraltar = route.some((p) => Math.abs(p.lat - 35.95) < 3 && Math.abs(p.lng + 5.6) < 3);
    expect(nearGibraltar).toBe(true);
  });
});

describe('cumulativeDistances + pointAtDistance', () => {
  it('produces monotonically increasing cumulative distance', () => {
    const route = planSeaRoute(SHANGHAI, SAVANNAH);
    const { cumulativeKm, totalKm } = cumulativeDistances(route);
    for (let i = 1; i < cumulativeKm.length; i++) {
      expect(cumulativeKm[i]).toBeGreaterThanOrEqual(cumulativeKm[i - 1]);
    }
    expect(totalKm).toBeGreaterThan(0);
    // A Panama-routed Asia→US-East voyage is far longer than the straight line.
    expect(totalKm).toBeGreaterThan(haversineKm(SHANGHAI, SAVANNAH));
  });

  it('interpolates endpoints and midpoints along the route', () => {
    const route = planSeaRoute(SHANGHAI, LONG_BEACH);
    const { cumulativeKm, totalKm } = cumulativeDistances(route);
    const start = pointAtDistance(route, cumulativeKm, 0);
    const end = pointAtDistance(route, cumulativeKm, totalKm);
    expect(haversineKm(start.position, SHANGHAI)).toBeLessThan(100);
    expect(haversineKm(end.position, LONG_BEACH)).toBeLessThan(100);
    const mid = pointAtDistance(route, cumulativeKm, totalKm / 2);
    expect(Number.isFinite(mid.position.lat)).toBe(true);
    expect(Number.isFinite(mid.bearing)).toBe(true);
  });
});

describe('bearingDeg', () => {
  it('returns ~90° heading due east', () => {
    const b = bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(b).toBeGreaterThan(80);
    expect(b).toBeLessThan(100);
  });
});
