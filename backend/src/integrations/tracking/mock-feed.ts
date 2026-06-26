/**
 * MockPositionFeed — simulated motion over real lanes.
 *
 * Implements the `ShipmentPositionFeed` seam by sampling each shipment's
 * precomputed `VoyagePlan` at the current (time-compressed) clock. Pure and
 * deterministic: the same `now` always yields the same positions, so it needs
 * no cron, no DB writes, and no background job — Atlas just polls and the dots
 * move as a function of wall-clock time.
 *
 * Swap target: LivePositionFeed (Terminal49 + AISstream) returns the same
 * PositionUpdate shape from real carrier/AIS data. Nothing else changes.
 */

import type {
  ShipmentPositionFeed,
  PositionUpdate,
  TrackableShipment,
  TrackingConfig,
  VoyagePlan,
  VoyageStatus,
} from './types.js';
import { buildVoyagePlan } from './voyage.js';
import { pointAtDistance } from './searoute.js';

function statusFor(percent: number): VoyageStatus {
  if (percent <= 0.04) return 'departing';
  if (percent >= 1) return 'arrived';
  if (percent >= 0.95) return 'arriving';
  return 'in_transit';
}

export class MockPositionFeed implements ShipmentPositionFeed {
  readonly source = 'mock' as const;
  private readonly config: TrackingConfig;
  /** Voyage plans cached by shipment id (geometry is stable across polls). */
  private readonly plans = new Map<string, VoyagePlan | null>();

  constructor(config: TrackingConfig) {
    this.config = config;
  }

  async getPositions(
    shipments: TrackableShipment[],
    now: number = Date.now(),
  ): Promise<PositionUpdate[]> {
    const updates: PositionUpdate[] = [];

    for (const shipment of shipments) {
      let plan = this.plans.get(shipment.id);
      if (plan === undefined) {
        plan = buildVoyagePlan(shipment, this.config, now);
        this.plans.set(shipment.id, plan);
      }
      if (!plan) continue; // unresolved origin/destination — skip gracefully

      const update = this.sample(plan, now);
      if (update) updates.push(update);
    }
    return updates;
  }

  /** Sample one plan at `now`, applying time compression and optional looping. */
  private sample(plan: VoyagePlan, now: number): PositionUpdate | null {
    const realDuration = plan.arriveMs - plan.departMs;
    if (realDuration <= 0) return null;

    // Spread is set by phase0 (progress at referenceMs); compression governs how
    // fast dots advance from there. Decoupling them stops the fleet collapsing
    // to progress 0 when compression and the phase quantization are commensurate.
    const compressedElapsed = (now - plan.referenceMs) * this.config.timeCompression;
    let percent = plan.phase0 + compressedElapsed / realDuration;
    if (this.config.loop) {
      // Wrap completed voyages back to the start so the map never goes static.
      percent = ((percent % 1) + 1) % 1;
    } else {
      percent = Math.max(0, Math.min(1, percent));
    }

    const coveredKm = percent * plan.totalKm;
    const { position, bearing } = pointAtDistance(plan.polyline, plan.cumulativeKm, coveredKm);

    // ETA in real wall-clock terms (so the demo's countdown reads naturally),
    // derived from how much simulated voyage remains.
    const remainingFraction = Math.max(0, 1 - percent);
    const remainingRealMs = (remainingFraction * realDuration) / this.config.timeCompression;
    const eta = new Date(now + remainingRealMs).toISOString();

    return {
      shipmentId: plan.shipmentId,
      position,
      bearing,
      status: statusFor(percent),
      percent,
      covered_km: Math.round(coveredKm),
      remaining_km: Math.round(plan.totalKm - coveredKm),
      eta,
      vesselName: plan.vesselName,
      polyline: plan.polyline,
      source: 'mock',
    };
  }

  /** Test/maintenance hook: drop cached plans (e.g. after reseeding). */
  clearCache(): void {
    this.plans.clear();
  }
}
