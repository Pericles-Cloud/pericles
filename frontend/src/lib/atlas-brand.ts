/**
 * Pericles brand + severity palette for Atlas map rendering.
 *
 * Source of truth: PRD: Atlas §7.4 (Color Palette & Typography) and the
 * platform-wide severity convention. Google Maps markers/polylines require
 * literal color strings (they can't consume CSS variables), so the Atlas map
 * layer references these constants directly.
 *
 * These values mirror the brand ramps in globals.css (--color-purple-600,
 * --color-gold-500, --color-grey-*, and the semantic risk families). This file
 * is the ONE sanctioned place for raw hex outside globals.css, because the
 * Google Maps API cannot consume CSS custom properties. UI chrome must still
 * use the Tailwind role utilities (bg-primary, bg-card, …).
 *
 * Keep in sync with `pericles-branding-ui`; changing a value here without
 * changing the ramp puts the map out of step with the rest of the product.
 */

export const PERICLES = {
  /** Primary brand — navigation, active states, supplier pins. purple-600. */
  purple: '#524765',
  /** Accent — highlights, key indicators, destination ports. gold-500. */
  gold: '#D19B2F',
  /** Secondary text, inactive states, default route lines. grey-500. */
  slate: '#7D7887',
  white: '#FFFFFF',
} as const;

/**
 * Categorical palette for delineating branded subsidiaries on the map — vessel
 * dots and their route lines are colored per subsidiary so a parent rollup is
 * readable at a glance.
 *
 * Categorical, NOT semantic, and it must not collide with anything else drawn
 * on the same map. Three exclusions, each of which was violated once:
 *   - `SEVERITY.*` (#BD3728 danger, #DF7920 warning, #4377B1 info, #7D7887 low)
 *     — a subsidiary route in a severity colour reads as an event.
 *   - `PERICLES.purple` #524765 — that is the supplier-pin fill and its legend
 *     swatch, so a subsidiary's vessels would look like supplier pins.
 *   - `PERICLES.gold` #D19B2F — the brand accent and the destination-port pin,
 *     and also the `vesselColor` fallback for vessels with no subsidiary.
 *
 * What is left has to stay legible at dot size, so these are saturated hues
 * with real separation, not neighbouring steps of one ramp.
 *
 * PER MODE, for the same reason MAP_COLORS is. A single categorical palette
 * cannot serve both maps: clearing 3:1 on the light land (grey-100, L=0.928)
 * requires relative luminance <= 0.175, and clearing 3:1 on the dark land
 * (purple-700, L=0.046) requires >= 0.238 — the two windows do not overlap, so
 * any fixed palette fails one map. The light set measured 4.16–4.97:1 on
 * grey-100 but only 2.03–2.42:1 on purple-700, i.e. every subsidiary vessel and
 * route was under the non-text floor in dark mode.
 *
 * The dark set keeps each light hue (within +-8 degrees) and lifts it. Measured:
 * 3.32–7.50:1 on purple-700 land, >= 62 RGB separation pairwise, >= 65 from the
 * dark supplier/port pins and >= 50 from the dark route line.
 */
const SUBSIDIARY_PALETTE_LIGHT = [
  '#7E57C2', // violet
  '#2E7D8F', // teal
  '#B5487F', // magenta
  '#3F7A5E', // deep green
  '#5C6BC0', // indigo
  '#00838F', // dark cyan
  '#8D6E63', // taupe
  '#546E7A', // blue grey
] as const;

const SUBSIDIARY_PALETTE_DARK = [
  '#9D80D1', // violet
  '#84C8D7', // teal
  '#D18AAE', // magenta
  '#7AB89B', // deep green
  '#6F84FB', // indigo
  '#55E9F6', // dark cyan
  '#B48574', // taupe
  '#53A1C6', // blue grey
] as const;

/**
 * Map object colours, per mode. These MUST flip with the theme.
 *
 * `PERICLES.purple` #524765 maxes out at 2.45:1 against pure black, so on any
 * dark map it can never reach the 3:1 non-text floor — a purple-600 supplier
 * pin on dark land is invisible no matter how dark the land is. The fix is the
 * pin, not the land. Verified on the dark land (purple-700): supplier 7.35:1,
 * port 6.41:1, route 4.28:1.
 */
export const MAP_COLORS = {
  light: { supplier: PERICLES.purple, port: PERICLES.gold, route: PERICLES.slate },
  dark: {
    supplier: '#D7D1E0', // purple-200
    port: '#E2C283', // gold-300
    route: '#A4A0AB', // grey-400
  },
} as const;

export function mapColors(isDark: boolean): (typeof MAP_COLORS)['light' | 'dark'] {
  return isDark ? MAP_COLORS.dark : MAP_COLORS.light;
}

/**
 * Stable color for a subsidiary by its index in the (sorted) set.
 *
 * `isDark` must be threaded through from `useResolvedDark()` — the index picks
 * the hue, the mode picks the step, so a subsidiary keeps its identity across a
 * theme switch while staying above the 3:1 floor on whichever land is drawn.
 */
export function subsidiaryColor(index: number, isDark = false): string {
  const palette = isDark ? SUBSIDIARY_PALETTE_DARK : SUBSIDIARY_PALETTE_LIGHT;
  return palette[index % palette.length];
}

/*
 * NOTE: the former `SEVERITY` map and `severityColor()` were deleted. Their last
 * caller (the Atlas events feed) moved to `getRiskColor` / `getRiskBgColor` in
 * `intelligence-utils.ts`, which resolve to the risk role tokens and therefore
 * adapt per mode. A future event layer on the map needs mode-aware hexes —
 * follow the MAP_COLORS pattern above, not a fixed severity table.
 */

/**
 * Human label for a 0..1 severity score.
 *
 * THREE tiers, on the same 0.33 / 0.66 boundaries as `getSeverityLevel`,
 * `getRiskColor` and `getRiskBgColor` in `intelligence-utils.ts`. All four must
 * agree: when this had a fourth "Medium" bucket at `> 0`, a 0.30-severity event
 * rendered a green chip in the event list and an orange label in the Atlas feed
 * — the same event in two risk families on adjacent surfaces. Change the
 * boundaries in one place and you must change them in all four.
 *
 * Vocabulary matches the platform's risk states (Critical / Elevated / Low),
 * not the old Critical/High/Medium/Low scale.
 */
export function severityLabel(score: number): 'Critical' | 'Elevated' | 'Low' {
  if (score >= 0.66) return 'Critical';
  if (score >= 0.33) return 'Elevated';
  return 'Low';
}
