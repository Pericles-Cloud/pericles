import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Pandemic & Health Monitor Tool
 *
 * Purpose: Monitor disease outbreaks, pandemics, and public health emergencies affecting workforce and operations.
 *
 * Data Sources:
 * - WHO (World Health Organization) RSS feeds
 *   Feed: https://www.who.int/rss-feeds
 * - CDC (Centers for Disease Control) RSS feeds
 *   Feed: https://tools.cdc.gov/podcasts/rss.asp
 *
 * Risk Categories:
 * - Disease Outbreaks
 * - Pandemic Declarations
 * - Travel Restrictions (health-related)
 * - Quarantine Requirements
 * - Workplace Safety Mandates
 * - Supply Chain Health Impacts
 *
 * Organization Isolation: Filters based on organization's operating locations and workforce distribution
 */

const LocationInputSchema = z.object({
  country_code: z.string().length(2),
  country_name: z.string(),
  city: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
});

const HealthEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // outbreak, pandemic, travel_restriction, quarantine, mandate, health_emergency
  disease: z.string().optional().describe('Disease name (e.g., COVID-19, Ebola, H5N1)'),
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1),
  location: z.object({
    country: z.string(),
    country_code: z.string().optional(),
    region: z.string().optional(),
    city: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional()
  }),
  cases_count: z.number().int().optional().describe('Number of reported cases'),
  deaths_count: z.number().int().optional(),
  alert_level: z.string().optional().describe('WHO alert level or CDC level'),
  travel_advisory: z.boolean().optional(),
  event_timestamp: z.string().datetime(),
  source: z.string(),
  source_url: z.string().url().optional(),
  raw_data: z.record(z.string(), z.any()).optional()
});

export const pandemicHealthMonitorTool = createTool({
  id: 'pandemic-health-monitor',
  description: 'Monitor disease outbreaks, pandemics, public health emergencies, travel restrictions, and health-related supply chain impacts using WHO and CDC RSS feeds.',

  inputSchema: z.object({
    locations: z.array(LocationInputSchema).min(1).describe('Locations to monitor for health events'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_hours: z.number().int().min(1).max(168).default(24).describe('How many hours back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    health_events: z.array(HealthEventSchema).describe('Detected health and pandemic events'),
    outbreak_count: z.number().int().describe('Number of disease outbreaks detected'),
    travel_restriction_count: z.number().int().describe('Number of travel restrictions'),
    high_severity_count: z.number().int().describe('Number of high severity events'),
    feeds_checked: z.number().int().describe('Number of RSS feeds checked')
  }),

  execute: async ({ context }) => {
    const { locations, severity_threshold: _severity_threshold, lookback_hours: _lookback_hours, organization_id } = context;

    // Log the input parameters received
    console.log(`[Health Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for health monitoring');
    }

    console.log(`[Health Monitor] Monitoring ${locations.length} locations for organization: ${organization_id}`);

    // PLACEHOLDER: Actual RSS feed parsing to be implemented
    // RSS Feeds:
    // - WHO: https://www.who.int/rss-feeds
    // - CDC: https://tools.cdc.gov/podcasts/rss.asp

    try {
      const healthEvents: Array<z.infer<typeof HealthEventSchema>> = [];
      const feedsChecked = 0;
      const outbreakCount = 0;
      const travelRestrictionCount = 0;
      const highSeverityCount = 0;

      // TODO: Implement WHO RSS feed parsing
      // const whoEvents = await fetchWHORSSFeeds(_locations, lookback_hours);
      // feedsChecked += 1;

      // TODO: Implement CDC RSS feed parsing
      // const cdcEvents = await fetchCDCRSSFeeds(_locations, lookback_hours);
      // feedsChecked += 1;

      // PLACEHOLDER: Return empty array for now
      console.log(`[Health Monitor] Found ${healthEvents.length} events (${outbreakCount} outbreaks, ${travelRestrictionCount} travel restrictions), checked ${feedsChecked} feeds`);

      return {
        health_events: healthEvents,
        outbreak_count: outbreakCount,
        travel_restriction_count: travelRestrictionCount,
        high_severity_count: highSeverityCount,
        feeds_checked: feedsChecked
      };

    } catch (error) {
      console.error(`[Health Monitor] Failed to fetch health data:`, error);
      throw new Error(`Health monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Helper Functions (to be implemented with actual RSS feed parsing)
// ============================================================================

/**
 * Health & pandemic RSS feeds to monitor
 */
const _HEALTH_RSS_FEEDS = [
  {
    name: 'WHO Disease Outbreak News',
    url: 'https://www.who.int/feeds/entity/csr/don/en/rss.xml',
    priority: 'high'
  },
  {
    name: 'WHO News',
    url: 'https://www.who.int/rss-feeds/news-english.xml',
    priority: 'medium'
  },
  {
    name: 'CDC Health Alert Network',
    url: 'https://tools.cdc.gov/podcasts/feed.asp?feedid=183',
    priority: 'high'
  },
  {
    name: 'CDC Travelers Health',
    url: 'https://wwwnc.cdc.gov/travel/notices/rss.xml',
    priority: 'medium'
  }
];

/**
 * Fetch and parse WHO RSS feeds
 */
async function _fetchWHORSSFeeds(
  _locations: Array<{ country_code: string; country_name: string }>,
  _lookbackHours: number
): Promise<Array<z.infer<typeof HealthEventSchema>>> {
  // TODO: Implement WHO RSS feed parsing
  //
  // const events: z.infer<typeof HealthEventSchema>[] = [];
  // const cutoffDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  //
  // for (const feed of HEALTH_RSS_FEEDS.filter(f => f.name.startsWith('WHO'))) {
  //   try {
  //     const response = await fetch(feed.url);
  //     const xmlText = await response.text();
  //
  //     // Parse XML RSS feed
  //     const parser = new DOMParser(); // or use xml2js library
  //     const xml = parser.parseFromString(_xmlText, 'text/xml');
  //
  //     const items = xml.querySelectorAll('item');
  //
  //     for (const item of items) {
  //       const pubDate = new Date(item.querySelector('pubDate')?.textContent || '');
  //       if (pubDate < cutoffDate) continue;
  //
  //       const title = item.querySelector('title')?.textContent || '';
  //       const description = item.querySelector('description')?.textContent || '';
  //       const link = item.querySelector('link')?.textContent || '';
  //
  //       // Filter by relevance to monitored locations
  //       const relevantLocation = extractHealthLocation(_title, description, _locations);
  //       if (!relevantLocation) continue;
  //
  //       // Extract disease name
  //       const disease = extractDiseaseName(_title, _description);
  //
  //       // Classify event type
  //       const eventType = classifyHealthEventType(_title, _description);
  //
  //       // Extract case counts
  //       const { cases, deaths } = extractCaseCounts(_description);
  //
  //       // Calculate severity
  //       const severity = calculateHealthSeverity(_eventType, cases, deaths, title, _description);
  //
  //       events.push({
  //         event_id: `who-${pubDate.getTime()}`,
  //         event_type: eventType,
  //         disease,
  //         title,
  //         description,
  //         severity,
  //         location: relevantLocation,
  //         cases_count: cases,
  //         deaths_count: deaths,
  //         event_timestamp: pubDate.toISOString(),
  //         source: 'WHO',
  //         source_url: link
  //       });
  //     }
  //   } catch (_err) {
  //     console.error(`[Health Monitor] Error fetching ${feed.name}:`, _err);
  //     continue;
  //   }
  // }
  //
  // return events;

  return [];
}

/**
 * Fetch and parse CDC RSS feeds
 */
async function _fetchCDCRSSFeeds(
  _locations: Array<{ country_code: string; country_name: string }>,
  _lookbackHours: number
): Promise<Array<z.infer<typeof HealthEventSchema>>> {
  // TODO: Implement CDC RSS feed parsing
  //
  // Similar to WHO feed parsing
  // Focus on CDC alerts, travel health notices

  return [];
}

/**
 * Extract health event location from article text
 */
function _extractHealthLocation(
  _title: string,
  _description: string,
  _monitoredLocations: Array<{ country_code: string; country_name: string }>
): any {
  // TODO: Implement location extraction
  //
  // const text = (title + ' ' + description).toLowerCase();
  //
  // for (const location of monitoredLocations) {
  //   if (text.includes(location.country_name.toLowerCase())) {
  //     return {
  //       country: location.country_name,
  //       country_code: location.country_code
  //     };
  //   }
  // }
  //
  // // Check for health event keywords even if location not explicitly monitored
  // const highPriorityKeywords = ['pandemic', 'outbreak', 'emergency'];
  // for (const keyword of highPriorityKeywords) {
  //   if (text.includes(_keyword)) {
  //     // Extract location using NER
  //     return extractLocationFromText(_text);
  //   }
  // }

  return null;
}

/**
 * Extract disease name from article text
 */
function _extractDiseaseName(_title: string, _description: string): string | undefined {
  // TODO: Implement disease name extraction
  //
  // const text = title + ' ' + description;
  //
  // // Known diseases
  // const diseases = [
  //   'COVID-19', 'Ebola', 'H5N1', 'H1N1', 'MERS', 'SARS', 'Zika',
  //   'Dengue', 'Malaria', 'Cholera', 'Mpox', 'Monkeypox', 'Measles',
  //   'Influenza', 'Tuberculosis', 'Polio', 'Yellow Fever'
  // ];
  //
  // for (const disease of diseases) {
  //   if (text.toLowerCase().includes(disease.toLowerCase())) {
  //     return disease;
  //   }
  // }

  return undefined;
}

/**
 * Classify health event type
 */
function _classifyHealthEventType(_title: string, _description: string): string {
  // TODO: Implement classification
  //
  // const text = (title + ' ' + description).toLowerCase();
  //
  // if (text.includes('outbreak') || text.includes('cases')) return 'outbreak';
  // if (text.includes('pandemic') || text.includes('global')) return 'pandemic';
  // if (text.includes('travel') && (text.includes('restriction') || text.includes('ban'))) return 'travel_restriction';
  // if (text.includes('quarantine') || text.includes('isolation')) return 'quarantine';
  // if (text.includes('mandate') || text.includes('requirement')) return 'mandate';
  // if (text.includes('emergency') || text.includes('alert')) return 'health_emergency';

  return 'health_event';
}

/**
 * Extract case and death counts from text
 */
function _extractCaseCounts(_text: string): { cases?: number; deaths?: number } {
  // TODO: Implement count extraction
  //
  // Look for patterns like:
  // - "100 cases"
  // - "50 confirmed cases"
  // - "10 deaths"
  //
  // const casesMatch = text.match(/(\d+[\d,]*)\s+(cases|confirmed)/i);
  // const deathsMatch = text.match(/(\d+[\d,]*)\s+deaths?/i);
  //
  // return {
  //   cases: casesMatch ? parseInt(casesMatch[1].replace(/,/g, '')) : undefined,
  //   deaths: deathsMatch ? parseInt(deathsMatch[1].replace(/,/g, '')) : undefined
  // };

  return {};
}

/**
 * Calculate severity for health event
 */
function _calculateHealthSeverity(
  _eventType: string,
  _cases: number | undefined,
  _deaths: number | undefined,
  _title: string,
  _description: string
): number {
  // TODO: Implement severity calculation
  //
  // Base severity by event type
  let severity = 0.5;

  switch (_eventType) {
    case 'pandemic':
      severity = 1.0;
      break;
    case 'health_emergency':
      severity = 0.9;
      break;
    case 'outbreak':
      severity = 0.7;
      break;
    case 'travel_restriction':
      severity = 0.6;
      break;
    case 'quarantine':
      severity = 0.7;
      break;
    case 'mandate':
      severity = 0.5;
      break;
    default:
      severity = 0.4;
  }

  // Increase severity based on case/death counts
  // if (_cases) {
  //   if (cases > 10000) severity = Math.min(1.0, severity + 0.2);
  //   else if (cases > 1000) severity = Math.min(1.0, severity + 0.1);
  // }
  //
  // if (_deaths) {
  //   if (deaths > 100) severity = Math.min(1.0, severity + 0.2);
  //   else if (deaths > 10) severity = Math.min(1.0, severity + 0.1);
  // }

  return severity;
}
