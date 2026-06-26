/**
 * Real-time shipment tracking — shared contracts (the swap seam).
 *
 * Atlas needs moving dots and progressing lines. The data underneath them
 * (suppliers, carriers, BOL rows, lanes) is REAL — seeded from public customs
 * data via the BOL adapter (integrations/bol). Only the *motion over time* is
 * synthesized for the MVP, so an investor demo shows a live-looking map without
 * a paid carrier/AIS feed yet.
 *
 * The whole point of this module is a single interface — `ShipmentPositionFeed`
 * — with two implementations:
 *   • MockPositionFeed  — interpolates each shipment along a precomputed
 *                         sea-route at a simulated progress. Build now.
 *   • LivePositionFeed  — Terminal49 (status/ETA) + AISstream (lat/lon),
 *                         normalized to the SAME PositionUpdate shape. Build
 *                         when we have data access; drop-in, config-flip swap.
 *
 * Atlas and the API only ever see `PositionUpdate`. Swapping mock→live changes
 * no UI and no schema. See build skill: pericles-atlas-mocker.
 */

/** A geographic point. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Where a shipment is in its voyage. Mirrors the existing mocker's vocabulary
 * (in_transit / at_port / delivered) but scoped to ocean position phases.
 */
export type VoyageStatus = 'departing' | 'in_transit' | 'arriving' | 'arrived';

/**
 * One normalized position reading for one shipment. Emitted identically by the
 * mock and (future) live feed. Carries the sea-route polyline so the frontend
 * can draw the exact lane the dot rides on — no separate route call.
 *
 * The `covered_km / remaining_km / percent` triple matches the route-progress
 * shape required by pericles-atlas-ui.
 */
export interface PositionUpdate {
  shipmentId: string;
  /** Current vessel position (interpolated for mock; AIS report for live). */
  position: LatLng;
  /** Heading in degrees (0=N, 90=E), for rotating the vessel marker. */
  bearing: number;
  status: VoyageStatus;
  /** Voyage progress in [0,1]. */
  percent: number;
  covered_km: number;
  remaining_km: number;
  /** Estimated arrival, ISO 8601. */
  eta: string;
  /** Carrier-assigned vessel name when known (from the BOL row). */
  vesselName: string | null;
  /**
   * The full sea-route the dot rides, origin→destination, bending through the
   * appropriate canals/straits. Frontend draws this as the route Polyline.
   */
  polyline: LatLng[];
  /** 'mock' | 'live' — so the UI/diligence copy can label simulated motion. */
  source: 'mock' | 'live';
}

/**
 * A precomputed voyage: the geometry + the clock. Built once per shipment from
 * its real origin/destination, then sampled cheaply for any `now`.
 */
export interface VoyagePlan {
  shipmentId: string;
  vesselName: string | null;
  /** Sea-route polyline, origin→destination. */
  polyline: LatLng[];
  /** Cumulative great-circle distance (km) at each polyline vertex. */
  cumulativeKm: number[];
  totalKm: number;
  /** Voyage start / end as wall-clock epoch ms (real time, pre-compression). */
  departMs: number;
  arriveMs: number;
  /** Clock origin for sampling: progress = phase0 at referenceMs. */
  referenceMs: number;
  /** Progress in [0,1) at referenceMs — spreads the fleet across phases. */
  phase0: number;
}

/**
 * Minimal shipment shape the feed needs. Deliberately NOT the Prisma type, so
 * this module is decoupled and unit-testable with plain objects. The real
 * Shipment (BOL-native) satisfies this via its supplier relation + ports.
 */
export interface TrackableShipment {
  id: string;
  vessel_name?: string | null;
  departure_port?: string | null;
  destination_port?: string | null;
  /** Anchor for voyage timing when present (real arrival from the BOL row). */
  arrival_date?: Date | string | null;
  estimated_arrival_date?: Date | string | null;
  /** Seeded supplier coordinates = the voyage origin. */
  supplier?: { name?: string | null; latitude?: number | null; longitude?: number | null } | null;
}

/** Tuning knobs. Sensible demo defaults live in index.ts. */
export interface TrackingConfig {
  mode: 'mock' | 'live';
  /**
   * Wall-clock acceleration. 1 = real time (a 20-day voyage takes 20 days);
   * higher makes dots visibly move during a pitch. Demo default ~2000
   * (≈ a full voyage every ~15 min).
   */
  timeCompression: number;
  /** When true, completed voyages wrap to the start so the map never goes static. */
  loop: boolean;
  /** Average ocean speed for transit estimation (km/day). ~18 kn ≈ 800 km/day. */
  oceanKmPerDay: number;
}

/**
 * The seam. Mock and live both implement this; Atlas/API depend only on it.
 */
export interface ShipmentPositionFeed {
  readonly source: 'mock' | 'live';
  /**
   * Current positions for the given shipments at `now` (defaults to Date.now()).
   * Shipments whose route can't be resolved are omitted (graceful degrade —
   * never throw on a single bad row; see pericles-external-feeds).
   */
  getPositions(shipments: TrackableShipment[], now?: number): Promise<PositionUpdate[]>;
}
