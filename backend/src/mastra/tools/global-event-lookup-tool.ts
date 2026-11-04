import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPrismaClient } from '../../monitoring/db-client.js';

/**
 * Global Event Lookup Tool
 *
 * Purpose: Deduplicate events against the Global Event Store.
 * One real-world occurrence = one event, regardless of how many sources report it.
 *
 * Match criteria:
 * - Category
 * - Location proximity (Haversine distance within category-appropriate threshold)
 * - Time window
 * - Actor/target similarity
 */
export const globalEventLookupTool = createTool({
  id: 'global-event-lookup-tool',
  description: `
Check if an event already exists in the Global Event Store.
Returns matching events with similarity scores for deduplication decisions.

Use this tool BEFORE creating a new event to avoid duplicates.
One real-world occurrence = one event, regardless of how many sources report it.
`,
  inputSchema: z.object({
    // Event identity for matching
    category: z.string().describe('Primary event category'),
    subcategory: z.string().optional().describe('Event subcategory'),
    
    // Location for proximity matching
    latitude: z.number().min(-90).max(90).describe('Event latitude'),
    longitude: z.number().min(-180).max(180).describe('Event longitude'),
    country_iso: z.string().length(2).optional().describe('ISO 3166 alpha-2 country code'),
    
    // Time window for matching
    occurred_at: z.string().datetime().describe('When the event occurred (ISO 8601)'),
    
    // Actor/target for similarity matching
    actor: z.string().optional().describe('Who performed the action'),
    target: z.string().optional().describe('What was affected'),
    
    // Source info for the new event
    source_url: z.string().url().describe('URL of the source reporting this event'),
    source_publisher: z.string().describe('Publisher name'),
    source_tier: z.number().min(1).max(4).describe('Source tier (1=official, 4=social)'),
    
    // Matching thresholds
    location_threshold_km: z.number().default(100).describe('Max distance for location match (km)'),
    time_window_hours: z.number().default(48).describe('Time window for matching (hours)'),
  }),
  outputSchema: z.object({
    is_duplicate: z.boolean().describe('Whether a matching event was found'),
    matching_events: z.array(z.object({
      event_id: z.string(),
      event_hash: z.string(),
      headline: z.string(),
      status: z.string(),
      intrinsic_severity: z.string(),
      confidence: z.string(),
      // Similarity scores
      location_distance_km: z.number().nullable(),
      time_difference_hours: z.number().nullable(),
      actor_similarity: z.number().nullable(),
      target_similarity: z.number().nullable(),
      overall_similarity: z.number(),
      // Recommendation
      recommendation: z.enum(['exact_match', 'likely_duplicate', 'possible_duplicate', 'new_event']),
      reason: z.string(),
    })),
    // Source tracking
    source_already_attached: z.boolean().describe('Whether this source URL is already attached to a matching event'),
  }),
  execute: async ({ context }) => {
    const prisma = getPrismaClient();
    
    const {
      category,
      latitude,
      longitude,
      occurred_at,
      actor,
      target,
      source_url,
      location_threshold_km,
      time_window_hours,
    } = context;

    const eventTime = new Date(occurred_at);
    const timeWindowStart = new Date(eventTime.getTime() - time_window_hours * 60 * 60 * 1000);
    const timeWindowEnd = new Date(eventTime.getTime() + time_window_hours * 60 * 60 * 1000);

    // Find candidate events in the same category and time window
    const candidates = await prisma.globalEvent.findMany({
      where: {
        category,
        occurred_at: {
          gte: timeWindowStart,
          lte: timeWindowEnd,
        },
        status: {
          notIn: ['RESOLVED', 'RETRACTED', 'MERGED'],
        },
      },
      take: 50, // Limit candidates
    });

    const matchingEvents = candidates.map((event) => {
      // Calculate location distance (Haversine)
      let locationDistanceKm: number | null = null;
      if (event.latitude !== null && event.longitude !== null) {
        locationDistanceKm = haversineDistance(
          latitude,
          longitude,
          event.latitude,
          event.longitude
        );
      }

      // Calculate time difference
      const timeDifferenceHours = event.occurred_at
        ? Math.abs(eventTime.getTime() - event.occurred_at.getTime()) / (1000 * 60 * 60)
        : null;

      // Calculate actor/target similarity (simple string similarity)
      const actorSimilarity = actor && event.actor
        ? stringSimilarity(actor, event.actor)
        : null;
      const targetSimilarity = target && event.target
        ? stringSimilarity(target, event.target)
        : null;

      // Calculate overall similarity score
      let overallSimilar = 0;
      let factors = 0;

      if (locationDistanceKm !== null) {
        const locationScore = Math.max(0, 1 - locationDistanceKm / location_threshold_km);
        overallSimilar += locationScore;
        factors++;
      }

      if (timeDifferenceHours !== null) {
        const timeScore = Math.max(0, 1 - timeDifferenceHours / time_window_hours);
        overallSimilar += timeScore;
        factors++;
      }

      if (actorSimilarity !== null) {
        overallSimilar += actorSimilarity;
        factors++;
      }

      if (targetSimilarity !== null) {
        overallSimilar += targetSimilarity;
        factors++;
      }

      overallSimilar = factors > 0 ? overallSimilar / factors : 0;

      // Determine recommendation
      let recommendation: 'exact_match' | 'likely_duplicate' | 'possible_duplicate' | 'new_event';
      let reason: string;

      if (overallSimilar >= 0.9) {
        recommendation = 'exact_match';
        reason = 'Very high similarity across all matching criteria';
      } else if (overallSimilar >= 0.7) {
        recommendation = 'likely_duplicate';
        reason = 'High similarity - likely the same event reported by different sources';
      } else if (overallSimilar >= 0.5) {
        recommendation = 'possible_duplicate';
        reason = 'Moderate similarity - may be related but could be distinct events';
      } else {
        recommendation = 'new_event';
        reason = 'Low similarity - appears to be a distinct event';
      }

      // Check if source URL is already attached
      const sources = event.sources as Array<{ url: string }> | null;
      const sourceAlreadyAttached = sources?.some((s) => s.url === source_url) ?? false;

      return {
        event_id: event.id,
        event_hash: event.event_hash,
        headline: event.headline,
        status: event.status,
        intrinsic_severity: event.intrinsic_severity,
        confidence: event.confidence,
        location_distance_km: locationDistanceKm,
        time_difference_hours: timeDifferenceHours,
        actor_similarity: actorSimilarity,
        target_similarity: targetSimilarity,
        overall_similarity: overallSimilar,
        recommendation,
        reason,
        source_already_attached: sourceAlreadyAttached,
      };
    });

    // Sort by similarity (highest first)
    matchingEvents.sort((a, b) => b.overall_similarity - a.overall_similarity);

    // Determine if this is a duplicate
    const isDuplicate = matchingEvents.some(
      (e) => e.recommendation === 'exact_match' || e.recommendation === 'likely_duplicate'
    );

    const sourceAlreadyAttached = matchingEvents.some((e) => e.source_already_attached);

    return {
      is_duplicate: isDuplicate,
      matching_events: matchingEvents.slice(0, 10), // Return top 10 matches
      source_already_attached: sourceAlreadyAttached,
    };
  },
});

/**
 * Calculate Haversine distance between two coordinates in kilometers
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Simple string similarity using Jaccard index on word tokens
 */
function stringSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  
  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}
