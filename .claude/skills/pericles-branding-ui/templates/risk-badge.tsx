// frontend/src/components/ui/risk-badge.tsx
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Eye, OctagonAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

export type RiskLevel = 'critical' | 'elevated' | 'low' | 'monitoring';

/**
 * Severity indicator.
 *
 * Two rules are load-bearing here, both measured:
 *
 * 1. The chip's border measures 1.5–2.5:1 against its surface in both modes,
 *    so the edge is NOT a reliable signal. Severity is therefore always
 *    carried by the label + icon; colour is reinforcement only. This is also
 *    what makes it work for colourblind users and in greyscale print.
 *
 * 2. Surface/foreground come from role tokens, which already encode the
 *    light/dark split (light: `-light` tint + `-dark` text; dark: an 18%
 *    composite + the `-light` tint as text). Never hardcode a ramp step here —
 *    `bg-danger`/`bg-red-100` has no dark half, which is the whole point of
 *    routing through `bg-risk-critical`.
 */
const VARIANTS: Record<RiskLevel, { label: string; className: string; Icon: React.ElementType }> = {
  critical: {
    label: 'Critical',
    Icon: OctagonAlert,
    className: 'bg-risk-critical text-risk-critical-fg border-risk-critical-accent/40',
  },
  elevated: {
    label: 'Elevated',
    Icon: AlertTriangle,
    className: 'bg-risk-elevated text-risk-elevated-fg border-risk-elevated-accent/40',
  },
  low: {
    label: 'Low',
    Icon: CheckCircle2,
    className: 'bg-risk-low text-risk-low-fg border-risk-low-accent/40',
  },
  monitoring: {
    label: 'Monitoring',
    Icon: Eye,
    className: 'bg-risk-monitoring text-risk-monitoring-fg border-risk-monitoring-accent/40',
  },
};

interface RiskBadgeProps {
  level: RiskLevel;
  /** Overrides the default label; the badge is never icon-only. */
  label?: string;
  className?: string;
}

export const RiskBadge: React.FC<RiskBadgeProps> = ({ level, label, className = '' }) => {
  const { label: defaultLabel, className: variant, Icon } = VARIANTS[level];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5',
        'font-mono text-[11px] uppercase tracking-[0.08em]',
        variant,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {label ?? defaultLabel}
    </span>
  );
};
