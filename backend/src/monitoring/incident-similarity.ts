import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { calculateDistance } from '../mastra/tools/weather-disaster-monitor-tool.js';
import { toolLoggers } from '../mastra/tools/tool-logger.js';

const logger = toolLoggers.incidentSimilarity;

/**
 * Same-incident detection for events that describe the same real-world
 * disruption but were reported with different wording by different sources
 * (#22 — e.g. "Iran launches strikes" vs "Iranian missile attack reported").
 *
 * The existing dedup (incident-lookup-tool.ts's content hash, and
 * storeEvent's exact title+source+type check) only catches near-identical
 * strings — genuinely different phrasing of the same incident hashes to a
 * completely different value and sails through as a "new" event. Lexical
 * similarity (even stemmed) doesn't reliably close that gap either: the
 * example above shares almost no vocabulary. Closing it needs semantic
 * judgment, so this makes one narrowly-scoped LLM call per candidate —
 * narrowed by type + geography + a time window first, so the common case
 * (no plausible candidates) costs nothing.
 */

const TIME_WINDOW_MS = 24 * 60 * 60 * 1000; // ±24h
const GEO_RADIUS_KM = 250;
const MAX_CANDIDATES = 5;
// A finite stand-in for "no distance available" (missing coordinates),
// used only as a sort key so coordinate-less candidates sort after every
// geo-matched one. Not Infinity: Infinity - Infinity is NaN, and a sort
// comparator returning NaN is not reliably well-defined.
const NO_DISTANCE_SENTINEL = Number.MAX_SAFE_INTEGER;
const LLM_TIMEOUT_MS = 10000;
const SAME_INCIDENT_CONFIDENCE_THRESHOLD = 0.7;

const similarityAgent = new Agent({
  name: 'incident-similarity-classifier',
  instructions: [
    'You determine whether two supply-chain risk event reports describe the SAME real-world incident, possibly worded very differently by different news sources.',
    'Base your answer strictly on the two reports given — do not assume facts not stated in either one.',
    'Two reports about the same general topic or region but a different specific incident (e.g. two different port strikes in different cities, or the same conflict on two different days) are NOT the same incident.',
    'Return only the structured JSON matching the provided schema.',
  ],
  model: 'openai/gpt-4o-mini',
});

const SimilarityResultSchema = z.object({
  same_incident: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export interface DuplicateCandidate {
  id: string;
  event_hash: string;
}

interface CandidateEventInput {
  type: string;
  title: string;
  description: string;
  event_timestamp: string | Date;
  location?: { latitude?: number | null; longitude?: number | null };
}

/**
 * Looks for an existing event describing the same incident as `eventData`.
 * Read-only — callers run this BEFORE opening a write transaction, since it
 * may make a network LLM call and a DB transaction must never be held open
 * across one.
 *
 * Fails open: any error narrows to "no duplicate found" rather than risking
 * either blocking event storage or, worse, wrongly merging two genuinely
 * different incidents on a flaky classification call.
 */
export async function findDuplicateIncident(
  client: Prisma.TransactionClient | { event: Prisma.TransactionClient['event'] },
  organizationId: string,
  eventData: CandidateEventInput
): Promise<DuplicateCandidate | null> {
  // Whole body wrapped, not just the per-candidate LLM call: the doc comment
  // above promises "any error narrows to no duplicate found," but the
  // candidate-fetch query itself (a DB call, or an invalid event_timestamp
  // reaching `new Date()`) was NOT covered by the old per-candidate
  // try/catch — an error there propagated uncaught, past storeEvent (which
  // has no catch either) to runMonitoringCycle's per-event handler, which
  // logs and drops the event entirely. That's strictly worse than "no
  // duplicate found": it silently loses the event instead of just storing
  // it without a dedup check.
  try {
    const eventTime = new Date(eventData.event_timestamp);
    const windowStart = new Date(eventTime.getTime() - TIME_WINDOW_MS);
    const windowEnd = new Date(eventTime.getTime() + TIME_WINDOW_MS);
    const lat = eventData.location?.latitude;
    const lon = eventData.location?.longitude;

    // A rough bounding-box prefilter, applied in the DB query itself — not
    // just in the geoNarrowed JS filter below. Without this, `take: 20`
    // caps the query by recency alone before any geography is considered:
    // for a globally-monitored org with 20+ same-type events worldwide in
    // the ±24h window, a genuinely nearby duplicate ranked 21st-or-later by
    // recency would never even be fetched, let alone reach the geo/LLM
    // narrowing step. ~1 degree latitude ≈ 111km; longitude degrees shrink
    // toward the poles by cos(latitude), so widen (not narrow) the box by
    // clamping that factor away from 0 rather than risk excluding real
    // candidates near high latitudes. This is a superset of the true
    // GEO_RADIUS_KM circle — geoNarrowed below still applies the exact
    // Haversine radius — so it can only ever admit more candidates for the
    // precise filter to consider, never wrongly exclude one.
    const boundingBox: Prisma.EventWhereInput | null =
      typeof lat === 'number' && typeof lon === 'number'
        ? (() => {
            const latDeltaDeg = GEO_RADIUS_KM / 111;
            const lonShrinkFactor = Math.max(Math.cos((lat * Math.PI) / 180), 0.1);
            const lonDeltaDeg = GEO_RADIUS_KM / (111 * lonShrinkFactor);
            const latCondition = { gte: lat - latDeltaDeg, lte: lat + latDeltaDeg };

            const lonMin = lon - lonDeltaDeg;
            const lonMax = lon + lonDeltaDeg;
            // Antimeridian wraparound: a naive [lonMin, lonMax] range breaks
            // for events near +/-180 degrees longitude (e.g. Fiji, Bering
            // Strait shipping lanes) — two points 50km apart there can sit
            // on opposite sides of the +180/-180 seam, and a single range
            // would never span both. Split into two ranges instead whenever
            // the box would cross the seam.
            if (lonMax > 180) {
              return {
                latitude: latCondition,
                OR: [{ longitude: { gte: lonMin } }, { longitude: { lte: lonMax - 360 } }],
              };
            }
            if (lonMin < -180) {
              return {
                latitude: latCondition,
                OR: [{ longitude: { gte: lonMin + 360 } }, { longitude: { lte: lonMax } }],
              };
            }
            return { latitude: latCondition, longitude: { gte: lonMin, lte: lonMax } };
          })()
        : null;

    const candidates = await client.event.findMany({
      where: {
        organization_id: organizationId,
        type: eventData.type,
        event_timestamp: { gte: windowStart, lte: windowEnd },
        // Exclude events already marked as duplicates of something else (so
        // a match always links to the canonical primary rather than
        // chaining duplicate -> duplicate -> duplicate) AND events already
        // rejected as noise — otherwise a genuinely new incident can fuzzy-
        // match against a known-bad event, get stored as validation_status:
        // 'duplicate' linked to it, and become invisible in the default
        // feed (GET /api/events excludes 'duplicate' by default) — a real
        // incident silently shadowed by an already-dismissed one.
        validation_status: { notIn: ['duplicate', 'rejected'] },
        ...(boundingBox
          ? // Events with no coordinates at all still pass through
            // (fall back to type + time + LLM judgment alone), matching
            // geoNarrowed's own missing-coordinate behavior below.
            { OR: [{ latitude: null }, { longitude: null }, boundingBox] }
          : {}),
      },
      select: { id: true, event_hash: true, title: true, description: true, latitude: true, longitude: true },
      orderBy: { event_timestamp: 'desc' },
      take: 20, // cap the pre-filter query before geo-narrowing below
    });

    // Sorted closest-first before capping to MAX_CANDIDATES, not left in
    // the query's recency order: without this, a truly nearby (and likely
    // more relevant) candidate could lose its slot to a merely more recent
    // but farther-away one once the cap is applied, letting a real
    // duplicate go undetected and get stored as a fresh event instead of
    // being linked.
    const geoNarrowed = candidates
      .map((c) => {
        // Missing coordinates on either side: don't exclude on geography,
        // fall back to type + time + LLM judgment alone — sorts after every
        // geo-matched candidate (see NO_DISTANCE_SENTINEL below), preserving
        // their original recency order relative to each other.
        const distanceKm =
          typeof lat === 'number' && typeof lon === 'number' && typeof c.latitude === 'number' && typeof c.longitude === 'number'
            ? calculateDistance(lat, lon, c.latitude, c.longitude)
            : null;
        return { candidate: c, distanceKm };
      })
      .filter(({ distanceKm }) => distanceKm === null || distanceKm <= GEO_RADIUS_KM)
      .sort((a, b) => (a.distanceKm ?? NO_DISTANCE_SENTINEL) - (b.distanceKm ?? NO_DISTANCE_SENTINEL))
      .slice(0, MAX_CANDIDATES)
      .map(({ candidate }) => candidate);

    // Classified in PARALLEL, not sequentially: MAX_CANDIDATES (5) sequential
    // calls at LLM_TIMEOUT_MS (10s) each is a ~50s worst case for one event,
    // multiplied across every candidate-bearing event in a cycle — well past
    // the monitoring loop's own 15s default polling interval
    // (MONITORING_DEFAULT_INTERVAL_MS). In parallel, the worst case for one
    // event is ~10s regardless of candidate count.
    const verdicts = await Promise.allSettled(
      geoNarrowed.map(async (candidate) => {
        const prompt =
          `Report A: "${eventData.title}" — ${eventData.description}\n\n` +
          `Report B: "${candidate.title}" — ${candidate.description}\n\n` +
          'Are Report A and Report B describing the same real-world incident?';

        const result = await similarityAgent.generate(prompt, {
          structuredOutput: { schema: SimilarityResultSchema },
          abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        });

        return { candidate, verdict: result.object };
      })
    );

    // A probabilistic verdict, not a certainty (#22 review): the caller
    // (storeEvent) does NOT skip storing the event on a match here — it
    // creates the event normally, marked validation_status: 'duplicate' and
    // linked to whichever candidate matched, so a wrong classification never
    // permanently destroys a genuinely new incident. Ties broken by highest
    // confidence, and by geo/time recency (geoNarrowed's own order) if still
    // tied.
    let best: DuplicateCandidate | null = null;
    let bestConfidence = -1;
    for (const outcome of verdicts) {
      if (outcome.status === 'rejected') {
        logger.warn(
          { err: outcome.reason },
          '[Dedup] Incident similarity check failed — treating as not a duplicate'
        );
        continue;
      }
      const { candidate, verdict } = outcome.value;
      if (
        verdict.same_incident &&
        verdict.confidence >= SAME_INCIDENT_CONFIDENCE_THRESHOLD &&
        verdict.confidence > bestConfidence
      ) {
        best = { id: candidate.id, event_hash: candidate.event_hash };
        bestConfidence = verdict.confidence;
      }
    }

    return best;
  } catch (err) {
    logger.warn({ err }, '[Dedup] Same-incident check failed — treating as not a duplicate');
    return null;
  }
}
