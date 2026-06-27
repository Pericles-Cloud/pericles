/**
 * getPositionFeed tests (Vitest, per pericles-testing).
 *
 * The mock feed MUST be a process singleton: motion is measured from each plan's
 * reference clock, so a fresh feed per request would reset that clock and freeze
 * the dots. These guard that the route-facing factory reuses one feed and that a
 * shared feed advances over time. Deterministic, offline (gazetteer geocoder).
 */
import { describe, it, expect } from 'vitest';
import { getPositionFeed } from './index.js';
import type { TrackableShipment } from './types.js';

const ship: TrackableShipment = {
  id: 'shp_idx_1',
  vessel_name: 'TEST VESSEL',
  departure_port: 'Shanghai',
  destination_port: 'Savannah',
  arrival_date: null,
  estimated_arrival_date: null,
  supplier: { name: 'Shanghai Co', latitude: 31.23, longitude: 121.47 },
};

describe('getPositionFeed', () => {
  it('returns a process singleton so the reference clock persists across polls', () => {
    expect(getPositionFeed()).toBe(getPositionFeed());
  });

  it('advances a shipment between two polls at different times', async () => {
    const feed = getPositionFeed();
    const t0 = Date.parse('2026-06-05T00:00:00Z');
    const [a] = await feed.getPositions([ship], t0);
    const [b] = await feed.getPositions([ship], t0 + 60_000); // +1 min of wall time
    // Same plan (cached at t0); a later sample must have moved the dot.
    expect(b.position).not.toEqual(a.position);
    expect(b.percent).not.toBe(a.percent);
  });
});
