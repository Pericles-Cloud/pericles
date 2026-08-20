/**
 * Tracking integration — public surface + feed factory.
 *
 * `getPositionFeed()` returns the configured ShipmentPositionFeed. Today that's
 * always the mock; when LivePositionFeed lands, flip TRACKING_MODE=live and the
 * factory returns it — no caller changes. Atlas/API import only from here.
 */

import type { PrismaClient } from '@prisma/client';
import type { ShipmentPositionFeed, TrackingConfig, PositionUpdate } from './types.js';
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

/** Process-lifetime mock feed so its reference clock persists across requests. */
let mockFeedSingleton: MockPositionFeed | null = null;

/**
 * Resolve the active position feed.
 *
 * mock → MockPositionFeed (simulated motion over real BOL lanes). Returned as a
 *        process singleton: motion is `(now - referenceMs) * compression`, and
 *        `referenceMs` is anchored when each voyage plan is first built — so the
 *        SAME feed must survive across polls or every request rebuilds plans at
 *        `now` and the dots never advance. Tests construct MockPositionFeed
 *        directly when they need an isolated instance.
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
  mockFeedSingleton ??= new MockPositionFeed(config);
  return mockFeedSingleton;
}

/**
 * Vessel positions for an organization, optionally rolled up across its branded
 * subsidiaries (direct child orgs). Each PositionUpdate is tagged with its owning
 * organization (id + name) so Atlas can color and legend per subsidiary. The
 * caller is responsible for authorizing access to `organizationId`.
 */
export async function getOrganizationPositions(
  prisma: PrismaClient,
  organizationId: string,
  options: { includeSubsidiaries?: boolean } = {},
): Promise<PositionUpdate[]> {
  const orgs = await prisma.organization.findMany({
    where: options.includeSubsidiaries
      ? { OR: [{ id: organizationId }, { parent_organization_id: organizationId }] }
      : { id: organizationId },
    select: { id: true, name: true },
  });
  const nameById = new Map(orgs.map((o) => [o.id, o.name]));

  const shipments = await prisma.shipment.findMany({
    // Only maritime legs get simulated/published vessel positions. Air/rail/
    // road shipments (GH #10) have no vessel to track — their Atlas presence is
    // the mode icon at the origin, not a dot on an ocean lane.
    where: { organization_id: { in: orgs.map((o) => o.id) }, mode_of_transport: 'MARITIME' },
    select: {
      id: true,
      organization_id: true,
      vessel_name: true,
      departure_port: true,
      destination_port: true,
      destination_latitude: true,
      destination_longitude: true,
      arrival_date: true,
      estimated_arrival_date: true,
      supplier: { select: { name: true, latitude: true, longitude: true } },
    },
  });
  const orgByShipment = new Map(shipments.map((s) => [s.id, s.organization_id]));

  const feed = getPositionFeed();
  const positions = await feed.getPositions(shipments);
  return positions.map((p) => {
    const orgId = orgByShipment.get(p.shipmentId);
    return {
      ...p,
      organizationId: orgId,
      organizationName: orgId ? nameById.get(orgId) : undefined,
    };
  });
}
