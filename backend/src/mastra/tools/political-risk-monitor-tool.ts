import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { limitEvents, getFilterSummary } from './output-limiter.js';
import { toolLoggers } from './tool-logger.js';

const logger = toolLoggers.politicalRisk;

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
 * - Government Changes (coups, elections, leadership transitions)
 * - Political Protests & Civil Unrest
 * - Policy Changes (trade, regulatory, sanctions)
 * - Political Violence & Instability
 *
 * Organization Isolation: Filters events based on organization's geographic exposure
 */

const LocationInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string(),
  country_code: z.string().length(2).nullable().optional()
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
    const { locations, severity_threshold, lookback_hours, organization_id } = context;

    logger.debug({ context }, 'Tool executed');

    if (!organization_id) {
      throw new Error('organization_id is required for political risk monitoring');
    }

    logger.info({ locationCount: locations.length, organization_id }, 'Monitoring locations');

    try {
      const severityThresholdValue = severity_threshold === 'low' ? 0.3 : severity_threshold === 'medium' ? 0.5 : 0.7;

      const { events, apiCallsMade } = await fetchGDELTPoliticalEvents(locations, lookback_hours);
      const filteredEvents = events.filter(e => e.severity >= severityThresholdValue);

      // Limit output to prevent context overflow
      const MAX_EVENTS = 10;
      const limitedEvents = limitEvents(filteredEvents, MAX_EVENTS);
      logger.info({ totalEvents: filteredEvents.length, returnedEvents: limitedEvents.length }, getFilterSummary(filteredEvents.length, limitedEvents.length, 'Political Risk Monitor'));

      return {
        political_events: limitedEvents,
        monitored_locations_count: locations.length,
        api_calls_made: apiCallsMade
      };

    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch GDELT data');
      throw new Error(`Political risk monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// GDELT API Integration
// ============================================================================

// Political event search terms for GDELT queries
// Reduced search terms for faster execution (was 8, now 3)
const POLITICAL_SEARCH_TERMS = [
  'protest government unrest',
  'sanctions trade policy',
  'coup political violence'
];

interface GDELTArticle {
  url: string;
  url_mobile: string;
  title: string;
  seendate: string;
  socialimage: string;
  domain: string;
  language: string;
  sourcecountry: string;
  tone?: number;
}

interface GDELTResponse {
  articles?: GDELTArticle[];
}

/**
 * Fetch political events from GDELT DOC 2.0 API
 * API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 */
async function fetchGDELTPoliticalEvents(
  locations: Array<{ latitude: number; longitude: number; name: string; country_code?: string | null }>,
  lookbackHours: number
): Promise<{ events: Array<z.infer<typeof PoliticalEventSchema>>; apiCallsMade: number }> {
  const events: Array<z.infer<typeof PoliticalEventSchema>> = [];
  const seenUrls = new Set<string>();
  let apiCallsMade = 0;

  // Get unique country codes from locations
  const countryCodes = new Set<string>();
  for (const loc of locations) {
    if (loc.country_code) {
      countryCodes.add(loc.country_code.toUpperCase());
    }
  }

  // If no country codes, use a broad search
  const searchCountries = countryCodes.size > 0 ? Array.from(countryCodes) : [''];

  for (const countryCode of searchCountries) {
    for (const searchTerm of POLITICAL_SEARCH_TERMS) {
      try {
        const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');

        // Build query with optional country filter
        const query = countryCode
          ? `${searchTerm} sourcecountry:${countryCode}`
          : searchTerm;

        url.searchParams.set('query', query);
        url.searchParams.set('mode', 'artlist');
        url.searchParams.set('timespan', `${Math.min(lookbackHours, 72)}h`); // GDELT limits to 72h
        url.searchParams.set('maxrecords', '50');
        url.searchParams.set('format', 'json');

        const response = await fetch(url.toString(), {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15000)
        });

        apiCallsMade++;

        if (!response.ok) {
          logger.warn({ status: response.status, query }, 'GDELT API error');
          continue;
        }

        // Safely parse JSON - GDELT can return text errors even with 200 status
        const responseText = await response.text();
        let data: GDELTResponse;
        try {
          data = JSON.parse(responseText) as GDELTResponse;
        } catch {
          logger.warn({ query }, 'GDELT invalid JSON response');
          continue;
        }

        if (!data.articles || !Array.isArray(data.articles)) {
          continue;
        }

        for (const article of data.articles) {
          // Skip duplicates
          if (seenUrls.has(article.url)) continue;
          seenUrls.add(article.url);

          const eventType = classifyPoliticalEventType(article.title, searchTerm);
          const severity = calculatePoliticalSeverity(article, eventType);
          const eventTimestamp = parseGDELTDate(article.seendate);

          // Find the closest monitored location for this event
          const location = findLocationForCountry(locations, article.sourcecountry);

          events.push({
            event_id: `gdelt-pol-${hashString(article.url)}`,
            event_type: eventType,
            title: article.title,
            description: `Political event detected from ${article.domain}: ${article.title}`,
            severity,
            location: {
              name: location?.name || article.sourcecountry || 'Unknown',
              country: article.sourcecountry || 'Unknown',
              latitude: location?.latitude || 0,
              longitude: location?.longitude || 0
            },
            event_timestamp: eventTimestamp,
            tone: article.tone,
            source_url: article.url,
            raw_data: { domain: article.domain, language: article.language }
          });
        }

        // Small delay to avoid rate limiting
        await sleep(100);

      } catch (err) {
        logger.error({ err }, 'Error fetching political events');
      }
    }
  }

  return { events, apiCallsMade };
}

/**
 * Classify political event type from article title and search term
 */
function classifyPoliticalEventType(title: string, searchTerm: string): string {
  const titleLower = title.toLowerCase();

  if (titleLower.includes('coup') || titleLower.includes('military takeover')) return 'coup';
  if (titleLower.includes('protest') || titleLower.includes('demonstration') || titleLower.includes('rally')) return 'protest';
  if (titleLower.includes('sanction') || titleLower.includes('trade war') || titleLower.includes('tariff')) return 'sanctions';
  if (titleLower.includes('election') || titleLower.includes('vote') || titleLower.includes('ballot')) return 'election';
  if (titleLower.includes('violence') || titleLower.includes('riot') || titleLower.includes('clash')) return 'violence';
  if (titleLower.includes('policy') || titleLower.includes('regulation') || titleLower.includes('law')) return 'policy_change';
  if (titleLower.includes('strike') || titleLower.includes('walkout')) return 'strike';
  if (titleLower.includes('unrest') || titleLower.includes('unrest')) return 'civil_unrest';

  // Fall back to search term classification
  if (searchTerm.includes('coup')) return 'coup';
  if (searchTerm.includes('protest')) return 'protest';
  if (searchTerm.includes('sanction')) return 'sanctions';
  if (searchTerm.includes('election')) return 'election';
  if (searchTerm.includes('violence')) return 'violence';
  if (searchTerm.includes('policy')) return 'policy_change';
  if (searchTerm.includes('strike')) return 'strike';

  return 'political_risk';
}

/**
 * Calculate severity for political events
 */
function calculatePoliticalSeverity(article: GDELTArticle, eventType: string): number {
  let baseSeverity = 0.5;

  // Adjust based on event type
  switch (eventType) {
    case 'coup': baseSeverity = 0.95; break;
    case 'violence': baseSeverity = 0.85; break;
    case 'sanctions': baseSeverity = 0.75; break;
    case 'civil_unrest': baseSeverity = 0.7; break;
    case 'protest': baseSeverity = 0.6; break;
    case 'strike': baseSeverity = 0.65; break;
    case 'election': baseSeverity = 0.5; break;
    case 'policy_change': baseSeverity = 0.55; break;
  }

  // Adjust based on tone (more negative = higher severity)
  if (article.tone !== undefined) {
    // Tone typically ranges from -10 to +10
    const toneAdjustment = Math.max(-0.2, Math.min(0.2, -article.tone / 50));
    baseSeverity += toneAdjustment;
  }

  return Math.max(0.1, Math.min(0.99, baseSeverity));
}

/**
 * Parse GDELT date format (YYYYMMDDHHMMSS) to ISO 8601
 */
function parseGDELTDate(seendate: string): string {
  try {
    // GDELT format: YYYYMMDDHHMMSS
    const year = seendate.substring(0, 4);
    const month = seendate.substring(4, 6);
    const day = seendate.substring(6, 8);
    const hour = seendate.substring(8, 10);
    const minute = seendate.substring(10, 12);
    const second = seendate.substring(12, 14);

    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Find the monitored location matching a country code
 */
function findLocationForCountry(
  locations: Array<{ latitude: number; longitude: number; name: string; country_code?: string | null }>,
  countryCode: string
): { latitude: number; longitude: number; name: string } | undefined {
  const normalizedCode = countryCode?.toUpperCase();
  return locations.find(loc => loc.country_code?.toUpperCase() === normalizedCode);
}

/**
 * Simple hash function for generating unique IDs
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).substring(0, 12);
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
