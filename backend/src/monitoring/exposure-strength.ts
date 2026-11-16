/**
 * Exposure strength (Client Monitoring spec §5). Dependency-free so pure
 * evaluators can import it without loading the database or queue clients.
 */

export type ExposureStrength = 'direct' | 'probable' | 'possible' | 'strategic';

/** Single ordering of exposure strength, weakest first. */
export const STRENGTH_RANK: Record<ExposureStrength, number> = { possible: 1, strategic: 2, probable: 3, direct: 4 };

/** Possible exposures go on the watch list; everything else goes to Validation. */
export function statusForStrength(strength: ExposureStrength): 'WATCHING' | 'CANDIDATE' {
  return strength === 'possible' ? 'WATCHING' : 'CANDIDATE';
}

export type Severity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Single ordering for intrinsic severity and exposure priority (same scale).
 * Unknown values rank 0.
 */
export const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function severityRank(value: unknown): number {
  return typeof value === 'string' && value in SEVERITY_RANK ? SEVERITY_RANK[value as Severity] : 0;
}
