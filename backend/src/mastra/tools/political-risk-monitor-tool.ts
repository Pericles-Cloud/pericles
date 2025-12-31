import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Political Risk Monitor Tool
 *
 * Purpose: Monitor political instability, government changes, and policy shifts using GDELT.
 *
 * Data Source:
 * - GDELT (Global Database of Events, Language, and Tone)
 *   API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 *
 * Risk Categories:
 * - Government Changes (_coups, elections, leadership transitions)
 * - Political Protests & Civil Unrest
 * - Policy Changes (_trade, regulatory, _sanctions)
 * - Political Violence & Instability
 *
 * Organization Isolation: Filters events based on organization's geographic exposure
 */

const LocationInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string(),
  country_code: z.string().length(2).optional()
});

const PoliticalEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // coup, protest, policy_change, violence, election
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1),
  location: z.object({
    name: z.string(),
    country: z.string(),
    latitude: z.number(),
    longitude: z.number()
  }),
  event_timestamp: z.string().datetime(),
  goldstein_scale: z.number().optional().describe('GDELT Goldstein scale: -10 (conflict) to +10 (cooperation)'),
  tone: z.number().optional().describe('GDELT average tone score'),
  source_url: z.string().url().optional(),
  raw_data: z.record(z.string(), z.any()).optional()
});

export const politicalRiskMonitorTool = createTool({
  id: 'political-risk-monitor',
  description: 'Monitor political instability, government changes, protests, and policy shifts using GDELT (Global Database of Events, Language, and Tone). Detects coups, civil unrest, sanctions, and political violence.',

  inputSchema: z.object({
    locations: z.array(LocationInputSchema).min(1).describe('Locations to monitor for political events'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_hours: z.number().int().min(1).max(168).default(24).describe('How many hours back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    political_events: z.array(PoliticalEventSchema).describe('Detected political risk events'),
    monitored_locations_count: z.number().int().describe('Number of locations checked'),
    api_calls_made: z.number().int().describe('Number of API calls made to GDELT')
  }),

  execute: async ({ context }) => {
    const { locations, severity_threshold: _severity_threshold, lookback_hours: _lookback_hours, organization_id } = context;

    // Log the input parameters received
    console.log(`[Political Risk Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for political risk monitoring');
    }

    console.log(`[Political Risk Monitor] Monitoring ${locations.length} locations for organization: ${organization_id}`);

    // PLACEHOLDER: Actual GDELT API integration to be implemented
    // API Documentation: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
    //
    // Example GDELT Query:
    // https://api.gdeltproject.org/api/v2/doc/doc?query=protest%20sourcecountry:CN&mode=artlist&maxrecords=250&format=json

    try {
      const politicalEvents: Array<z.infer<typeof PoliticalEventSchema>> = [];
      const apiCallsMade = 0;

      // TODO: Implement GDELT API integration
      // const events = await fetchGDELTEvents(_locations, lookback_hours: _lookback_hours, severity_threshold);
      // apiCallsMade += locations.length;

      // PLACEHOLDER: Return empty array for now
      console.log(`[Political Risk Monitor] Found ${politicalEvents.length} events, made ${apiCallsMade} API calls`);

      return {
        political_events: politicalEvents,
        monitored_locations_count: locations.length,
        api_calls_made: apiCallsMade
      };

    } catch (error) {
      console.error(`[Political Risk Monitor] Failed to fetch GDELT data:`, error);
      throw new Error(`Political risk monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Helper Functions (to be implemented with actual API integration)
// ============================================================================

/**
 * Fetch political events from GDELT API
 *
 * GDELT DOC 2.0 API provides real-time event detection from global news
 *
 * Query parameters:
 * - query: Search terms (e.g., "protest", "coup", "sanctions")
 * - sourcecountry: Two-letter country code
 * - timespan: Time range (e.g., "24h", "7d")
 * - mode: artlist (article list) or timeline
 * - format: json
 */
async function _fetchGDELTEvents(
  _locations: Array<{ latitude: number; longitude: number; name: string; country_code?: string }>,
  _lookbackHours: number,
  _severityThreshold: string
): Promise<Array<z.infer<typeof PoliticalEventSchema>>> {
  // TODO: Implement GDELT API calls
  //
  // const events: z.infer<typeof PoliticalEventSchema>[] = [];
  // const timespan = `${lookbackHours}h`;
  //
  // for (const location of locations) {
  //   const queries = [
  //     'protest', 'coup', 'sanctions', 'strike', 'election',
  //     'government change', 'policy', 'civil unrest'
  //   ];
  //
  //   for (const query of queries) {
  //     const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  //     url.searchParams.set('query', location.country_code
  //       ? `${query} sourcecountry:${location.country_code}`
  //       : query
  //     );
  //     url.searchParams.set('mode', 'artlist');
  //     url.searchParams.set('timespan', _timespan);
  //     url.searchParams.set('format', 'json');
  //     url.searchParams.set('maxrecords', '100');
  //
  //     const response = await fetch(url.toString());
  //     const data = await response.json();
  //
  //     // Parse GDELT articles and extract events
  //     // Calculate severity from Goldstein scale and tone
  //     // Filter by proximity to monitored locations
  //   }
  // }
  //
  // return events;

  return [];
}

/**
 * Map GDELT Goldstein scale to normalized severity (0.0-1.0)
 *
 * Goldstein Scale: -10.0 (extreme conflict) to +10.0 (extreme cooperation)
 * We invert this so negative events (_conflict) map to higher severity
 */
function _goldsteinToSeverity(goldsteinScore: number): number {
  // Invert: -10 → 1.0, 0 → 0.5, +10 → 0.0
  const normalized = (10 - goldsteinScore) / 20; // Range: 0.0 to 1.0
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Classify political event type from GDELT event codes or article content
 */
function _classifyPoliticalEventType(_gdeltData: any): string {
  // TODO: Implement classification logic based on GDELT CAM codes
  // GDELT uses CAM (Conflict and Mediation Event Observations) codes
  //
  // Common event types:
  // - coup: Military takeover, government overthrow
  // - protest: Public demonstrations, civil unrest
  // - policy_change: New laws, regulations, trade policies
  // - violence: Political violence, riots
  // - election: Electoral events, leadership transitions

  return 'unknown';
}
