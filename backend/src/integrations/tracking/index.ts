/**
 * Tracking integration — public surface + feed factory.
 *
 * `getPositionFeed()` returns the configured ShipmentPositionFeed. Today that's
 * always the mock; when LivePositionFeed lands, flip TRACKING_MODE=live and the
 * factory returns it — no caller changes. Atlas/API import only from here.
 */

import type { ShipmentPositionFeed, TrackingConfig } from './types.js';
import { MockPositionFeed } from './mock-feed.js';

export type {
  ShipmentPositionFeed,
  PositionUpdate,
  TrackableShipment,
  TrackingConfig,
  VoyagePlan,
  VoyageStatus,
  LatLng,
} from './types.js';
export { MockPositionFeed } from './mock-feed.js';
export { buildVoyagePlan, resolvePort } from './voyage.js';
export { planSeaRoute, haversineKm, bearingDeg } from './searoute.js';

/** Demo-tuned defaults. Env overrides keep prod/live config out of code. */
export function loadTrackingConfig(env: NodeJS.ProcessEnv = process.env): TrackingConfig {
  const mode = env.TRACKING_MODE === 'live' ? 'live' : 'mock';
  // ~20000 makes voyages visibly progress over seconds (an ocean crossing in ~2
  // min of wall time); 2000 is too slow to perceive motion. Override per env.
  const timeCompression = Number(env.TRACKING_TIME_COMPRESSION ?? 20000);
  const loop = env.TRACKING_LOOP !== 'false'; // loop on by default for demos
  const oceanKmPerDay = Number(env.TRACKING_OCEAN_KM_PER_DAY ?? 800);
  return {
    mode,
    timeCompression: Number.isFinite(timeCompression) && timeCompression > 0 ? timeCompression : 20000,
    loop,
    oceanKmPerDay: Number.isFinite(oceanKmPerDay) && oceanKmPerDay > 0 ? oceanKmPerDay : 800,
  };
}

/**
 * Resolve the active position feed.
 *
 * mock → MockPositionFeed (simulated motion over real BOL lanes).
 * live → LivePositionFeed (Terminal49 + AISstream) — NOT YET IMPLEMENTED. The
 *        throw is intentional: it surfaces the moment someone flips the flag
 *        before the live adapter exists, rather than silently degrading.
 */
export function getPositionFeed(config: TrackingConfig = loadTrackingConfig()): ShipmentPositionFeed {
  if (config.mode === 'live') {
    throw new Error(
      'TRACKING_MODE=live but LivePositionFeed is not implemented yet. ' +
        'Build backend/src/integrations/tracking/live-feed.ts (Terminal49 status/ETA + ' +
        'AISstream lat/lon, normalized to PositionUpdate) — see pericles-atlas-mocker. ' +
        'Until then, use TRACKING_MODE=mock.',
    );
  }
  return new MockPositionFeed(config);
}
