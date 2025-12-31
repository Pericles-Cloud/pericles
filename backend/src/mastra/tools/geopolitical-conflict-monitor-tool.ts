import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Geopolitical & Conflict Monitor Tool
 *
 * Purpose: Monitor armed conflicts, wars, terrorist attacks, and geopolitical tensions.
 *
 * Data Source:
 * - GDELT (Global Database of Events, Language, and Tone)
 *   API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 *
 * Risk Categories:
 * - Armed Conflicts & Wars
 * - Terrorist Attacks
 * - Military Actions
 * - Border Disputes
 * - Geopolitical Tensions
 * - Security Threats
 *
 * Organization Isolation: Filters events based on organization's geographic exposure and supply chain
 */

const LocationInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string(),
  country_code: z.string().length(2).optional()
});

const ConflictEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // armed_conflict, terrorist_attack, military_action, border_dispute, tension, security_threat
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1),
  location: z.object({
    name: z.string(),
    country: z.string(),
    region: z.string().optional(),
    latitude: z.number(),
    longitude: z.number()
  }),
  actors: z.array(z.string()).optional().describe('Involved parties (countries, groups)'),
  casualties: z.number().int().optional(),
  goldstein_scale: z.number().optional().describe('GDELT Goldstein scale: -10 (conflict) to +10 (cooperation)'),
  tone: z.number().optional().describe('GDELT average tone score'),
  event_timestamp: z.string().datetime(),
  source_url: z.string().url().optional(),
  raw_data: z.record(z.string(), z.any()).optional()
});

export const geopoliticalConflictMonitorTool = createTool({
  id: 'geopolitical-conflict-monitor',
  description: 'Monitor armed conflicts, wars, terrorist attacks, military actions, border disputes, and geopolitical tensions using GDELT (Global Database of Events, Language, and Tone).',

  inputSchema: z.object({
    locations: z.array(LocationInputSchema).min(1).describe('Locations to monitor for conflict events'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('high').describe('Minimum severity to report'),
    lookback_hours: z.number().int().min(1).max(168).default(24).describe('How many hours back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    conflict_events: z.array(ConflictEventSchema).describe('Detected geopolitical and conflict events'),
    conflict_count: z.number().int().describe('Number of armed conflicts detected'),
    terrorist_attack_count: z.number().int().describe('Number of terrorist attacks detected'),
    high_severity_count: z.number().int().describe('Number of high severity events'),
    api_calls_made: z.number().int().describe('Number of API calls made to GDELT')
  }),

  execute: async ({ context }) => {
    const { locations, severity_threshold: _severity_threshold, lookback_hours: _lookback_hours, organization_id } = context;

    // Log the input parameters received
    console.log(`[Geopolitical Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for geopolitical monitoring');
    }

    console.log(`[Geopolitical Monitor] Monitoring ${locations.length} locations for organization: ${organization_id}`);

    // PLACEHOLDER: Actual GDELT API integration to be implemented
    // API Documentation: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
    //
    // Example GDELT Query for conflicts:
    // https://api.gdeltproject.org/api/v2/doc/doc?query=conflict%20war%20sourcecountry:SY&mode=artlist&maxrecords=250&format=json

    try {
      const conflictEvents: Array<z.infer<typeof ConflictEventSchema>> = [];
      const apiCallsMade = 0;
      const conflictCount = 0;
      const terroristAttackCount = 0;
      const highSeverityCount = 0;

      // TODO: Implement GDELT API integration
      // const events = await fetchGDELTConflictEvents(_locations, lookback_hours: _lookback_hours, severity_threshold);
      // apiCallsMade += locations.length;

      // PLACEHOLDER: Return empty array for now
      console.log(`[Geopolitical Monitor] Found ${conflictEvents.length} events (${conflictCount} conflicts, ${terroristAttackCount} terrorist attacks), made ${apiCallsMade} API calls`);

      return {
        conflict_events: conflictEvents,
        conflict_count: conflictCount,
        terrorist_attack_count: terroristAttackCount,
        high_severity_count: highSeverityCount,
        api_calls_made: apiCallsMade
      };

    } catch (error) {
      console.error(`[Geopolitical Monitor] Failed to fetch GDELT data:`, error);
      throw new Error(`Geopolitical monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Helper Functions (to be implemented with actual API integration)
// ============================================================================

/**
 * Fetch conflict events from GDELT API
 *
 * GDELT DOC 2.0 API provides real-time conflict detection from global news
 */
async function _fetchGDELTConflictEvents(
  _locations: Array<{ latitude: number; longitude: number; name: string; country_code?: string }>,
  _lookbackHours: number,
  _severityThreshold: string
): Promise<Array<z.infer<typeof ConflictEventSchema>>> {
  // TODO: Implement GDELT API calls for conflict events
  //
  // const events: z.infer<typeof ConflictEventSchema>[] = [];
  // const timespan = `${lookbackHours}h`;
  //
  // // Conflict-related search queries
  // const conflictQueries = [
  //   'war', 'conflict', 'attack', 'bombing', 'airstrike',
  //   'military', 'armed forces', 'terrorist', 'casualties',
  //   'border dispute', 'invasion', 'siege'
  // ];
  //
  // for (const location of locations) {
  //   for (const query of conflictQueries) {
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
  //     try {
  //       const response = await fetch(url.toString());
  //       const data = await response.json();
  //
  //       if (!data.articles) continue;
  //
  //       for (const article of data.articles) {
  //         // Extract conflict details
  //         const eventType = classifyConflictEventType(article.title, article.seendate);
  //
  //         // Calculate severity from tone and content
  //         const severity = calculateConflictSeverity(
  //           article.tone,
  //           eventType,
  //           article.title
  //         );
  //
  //         // Filter by severity threshold
  //         if (!meetsSeverityThreshold(_severity, _severityThreshold)) continue;
  //
  //         // Extract location details
  //         const eventLocation = extractConflictLocation(_article, _location);
  //
  //         // Extract actors (_countries, groups involved)
  //         const actors = extractActors(article.title);
  //
  //         events.push({
  //           event_id: `gdelt-${article.url}`,
  //           event_type: eventType,
  //           title: article.title,
  //           description: article.seendate || '',
  //           severity,
  //           location: eventLocation,
  //           actors,
  //           tone: article.tone,
  //           event_timestamp: new Date(article.seendate).toISOString(),
  //           source_url: article.url,
  //           raw_data: article
  //         });
  //       }
  //     } catch (_err) {
  //       console.error(`[Geopolitical Monitor] Error fetching GDELT data for ${query}:`, _err);
  //       continue;
  //     }
  //   }
  // }
  //
  // return events;

  return [];
}

/**
 * Classify conflict event type from GDELT data
 */
function _classifyConflictEventType(_title: string, _description: string): string {
  // TODO: Implement classification logic
  //
  // const text = (title + ' ' + description).toLowerCase();
  //
  // if (text.includes('war') || text.includes('armed conflict')) return 'armed_conflict';
  // if (text.includes('terrorist') || text.includes('terrorism')) return 'terrorist_attack';
  // if (text.includes('military') || text.includes('airstrike') || text.includes('bombing')) return 'military_action';
  // if (text.includes('border') && text.includes('dispute')) return 'border_dispute';
  // if (text.includes('tension') || text.includes('standoff')) return 'tension';
  // if (text.includes('threat') || text.includes('security')) return 'security_threat';

  return 'geopolitical_event';
}

/**
 * Calculate severity for conflict event
 */
function _calculateConflictSeverity(
  _tone: number | undefined,
  _eventType: string,
  _title: string
): number {
  // TODO: Implement severity calculation
  //
  // Base severity by event type
  let severity = 0.5;

  switch (_eventType) {
    case 'armed_conflict':
    case 'terrorist_attack':
      severity = 0.9;
      break;
    case 'military_action':
      severity = 0.8;
      break;
    case 'border_dispute':
      severity = 0.7;
      break;
    case 'tension':
      severity = 0.6;
      break;
    case 'security_threat':
      severity = 0.7;
      break;
    default:
      severity = 0.5;
  }

  // Adjust based on GDELT tone (more negative = higher severity)
  // if (tone !== undefined && tone < 0) {
  //   severity = Math.min(1.0, severity + Math.abs(_tone) / 20);
  // }

  // Increase severity if casualties mentioned
  // const text = title.toLowerCase();
  // if (text.includes('casualties') || text.includes('killed') || text.includes('deaths')) {
  //   severity = Math.min(1.0, severity + 0.1);
  // }

  return severity;
}

/**
 * Extract conflict location from GDELT article
 */
function _extractConflictLocation(_article: any, monitoredLocation: any): any {
  // TODO: Implement location extraction
  //
  // GDELT articles may include location data
  // Fall back to monitored location if specific location unavailable

  return {
    name: monitoredLocation.name,
    country: monitoredLocation.name,
    latitude: monitoredLocation.latitude,
    longitude: monitoredLocation.longitude
  };
}

/**
 * Extract actors (_countries, _groups) involved in conflict
 */
function _extractActors(_title: string): string[] {
  // TODO: Implement actor extraction
  //
  // Use NER (Named Entity Recognition) to extract:
  // - Country names
  // - Group names (e.g., "Hamas", "Taliban", "NATO")
  // - Leader names
  //
  // const actors: string[] = [];
  //
  // // Simple keyword extraction for now
  // const keywords = title.split(' ');
  // for (const word of keywords) {
  //   if (word.length > 4 && /^[A-Z]/.test(_word)) {
  //     actors.push(_word);
  //   }
  // }
  //
  // return actors.slice(0, 5); // Limit to top 5

  return [];
}

/**
 * Check if severity meets threshold
 */
function _meetsSeverityThreshold(severity: number, threshold: string): boolean {
  switch (threshold) {
    case 'high':
      return severity >= 0.7;
    case 'medium':
      return severity >= 0.5;
    case 'low':
      return severity >= 0.3;
    default:
      return true;
  }
}
