import { Ship, Plane, TrainFront, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TransportMode } from './api-client';

/**
 * Transport-mode metadata for Atlas (GH #10).
 *
 * Mode differentiation on the map is done with ICON SHAPE only — deliberately
 * no per-mode colours. atlas-brand.ts documents why: the map's hue budget is
 * already fully committed to severity (never re-use for non-events), the brand
 * purple/gold (supplier/port pins), and the per-subsidiary categorical palette
 * (vessels + their routes). Reaching for new mode hues would either collide
 * with one of those semantics or fail the 3:1 non-text floor on one map theme.
 * A neutral badge (white circle, ink icon) reads on both light and dark land
 * without claiming any of the committed colours.
 */

export interface TransportModeInfo {
  mode: TransportMode;
  label: string;
  icon: LucideIcon;
}

export const TRANSPORT_MODES: TransportModeInfo[] = [
  { mode: 'MARITIME', label: 'Maritime', icon: Ship },
  { mode: 'RAIL', label: 'Rail', icon: TrainFront },
  { mode: 'ROAD', label: 'Road', icon: Truck },
  { mode: 'AIR', label: 'Air', icon: Plane },
];

/**
 * Modes that get a dedicated icon on the map. MARITIME is the ocean-BOL default
 * and already reads via the sea-route arcs + moving vessel layer, so it gets a
 * legend entry but no extra origin marker — non-maritime legs are the thing
 * that would otherwise be indistinguishable.
 */
export const MODE_MARKER_MODES: readonly TransportMode[] = ['AIR', 'RAIL', 'ROAD'];

export function transportModeInfo(mode: TransportMode): TransportModeInfo {
  return TRANSPORT_MODES.find((m) => m.mode === mode) ?? TRANSPORT_MODES[0];
}