/**
 * Pericles brand + severity palette for Atlas map rendering.
 *
 * Source of truth: PRD: Atlas §7.4 (Color Palette & Typography) and the
 * platform-wide severity convention. Google Maps markers/polylines require
 * literal color strings (they can't consume CSS variables), so the Atlas map
 * layer references these constants directly.
 *
 * NOTE: these brand colors are not yet wired into the global design tokens
 * (globals.css :root still ships the default shadcn palette). Wiring
 * --primary/--accent to these values is a separate, app-wide change.
 */

export const PERICLES = {
  /** Primary brand — navigation, active states, supplier pins. */
  purple: '#524765',
  /** Accent — highlights, key indicators, destination ports. */
  gold: '#D19B2F',
  /** Secondary text, inactive states, default route lines. */
  slate: '#78909C',
  white: '#FFFFFF',
  black: '#000000',
} as const;

/** Severity colors, consistent across Pericles modules (PRD §7.4). */
export const SEVERITY = {
  critical: '#DC2626', // red
  high: '#D97706', // amber/orange
  medium: '#EAB308', // yellow
  low: '#78909C', // slate/blue
} as const;

/** Map a 0..1 severity score to a palette color. */
export function severityColor(score: number): string {
  if (score >= 0.66) return SEVERITY.critical;
  if (score >= 0.33) return SEVERITY.high;
  if (score > 0) return SEVERITY.medium;
  return SEVERITY.low;
}

/** Human label for a 0..1 severity score. */
export function severityLabel(score: number): 'Critical' | 'High' | 'Medium' | 'Low' {
  if (score >= 0.66) return 'Critical';
  if (score >= 0.33) return 'High';
  if (score > 0) return 'Medium';
  return 'Low';
}
