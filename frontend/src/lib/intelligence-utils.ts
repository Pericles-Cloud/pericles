/**
 * Shared presentation helpers for the Intelligence module.
 *
 * Extracted verbatim from the former Events and Insights pages when they merged
 * into /intelligence (GH #12). Both pages had drifted into their own copies of
 * the same severity/type formatting; this is the single source.
 */

import type { Event } from '@/lib/api-client';

export type EventStatus = 'awaiting' | 'ongoing' | 'delayed' | 'resolved';

export interface StatusConfig {
  label: string;
  bgColor: string;
  textColor: string;
}

/**
 * Plan status. `textColor` is the `-fg` step, NOT `-text`: these sit ON their
 * matching `bgColor` tinted surface, which is exactly what `-fg` is for.
 * (`-text` on its own surface measures 4.39:1 for critical — under AA.)
 *
 * Mapped onto the risk role tokens by MEANING, not by the colour
 * each previously happened to use: an unstarted plan is an open exposure
 * (elevated), a resolved one is the only genuinely good state (low).
 * Each token pair already encodes its light and dark values, so no `dark:`
 * variant is needed here.
 */
export const STATUS_CONFIG: Record<EventStatus, StatusConfig> = {
  awaiting: {
    label: 'Awaiting plan initiation',
    bgColor: 'bg-risk-elevated',
    textColor: 'text-risk-elevated-fg',
  },
  ongoing: {
    label: 'Plan ongoing',
    bgColor: 'bg-risk-monitoring',
    textColor: 'text-risk-monitoring-fg',
  },
  delayed: {
    label: 'Plan delayed',
    bgColor: 'bg-risk-critical',
    textColor: 'text-risk-critical-fg',
  },
  resolved: {
    label: 'Resolved',
    bgColor: 'bg-risk-low',
    textColor: 'text-risk-low-fg',
  },
};

/**
 * Severity chips. `color` carries BOTH surface and foreground because the safe
 * text colour differs per family: white on the solid elevated/warning fill is
 * only 3.05:1 and fails AA. These surface/foreground pairs are the same tokens
 * RiskBadge uses and are contrast-validated in both modes (5.41–8.05:1 light,
 * 10.58–12.23:1 dark). The numeric label is always rendered alongside, so
 * severity is never carried by colour alone.
 *
 * The `-accent/40` border is not decoration: these render as a filled DISC, and
 * the tinted surface is 1.20–1.30:1 against the light card, so without an edge
 * the disc itself is not a perceivable graphic (WCAG 1.4.11). RiskBadge carries
 * the same border for the same reason.
 */
export const SEVERITY_CONFIG: Record<number, { label: string; color: string }> = {
  1: { label: '1', color: 'border border-risk-low-accent/40 bg-risk-low text-risk-low-fg' },
  2: { label: '2', color: 'border border-risk-elevated-accent/40 bg-risk-elevated text-risk-elevated-fg' },
  3: { label: '3', color: 'border border-risk-critical-accent/40 bg-risk-critical text-risk-critical-fg' },
};

export const TYPE_ICONS: Record<string, string> = {
  flood: 'M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z',
  strike: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z',
  port_closure: 'M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12',
  earthquake: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  typhoon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  cyber_attack: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  default: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
};

/** Derive the plan-facing status of an event from its validation + incident state. */
export function getEventStatus(event: Event): EventStatus {
  // Rejected or duplicate events are terminal — nothing left to plan against.
  if (event.validationStatus === 'rejected' || event.validationStatus === 'duplicate') {
    return 'resolved';
  }

  // No incident promoted yet → awaiting plan initiation.
  if (!event.incident) {
    return 'awaiting';
  }

  switch (event.incident.status) {
    case 'resolved':
    case 'closed':
      return 'resolved';
    case 'investigating':
    case 'open':
      return 'ongoing';
    default:
      return 'awaiting';
  }
}

/** Map the 0.0–1.0 severity score onto the 1/2/3 badge scale. */
export function getSeverityLevel(severity: number): number {
  if (severity < 0.33) return 1;
  if (severity < 0.66) return 2;
  return 3;
}

export function formatEventDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} GMT`;
}

/** snake_case risk type → Title Case label. */
export function formatTypeLabel(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Risk score → STANDALONE text token, for severity text on a plain card.
 *
 * Uses `-text`, not `-fg`: the dark `-fg` tints are ~90% lightness (correct on
 * their own tinted badge surface) and all four read as the same off-white on a
 * card.
 *
 * The 0.33 / 0.66 boundaries are shared with `getSeverityLevel` above,
 * `getRiskBgColor` below and `severityLabel` in `atlas-brand.ts`. They drifted
 * apart once — a 0.30 event got a green chip and an orange label — so treat the
 * four as one table.
 */
export function getRiskColor(score: number): string {
  if (score >= 0.66) return 'text-risk-critical-text';
  if (score >= 0.33) return 'text-risk-elevated-text';
  return 'text-risk-low-text';
}

/**
 * Risk score → solid fill, for bars and dots only. These are the saturated
 * `-accent` steps, which clear 3:1 as non-text UI but NOT 4.5:1 as text —
 * never put a label directly on one. Use getRiskColor for text.
 */
export function getRiskBgColor(score: number): string {
  if (score >= 0.66) return 'bg-risk-critical-accent';
  if (score >= 0.33) return 'bg-risk-elevated-accent';
  return 'bg-risk-low-accent';
}
