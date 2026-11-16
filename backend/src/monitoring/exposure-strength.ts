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
