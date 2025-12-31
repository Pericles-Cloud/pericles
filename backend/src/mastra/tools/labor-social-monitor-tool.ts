import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Labor & Social Monitor Tool
 *
 * Purpose: Monitor labor strikes, protests, and social unrest affecting supply chains.
 *
 * Data Sources:
 * - RSS Feeds from labor and social news:
 *   - ILO News: https://www.ilo.org/rss
 *   - Labor Notes: https://labornotes.org/
 *   - IndustriALL Global Union: https://www.industriall-union.org/
 *
 * Risk Categories:
 * - Labor Strikes & Work Stoppages
 * - Union Negotiations & Contract Disputes
 * - Protests & Civil Unrest
 * - Worker Safety Incidents
 * - Labor Shortages
 * - Wage Disputes
 *
 * Organization Isolation: Filters based on organization's supplier locations and industries
 */

const LocationInputSchema = z.object({
  country_code: z.string().length(2),
  country_name: z.string(),
  city: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
});

const IndustryInputSchema = z.object({
  industry_code: z.string().optional(),
  industry_name: z.string()
});

const LaborEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // strike, protest, negotiation, safety_incident, shortage, wage_dispute
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1),
  location: z.object({
    country: z.string(),
    country_code: z.string().optional(),
    city: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional()
  }),
  industry: z.string().optional(),
  company: z.string().optional(),
  workers_affected: z.number().int().optional(),
  duration_days: z.number().optional(),
  event_timestamp: z.string().datetime(),
  source: z.string(),
  source_url: z.string().url().optional(),
  raw_data: z.record(z.string(), z.any()).optional()
});

export const laborSocialMonitorTool = createTool({
  id: 'labor-social-monitor',
  description: 'Monitor labor strikes, protests, union negotiations, worker safety incidents, and social unrest affecting supply chains using RSS feeds from ILO, Labor Notes, and IndustriALL.',

  inputSchema: z.object({
    locations: z.array(LocationInputSchema).optional().describe('Locations to monitor for labor events'),
    industries: z.array(IndustryInputSchema).optional().describe('Industries to monitor'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_hours: z.number().int().min(1).max(168).default(24).describe('How many hours back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    labor_events: z.array(LaborEventSchema).describe('Detected labor and social events'),
    strike_count: z.number().int().describe('Number of strikes detected'),
    protest_count: z.number().int().describe('Number of protests detected'),
    high_severity_count: z.number().int().describe('Number of high severity events'),
    feeds_checked: z.number().int().describe('Number of RSS feeds checked')
  }),

  execute: async ({ context }) => {
    const { locations: _locations, industries: _industries, severity_threshold: _severity_threshold, lookback_hours: _lookback_hours, organization_id } = context;

    // Log the input parameters received
    console.log(`[Labor Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for labor monitoring');
    }

    console.log(`[Labor Monitor] Monitoring for organization: ${organization_id}`);

    // PLACEHOLDER: Actual RSS feed parsing to be implemented
    // RSS Feeds:
    // - ILO: https://www.ilo.org/rss
    // - Labor Notes: https://labornotes.org/feed
    // - IndustriALL: https://www.industriall-union.org/rss.xml

    try {
      const laborEvents: Array<z.infer<typeof LaborEventSchema>> = [];
      const feedsChecked = 0;
      const strikeCount = 0;
      const protestCount = 0;
      const highSeverityCount = 0;

      // TODO: Implement RSS feed parsing
      // const events = await fetchLaborRSSFeeds(_locations, industries, lookback_hours);
      // feedsChecked = LABOR_RSS_FEEDS.length;

      // PLACEHOLDER: Return empty array for now
      console.log(`[Labor Monitor] Found ${laborEvents.length} events (${strikeCount} strikes, ${protestCount} protests), checked ${feedsChecked} feeds`);

      return {
        labor_events: laborEvents,
        strike_count: strikeCount,
        protest_count: protestCount,
        high_severity_count: highSeverityCount,
        feeds_checked: feedsChecked
      };

    } catch (error) {
      console.error(`[Labor Monitor] Failed to fetch labor data:`, error);
      throw new Error(`Labor monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Helper Functions (to be implemented with actual RSS feed parsing)
// ============================================================================

/**
 * Labor & social RSS feeds to monitor
 */
const _LABOR_RSS_FEEDS = [
  {
    name: 'ILO News',
    url: 'https://www.ilo.org/rss',
    priority: 'high'
  },
  {
    name: 'Labor Notes',
    url: 'https://labornotes.org/feed',
    priority: 'medium'
  },
  {
    name: 'IndustriALL Global Union',
    url: 'https://www.industriall-union.org/rss.xml',
    priority: 'high'
  }
];

/**
 * Fetch and parse labor RSS feeds
 */
async function _fetchLaborRSSFeeds(
  _locations: Array<{ country_code: string; country_name: string }> | undefined,
  _industries: Array<{ industry_name: string }> | undefined,
  _lookbackHours: number
): Promise<Array<z.infer<typeof LaborEventSchema>>> {
  // TODO: Implement RSS feed parsing
  //
  // const events: z.infer<typeof LaborEventSchema>[] = [];
  // const cutoffDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  //
  // for (const feed of LABOR_RSS_FEEDS) {
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
  //       // Filter by relevance to monitored locations/industries
  //       const isRelevant = checkLaborRelevance(_title, description, locations, _industries);
  //       if (!isRelevant) continue;
  //
  //       // Classify event type
  //       const eventType = classifyLaborEventType(_title, _description);
  //
  //       // Extract location information
  //       const location = extractLaborLocation(_title, description, _locations);
  //
  //       // Extract impact metrics
  //       const workersAffected = extractWorkerCount(_title, _description);
  //
  //       // Calculate severity
  //       const severity = calculateLaborSeverity(_eventType, workersAffected, title, _description);
  //
  //       events.push({
  //         event_id: `labor-${feed.name}-${pubDate.getTime()}`,
  //         event_type: eventType,
  //         title,
  //         description,
  //         severity,
  //         location,
  //         workers_affected: workersAffected,
  //         event_timestamp: pubDate.toISOString(),
  //         source: feed.name,
  //         source_url: link
  //       });
  //     }
  //   } catch (_err) {
  //     console.error(`[Labor Monitor] Error fetching ${feed.name}:`, _err);
  //     continue;
  //   }
  // }
  //
  // return events;

  return [];
}

/**
 * Check if labor news is relevant to monitored locations/industries
 */
function _checkLaborRelevance(
  _title: string,
  _description: string,
  _locations: any,
  _industries: any
): boolean {
  // TODO: Implement relevance checking
  //
  // const text = (title + ' ' + description).toLowerCase();
  //
  // // Check if any monitored locations are mentioned
  // if (_locations) {
  //   for (const location of locations) {
  //     if (text.includes(location.country_name.toLowerCase()) ||
  //         (location.city && text.includes(location.city.toLowerCase()))) {
  //       return true;
  //     }
  //   }
  // }
  //
  // // Check if any monitored industries are mentioned
  // if (_industries) {
  //   for (const industry of industries) {
  //     if (text.includes(industry.industry_name.toLowerCase())) {
  //       return true;
  //     }
  //   }
  // }
  //
  // // Check for labor disruption keywords
  // const laborKeywords = [
  //   'strike', 'walkout', 'protest', 'demonstration', 'union',
  //   'shutdown', 'stoppage', 'labor shortage', 'wage dispute'
  // ];
  //
  // for (const keyword of laborKeywords) {
  //   if (text.includes(_keyword)) return true;
  // }

  return false;
}

/**
 * Classify labor event type from article content
 */
function _classifyLaborEventType(_title: string, _description: string): string {
  // TODO: Implement classification
  //
  // const text = (title + ' ' + description).toLowerCase();
  //
  // if (text.includes('strike') || text.includes('walkout')) return 'strike';
  // if (text.includes('protest') || text.includes('demonstration')) return 'protest';
  // if (text.includes('negotiation') || text.includes('contract')) return 'negotiation';
  // if (text.includes('accident') || text.includes('safety')) return 'safety_incident';
  // if (text.includes('shortage') || text.includes('lack of workers')) return 'shortage';
  // if (text.includes('wage') || text.includes('pay')) return 'wage_dispute';

  return 'labor_event';
}

/**
 * Extract location information from labor article
 */
function _extractLaborLocation(_title: string, _description: string, _locations: any): any {
  // TODO: Implement location extraction
  //
  // Try to match known locations from the locations list
  // Use NER (Named Entity Recognition) for location extraction

  return {
    country: 'Unknown'
  };
}

/**
 * Extract number of affected workers from article text
 */
function _extractWorkerCount(_title: string, _description: string): number | undefined {
  // TODO: Implement worker count extraction
  //
  // Look for patterns like:
  // - "1,000 workers"
  // - "thousands of employees"
  // - "10,000+ staff"
  //
  // const text = title + ' ' + description;
  // const match = text.match(/(\d+[\d,]*)\s+(workers|employees|staff)/i);
  // if (_match) {
  //   return parseInt(match[1].replace(/,/g, ''));
  // }

  return undefined;
}

/**
 * Calculate severity for labor event
 */
function _calculateLaborSeverity(
  _eventType: string,
  _workersAffected: number | undefined,
  _title: string,
  _description: string
): number {
  // TODO: Implement severity calculation
  //
  // Base severity by event type
  let severity = 0.5;

  switch (_eventType) {
    case 'strike':
      severity = 0.7;
      break;
    case 'protest':
      severity = 0.6;
      break;
    case 'safety_incident':
      severity = 0.8;
      break;
    case 'shortage':
      severity = 0.6;
      break;
    default:
      severity = 0.5;
  }

  // Increase severity based on scale
  // if (_workersAffected) {
  //   if (workersAffected > 10000) severity = Math.min(1.0, severity + 0.2);
  //   else if (workersAffected > 1000) severity = Math.min(1.0, severity + 0.1);
  // }

  return severity;
}
