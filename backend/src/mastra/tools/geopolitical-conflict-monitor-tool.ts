import { createTool } from '@mastra/core/tools';
import { limitEvents, getFilterSummary } from './output-limiter.js';
import { toolLoggers } from './tool-logger.js';
import { z } from 'zod';

const logger = toolLoggers.geopoliticalConflict;

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
 * Organization Isolation: Filters events based on organization's geographic exposure
 */

const LocationInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string(),
  country_code: z.string().length(2).nullable().optional()
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
    const { locations, severity_threshold, lookback_hours, organization_id } = context;

    logger.debug({ context }, 'Tool executed with context');

    if (!organization_id) {
      throw new Error('organization_id is required for geopolitical monitoring');
    }

    logger.info({ locationCount: locations.length, organization_id }, 'Monitoring locations for organization');

    try {
      const severityThresholdValue = severity_threshold === 'low' ? 0.3 : severity_threshold === 'medium' ? 0.5 : 0.7;

      const { events, apiCallsMade } = await fetchGDELTConflictEvents(locations, lookback_hours);
      const filteredEvents = events.filter(e => e.severity >= severityThresholdValue);

      const conflictCount = filteredEvents.filter(e =>
        e.event_type === 'armed_conflict' || e.event_type === 'war'
      ).length;
      const terroristAttackCount = filteredEvents.filter(e =>
        e.event_type === 'terrorist_attack'
      ).length;
      const highSeverityCount = filteredEvents.filter(e => e.severity >= 0.7).length;

      // Limit output to prevent context overflow
      const MAX_EVENTS = 10;
      const limitedEvents = limitEvents(filteredEvents, MAX_EVENTS);
      logger.info({ total: filteredEvents.length, limited: limitedEvents.length }, getFilterSummary(filteredEvents.length, limitedEvents.length, 'Geopolitical Monitor'));

      return {
        conflict_events: limitedEvents,
        conflict_count: conflictCount,
        terrorist_attack_count: terroristAttackCount,
        high_severity_count: highSeverityCount,
        api_calls_made: apiCallsMade
      };

    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch GDELT data');
      throw new Error(`Geopolitical monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// GDELT API Integration for Conflicts
// ============================================================================

// Conflict-related search terms for GDELT queries
// Reduced search terms for faster execution (was 8, now 3)
const CONFLICT_SEARCH_TERMS = [
  'war conflict military',
  'terrorist attack bombing',
  'armed conflict casualties'
];

interface GDELTArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  language: string;
  sourcecountry: string;
  tone?: number;
}

interface GDELTResponse {
  articles?: GDELTArticle[];
}

/**
 * Fetch conflict events from GDELT DOC 2.0 API
 */
async function fetchGDELTConflictEvents(
  locations: Array<{ latitude: number; longitude: number; name: string; country_code?: string | null }>,
  lookbackHours: number
): Promise<{ events: Array<z.infer<typeof ConflictEventSchema>>; apiCallsMade: number }> {
  const events: Array<z.infer<typeof ConflictEventSchema>> = [];
  const seenUrls = new Set<string>();
  let apiCallsMade = 0;

  // Get unique country codes from locations
  const countryCodes = new Set<string>();
  for (const loc of locations) {
    if (loc.country_code) {
      countryCodes.add(loc.country_code.toUpperCase());
    }
  }

  const searchCountries = countryCodes.size > 0 ? Array.from(countryCodes) : [''];

  for (const countryCode of searchCountries) {
    for (const searchTerm of CONFLICT_SEARCH_TERMS) {
      try {
        const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');

        const query = countryCode
          ? `${searchTerm} sourcecountry:${countryCode}`
          : searchTerm;

        url.searchParams.set('query', query);
        url.searchParams.set('mode', 'artlist');
        url.searchParams.set('timespan', `${Math.min(lookbackHours, 72)}h`);
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
          logger.warn({ query }, 'Invalid JSON response from GDELT');
          continue;
        }

        if (!data.articles || !Array.isArray(data.articles)) {
          continue;
        }

        for (const article of data.articles) {
          if (seenUrls.has(article.url)) continue;
          seenUrls.add(article.url);

          const eventType = classifyConflictEventType(article.title, searchTerm);
          const severity = calculateConflictSeverity(article, eventType);
          const eventTimestamp = parseGDELTDate(article.seendate);
          const actors = extractActors(article.title);

          const location = findLocationForCountry(locations, article.sourcecountry);

          events.push({
            event_id: `gdelt-conf-${hashString(article.url)}`,
            event_type: eventType,
            title: article.title,
            description: `Conflict event detected from ${article.domain}: ${article.title}`,
            severity,
            location: {
              name: location?.name || article.sourcecountry || 'Unknown',
              country: article.sourcecountry || 'Unknown',
              latitude: location?.latitude || 0,
              longitude: location?.longitude || 0
            },
            actors: actors.length > 0 ? actors : undefined,
            tone: article.tone,
            event_timestamp: eventTimestamp,
            source_url: article.url,
            raw_data: { domain: article.domain, language: article.language }
          });
        }

        await sleep(100);

      } catch (err) {
        logger.error({ err }, 'Error fetching GDELT conflict events');
      }
    }
  }

  return { events, apiCallsMade };
}

/**
 * Classify conflict event type from article title
 */
function classifyConflictEventType(title: string, searchTerm: string): string {
  const titleLower = title.toLowerCase();

  if (titleLower.includes('terrorist') || titleLower.includes('terrorism') || titleLower.includes('isis') || titleLower.includes('al-qaeda')) {
    return 'terrorist_attack';
  }
  if (titleLower.includes('war') || titleLower.includes('armed conflict') || titleLower.includes('invasion')) {
    return 'armed_conflict';
  }
  if (titleLower.includes('airstrike') || titleLower.includes('bombing') || titleLower.includes('missile')) {
    return 'military_action';
  }
  if (titleLower.includes('border') && (titleLower.includes('dispute') || titleLower.includes('clash'))) {
    return 'border_dispute';
  }
  if (titleLower.includes('tension') || titleLower.includes('standoff') || titleLower.includes('escalation')) {
    return 'tension';
  }
  if (titleLower.includes('threat') || titleLower.includes('security alert')) {
    return 'security_threat';
  }

  // Fall back to search term
  if (searchTerm.includes('terrorist')) return 'terrorist_attack';
  if (searchTerm.includes('war') || searchTerm.includes('conflict')) return 'armed_conflict';
  if (searchTerm.includes('military') || searchTerm.includes('airstrike')) return 'military_action';
  if (searchTerm.includes('border')) return 'border_dispute';

  return 'geopolitical_event';
}

/**
 * Calculate severity for conflict events
 */
function calculateConflictSeverity(article: GDELTArticle, eventType: string): number {
  let baseSeverity = 0.6;

  switch (eventType) {
    case 'terrorist_attack': baseSeverity = 0.95; break;
    case 'armed_conflict': baseSeverity = 0.9; break;
    case 'military_action': baseSeverity = 0.85; break;
    case 'border_dispute': baseSeverity = 0.7; break;
    case 'tension': baseSeverity = 0.6; break;
    case 'security_threat': baseSeverity = 0.65; break;
  }

  // Adjust based on tone
  if (article.tone !== undefined && article.tone < 0) {
    const toneAdjustment = Math.min(0.1, Math.abs(article.tone) / 100);
    baseSeverity += toneAdjustment;
  }

  // Increase severity for casualties
  const titleLower = article.title.toLowerCase();
  if (titleLower.includes('killed') || titleLower.includes('deaths') || titleLower.includes('casualties')) {
    baseSeverity = Math.min(0.99, baseSeverity + 0.05);
  }

  return Math.max(0.1, Math.min(0.99, baseSeverity));
}

/**
 * Extract actors (countries, groups) from title
 */
function extractActors(title: string): string[] {
  const actors: string[] = [];

  // Common actor patterns
  const actorPatterns = [
    /\b(Russia|Ukraine|China|Iran|Israel|Hamas|Hezbollah|NATO|US|USA|United States)\b/gi,
    /\b(Taliban|ISIS|Al-Qaeda|IDF|military)\b/gi
  ];

  for (const pattern of actorPatterns) {
    const matches = title.match(pattern);
    if (matches) {
      for (const match of matches) {
        if (!actors.includes(match)) {
          actors.push(match);
        }
      }
    }
  }

  return actors.slice(0, 5);
}

/**
 * Parse GDELT date format (YYYYMMDDHHMMSS) to ISO 8601
 */
function parseGDELTDate(seendate: string): string {
  try {
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

function findLocationForCountry(
  locations: Array<{ latitude: number; longitude: number; name: string; country_code?: string | null }>,
  countryCode: string
): { latitude: number; longitude: number; name: string } | undefined {
  const normalizedCode = countryCode?.toUpperCase();
  return locations.find(loc => loc.country_code?.toUpperCase() === normalizedCode);
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).substring(0, 12);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
