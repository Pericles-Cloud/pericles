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

  for (const candidate of geoNarrowed) {
    try {
      const prompt =
        `Report A: "${eventData.title}" — ${eventData.description}\n\n` +
        `Report B: "${candidate.title}" — ${candidate.description}\n\n` +
        'Are Report A and Report B describing the same real-world incident?';

      // Promise.race, not AbortSignal.timeout() — a deliberate deviation from
      // this repo's usual external-call convention (CLAUDE.md's "External
      // API Integration Pattern"). Mastra's Agent.generate() (installed
      // @mastra/core v0.24.9) takes no abort/signal parameter, so there is
      // no way to actually cancel the underlying OpenAI request through this
      // SDK call today. On timeout, this race's loser branch stops this
      // function from waiting on the call, but the HTTP request itself keeps
      // running in the background until OpenAI responds or its own
      // connection times out — a known, currently-unavoidable leak of one
      // in-flight request per timeout, not a full cancellation. Revisit if
      // @mastra/core adds signal support.
      const result = await Promise.race([
        similarityAgent.generate(prompt, { structuredOutput: { schema: SimilarityResultSchema } }),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('incident similarity check timed out'));
          }, LLM_TIMEOUT_MS);
        }),
      ]);

      const verdict = result.object;
      if (verdict.same_incident && verdict.confidence >= SAME_INCIDENT_CONFIDENCE_THRESHOLD) {
        return { id: candidate.id, event_hash: candidate.event_hash };
      }
    } catch (err) {
      logger.warn(
        { err, candidateId: candidate.id },
        '[Dedup] Incident similarity check failed — treating as not a duplicate'
      );
    }
  }

  return null;
}
