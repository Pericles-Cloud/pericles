/**
 * Voyage + MockPositionFeed tests (Vitest, per pericles-testing). Deterministic.
 */
import { describe, it, expect } from 'vitest';
import { buildVoyagePlan, resolvePort } from './voyage.js';
import { MockPositionFeed } from './mock-feed.js';
import type { TrackableShipment, TrackingConfig } from './types.js';

const config: TrackingConfig = {
  mode: 'mock',
  timeCompression: 1000,
  loop: true,
  oceanKmPerDay: 800,
};

const shanghaiShipment: TrackableShipment = {
  id: 'shp_001',
  vessel_name: 'EVER GIVEN',
  departure_port: 'Shanghai',
  destination_port: 'Savannah',
  arrival_date: null,
  estimated_arrival_date: null,
  supplier: { name: 'Allied Motion Changzhou', latitude: 31.23, longitude: 121.47 },
};

describe('resolvePort', () => {
  it('resolves known US ports case-insensitively and partially', () => {
    expect(resolvePort('Savannah')).not.toBeNull();
    expect(resolvePort('LOS ANGELES')).not.toBeNull();
    expect(resolvePort('Port of Long Beach')).not.toBeNull();
    expect(resolvePort('Atlantis')).toBeNull();
    expect(resolvePort(null)).toBeNull();
  });
});

describe('buildVoyagePlan', () => {
  it('builds a plan with positive distance and depart < arrive', () => {
    const plan = buildVoyagePlan(shanghaiShipment, config, Date.parse('2026-06-01T00:00:00Z'));
    expect(plan).not.toBeNull();
    expect(plan!.totalKm).toBeGreaterThan(0);
    expect(plan!.departMs).toBeLessThan(plan!.arriveMs);
    expect(plan!.vesselName).toBe('EVER GIVEN');
  });

  it('returns null when origin coordinates are missing', () => {
    const plan = buildVoyagePlan(
      { ...shanghaiShipment, supplier: { name: 'x', latitude: null, longitude: null } },
      config,
    );
    expect(plan).toBeNull();
  });

  it('returns null when the destination port is unknown', () => {
    const plan = buildVoyagePlan({ ...shanghaiShipment, destination_port: 'Nowhere' }, config);
    expect(plan).toBeNull();
  });

  it('anchors timing on a real arrival date when it is near now', () => {
    const now = Date.parse('2026-06-10T00:00:00Z');
    const arrival = '2026-06-15T00:00:00Z';
    const plan = buildVoyagePlan({ ...shanghaiShipment, arrival_date: arrival }, config, now);
    expect(plan!.arriveMs).toBe(Date.parse(arrival));
  });
});

describe('MockPositionFeed', () => {
  it('is deterministic: same now → same position', async () => {
    const now = Date.parse('2026-06-05T12:00:00Z');
    const a = await new MockPositionFeed(config).getPositions([shanghaiShipment], now);
    const b = await new MockPositionFeed(config).getPositions([shanghaiShipment], now);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
  });

  it('advances along the route as time passes', async () => {
    // Non-looping config: at timeCompression 1000 a 1h gap is ~42 simulated days,
    // which would lap the ~26-day voyage and wrap covered_km back under `loop`.
    // Disabling loop makes progress monotonic so the advance is unambiguous.
    const feed = new MockPositionFeed({ ...config, loop: false });
    const t0 = Date.parse('2026-06-05T00:00:00Z');
    const [p0] = await feed.getPositions([shanghaiShipment], t0);
    const [p1] = await feed.getPositions([shanghaiShipment], t0 + 60 * 60 * 1000); // +1h
    expect(p1.covered_km).toBeGreaterThan(p0.covered_km);
    expect(p0.polyline.length).toBeGreaterThan(2);
  });

  it('emits a feed-agnostic shape with progress, eta and source', async () => {
    const [p] = await new MockPositionFeed(config).getPositions(
      [shanghaiShipment],
      Date.parse('2026-06-05T00:00:00Z'),
    );
    expect(p.source).toBe('mock');
    expect(p.percent).toBeGreaterThanOrEqual(0);
    expect(p.percent).toBeLessThanOrEqual(1);
    expect(p.covered_km + p.remaining_km).toBeGreaterThan(0);
    expect(typeof p.eta).toBe('string');
    expect(['departing', 'in_transit', 'arriving', 'arrived']).toContain(p.status);
  });

  it('loops: progress stays within [0,1] far beyond a single voyage', async () => {
    const feed = new MockPositionFeed(config);
    const far = Date.now() + 5 * 365 * 24 * 60 * 60 * 1000; // 5 years out
    const [p] = await feed.getPositions([shanghaiShipment], far);
    expect(p.percent).toBeGreaterThanOrEqual(0);
    expect(p.percent).toBeLessThanOrEqual(1);
  });

  it('skips shipments it cannot route, without throwing', async () => {
    const bad: TrackableShipment = { ...shanghaiShipment, id: 'shp_bad', destination_port: 'Nowhere' };
    const out = await new MockPositionFeed(config).getPositions([shanghaiShipment, bad]);
    expect(out).toHaveLength(1);
    expect(out[0].shipmentId).toBe('shp_001');
  });
});
