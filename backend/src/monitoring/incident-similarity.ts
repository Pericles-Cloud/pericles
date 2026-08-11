import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { calculateDistance } from '../mastra/tools/weather-disaster-monitor-tool.js';
import { toolLoggers } from '../mastra/tools/tool-logger.js';

const logger = toolLoggers.incidentLookup;

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

    const candidates = await client.event.findMany({
      where: {
        organization_id: organizationId,
        type: eventData.type,
        event_timestamp: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, event_hash: true, title: true, description: true, latitude: true, longitude: true },
      orderBy: { event_timestamp: 'desc' },
      take: 20, // cap the pre-filter query before geo-narrowing below
    });

    const geoNarrowed = candidates
      .filter((c) => {
        // Missing coordinates on either side: don't exclude on geography,
        // fall back to type + time + LLM judgment alone.
        if (typeof lat !== 'number' || typeof lon !== 'number' || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') {
          return true;
        }
        return calculateDistance(lat, lon, c.latitude, c.longitude) <= GEO_RADIUS_KM;
      })
      .slice(0, MAX_CANDIDATES);

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

        // Promise.race, not AbortSignal.timeout() — a deliberate deviation
        // from this repo's usual external-call convention (CLAUDE.md's
        // "External API Integration Pattern"). Mastra's Agent.generate()
        // (installed @mastra/core v0.24.9) takes no abort/signal parameter,
        // so there is no way to actually cancel the underlying OpenAI
        // request through this SDK call today. On timeout, this race's
        // loser branch stops this function from waiting on the call, but
        // the HTTP request itself keeps running in the background until
        // OpenAI responds or its own connection times out — a known,
        // currently-unavoidable leak of one in-flight request per timeout,
        // not a full cancellation. Revisit if @mastra/core adds signal
        // support.
        const result = await Promise.race([
          similarityAgent.generate(prompt, { structuredOutput: { schema: SimilarityResultSchema } }),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error('incident similarity check timed out'));
            }, LLM_TIMEOUT_MS);
          }),
        ]);

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
