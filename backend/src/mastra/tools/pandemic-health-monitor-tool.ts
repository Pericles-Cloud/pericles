import { createTool } from '@mastra/core/tools';
import { limitEvents, getFilterSummary } from './output-limiter';
import { z } from 'zod';
import { toolLoggers } from './tool-logger';

const logger = toolLoggers.pandemicHealth;

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
    const { locations, severity_threshold, lookback_hours, organization_id } = context;

    logger.debug({ context }, 'Tool executed');

    if (!organization_id) {
      throw new Error('organization_id is required for health monitoring');
    }

    logger.info({ locationCount: locations.length, organizationId: organization_id }, 'Monitoring locations');

    try {
      const severityThresholdValue = severity_threshold === 'low' ? 0.3 : severity_threshold === 'medium' ? 0.5 : 0.7;

      // Fetch from all health RSS feeds
      const { events, feedsChecked } = await fetchHealthRSSFeeds(locations, lookback_hours);

      // Filter by severity threshold
      const filteredEvents = events.filter(e => e.severity >= severityThresholdValue);

      const outbreakCount = filteredEvents.filter(e =>
        e.event_type === 'outbreak' || e.event_type === 'pandemic'
      ).length;
      const travelRestrictionCount = filteredEvents.filter(e =>
        e.event_type === 'travel_restriction' || e.travel_advisory
      ).length;
      const highSeverityCount = filteredEvents.filter(e => e.severity >= 0.7).length;

      // Limit output to prevent context overflow
      const MAX_EVENTS = 10;
      const limitedEvents = limitEvents(filteredEvents, MAX_EVENTS);
      logger.info({ total: filteredEvents.length, limited: limitedEvents.length }, getFilterSummary(filteredEvents.length, limitedEvents.length, 'Health Monitor'));

      return {
        health_events: limitedEvents,
        outbreak_count: outbreakCount,
        travel_restriction_count: travelRestrictionCount,
        high_severity_count: highSeverityCount,
        feeds_checked: feedsChecked
      };

    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch health data');
      throw new Error(`Health monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// RSS Feed Integration
// ============================================================================

/**
 * Health & pandemic RSS feeds to monitor
 */
const HEALTH_RSS_FEEDS = [
  {
    name: 'WHO Disease Outbreak News',
    url: 'https://www.who.int/feeds/entity/csr/don/en/rss.xml',
    source: 'WHO',
    priority: 'high'
  },
  {
    name: 'WHO News',
    url: 'https://www.who.int/rss-feeds/news-english.xml',
    source: 'WHO',
    priority: 'medium'
  },
  {
    name: 'CDC Health Alert Network',
    url: 'https://tools.cdc.gov/api/v2/resources/media/316422.rss',
    source: 'CDC',
    priority: 'high'
  },
  {
    name: 'CDC Travelers Health',
    url: 'https://wwwnc.cdc.gov/travel/notices.rss',
    source: 'CDC',
    priority: 'medium'
  },
  {
    name: 'CDC Outbreak Investigations',
    url: 'https://tools.cdc.gov/api/v2/resources/media/285676.rss',
    source: 'CDC',
    priority: 'high'
  }
];

/**
 * Known diseases for detection
 */
const KNOWN_DISEASES = [
  'COVID-19', 'SARS-CoV-2', 'Coronavirus',
  'Ebola', 'Marburg',
  'H5N1', 'H1N1', 'H7N9', 'Avian Flu', 'Bird Flu', 'Influenza',
  'MERS', 'SARS',
  'Zika', 'Dengue', 'Chikungunya',
  'Malaria', 'Cholera', 'Typhoid',
  'Mpox', 'Monkeypox',
  'Measles', 'Polio',
  'Yellow Fever', 'Lassa Fever',
  'Tuberculosis', 'TB',
  'Plague', 'Anthrax',
  'Nipah', 'Hendra',
  'Meningitis', 'Hepatitis'
];

interface RSSItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  category?: string;
}

/**
 * Fetch and parse all health RSS feeds
 */
async function fetchHealthRSSFeeds(
  locations: Array<{ country_code: string; country_name: string; city?: string }>,
  lookbackHours: number
): Promise<{ events: Array<z.infer<typeof HealthEventSchema>>; feedsChecked: number }> {
  const events: Array<z.infer<typeof HealthEventSchema>> = [];
  const seenUrls = new Set<string>();
  let feedsChecked = 0;

  const cutoffDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const _monitoredCountries = new Set(locations.map(l => l.country_name.toLowerCase()));
  const _monitoredCountryCodes = new Set(locations.map(l => l.country_code.toUpperCase()));

  for (const feed of HEALTH_RSS_FEEDS) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          'Accept': 'application/rss+xml, application/xml, text/xml',
          'User-Agent': 'Pericles-SupplyChainMonitor/1.0'
        },
        signal: AbortSignal.timeout(15000)
      });

      feedsChecked++;

      if (!response.ok) {
        logger.warn({ status: response.status, feedName: feed.name }, 'Feed error');
        continue;
      }

      const xmlText = await response.text();
      const items = parseRSSItems(xmlText);

      logger.debug({ itemCount: items.length, feedName: feed.name }, 'Parsed items from feed');

      for (const item of items) {
        // Skip duplicates
        if (item.link && seenUrls.has(item.link)) continue;
        if (item.link) seenUrls.add(item.link);

        // Parse publication date
        const pubDate = new Date(item.pubDate);
        if (isNaN(pubDate.getTime()) || pubDate < cutoffDate) continue;

        // Check location relevance
        const location = extractHealthLocation(item.title, item.description, locations);

        // For WHO/CDC global alerts, include even if location not specifically monitored
        const isGlobalAlert = isGlobalHealthAlert(item.title, item.description);

        if (!location && !isGlobalAlert) continue;

        // Extract disease name
        const disease = extractDiseaseName(item.title, item.description);

        // Classify event type
        const eventType = classifyHealthEventType(item.title, item.description);

        // Extract case counts
        const { cases, deaths } = extractCaseCounts(`${item.title  } ${  item.description}`);

        // Check for travel advisory
        const isTravelAdvisory = isTravelRelated(item.title, item.description);

        // Calculate severity
        const severity = calculateHealthSeverity(eventType, cases, deaths, item.title, item.description, disease);

        // Determine alert level
        const alertLevel = extractAlertLevel(item.title, item.description);

        events.push({
          event_id: `health-${feed.source.toLowerCase()}-${hashString(item.link || item.title)}`,
          event_type: eventType,
          disease,
          title: item.title,
          description: item.description.substring(0, 1000),
          severity,
          location: location || {
            country: 'Global',
            region: 'Worldwide'
          },
          cases_count: cases,
          deaths_count: deaths,
          alert_level: alertLevel,
          travel_advisory: isTravelAdvisory,
          event_timestamp: pubDate.toISOString(),
          source: feed.source,
          source_url: item.link,
          raw_data: { feed_name: feed.name, category: item.category }
        });
      }

      // Rate limiting between feeds
      await sleep(300);

    } catch (err) {
      logger.error({ err, feedName: feed.name }, 'Error fetching feed');
    }
  }

  return { events, feedsChecked };
}

function parseRSSItems(xmlText: string): RSSItem[] {
  const items: RSSItem[] = [];

  // Simple regex-based XML parsing for RSS items
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];

    const title = extractXMLTag(itemContent, 'title');
    const description = extractXMLTag(itemContent, 'description');
    const link = extractXMLTag(itemContent, 'link');
    const pubDate = extractXMLTag(itemContent, 'pubDate');
    const category = extractXMLTag(itemContent, 'category');

    if (title && pubDate) {
      items.push({
        title: decodeHTMLEntities(title),
        description: decodeHTMLEntities(description || ''),
        link: link || '',
        pubDate,
        category: category || undefined
      });
    }
  }

  return items;
}

function extractXMLTag(content: string, tag: string): string | null {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const cdataMatch = content.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular tags
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ''); // Strip HTML tags
}

/**
 * Extract health event location from article text
 */
function extractHealthLocation(
  title: string,
  description: string,
  monitoredLocations: Array<{ country_code: string; country_name: string; city?: string }>
): { country: string; country_code?: string; region?: string; city?: string } | null {
  const text = (`${title  } ${  description}`).toLowerCase();

  // First, check monitored locations
  for (const location of monitoredLocations) {
    if (text.includes(location.country_name.toLowerCase())) {
      return {
        country: location.country_name,
        country_code: location.country_code,
        city: location.city
      };
    }
  }

  // Check common country names
  const countryPatterns: Array<{ pattern: RegExp; country: string; code: string }> = [
    { pattern: /\bchina\b/i, country: 'China', code: 'CN' },
    { pattern: /\bunited states\b|\busa\b|\bu\.s\./i, country: 'United States', code: 'US' },
    { pattern: /\bindia\b/i, country: 'India', code: 'IN' },
    { pattern: /\bbrazil\b/i, country: 'Brazil', code: 'BR' },
    { pattern: /\brunited kingdom\b|\buk\b|\bbritain\b/i, country: 'United Kingdom', code: 'GB' },
    { pattern: /\bgermany\b/i, country: 'Germany', code: 'DE' },
    { pattern: /\bfrance\b/i, country: 'France', code: 'FR' },
    { pattern: /\bitaly\b/i, country: 'Italy', code: 'IT' },
    { pattern: /\bjapan\b/i, country: 'Japan', code: 'JP' },
    { pattern: /\bsouth korea\b|\bkorea\b/i, country: 'South Korea', code: 'KR' },
    { pattern: /\bmexico\b/i, country: 'Mexico', code: 'MX' },
    { pattern: /\bcanada\b/i, country: 'Canada', code: 'CA' },
    { pattern: /\baustralia\b/i, country: 'Australia', code: 'AU' },
    { pattern: /\bvietnam\b/i, country: 'Vietnam', code: 'VN' },
    { pattern: /\bthailand\b/i, country: 'Thailand', code: 'TH' },
    { pattern: /\bindonesia\b/i, country: 'Indonesia', code: 'ID' },
    { pattern: /\bphilippines\b/i, country: 'Philippines', code: 'PH' },
    { pattern: /\bmalaysia\b/i, country: 'Malaysia', code: 'MY' },
    { pattern: /\bsouth africa\b/i, country: 'South Africa', code: 'ZA' },
    { pattern: /\bnigeria\b/i, country: 'Nigeria', code: 'NG' },
    { pattern: /\bkenya\b/i, country: 'Kenya', code: 'KE' },
    { pattern: /\bethiopia\b/i, country: 'Ethiopia', code: 'ET' },
    { pattern: /\begypt\b/i, country: 'Egypt', code: 'EG' },
    { pattern: /\bsaudi arabia\b/i, country: 'Saudi Arabia', code: 'SA' },
    { pattern: /\biran\b/i, country: 'Iran', code: 'IR' },
    { pattern: /\bturkey\b|\btürkiye\b/i, country: 'Turkey', code: 'TR' },
    { pattern: /\brussia\b/i, country: 'Russia', code: 'RU' },
    { pattern: /\bukraine\b/i, country: 'Ukraine', code: 'UA' },
    { pattern: /\bpoland\b/i, country: 'Poland', code: 'PL' },
    { pattern: /\bspain\b/i, country: 'Spain', code: 'ES' },
    { pattern: /\bafrica\b/i, country: 'Africa', code: '' },
    { pattern: /\basia\b/i, country: 'Asia', code: '' },
    { pattern: /\beurope\b/i, country: 'Europe', code: '' },
    { pattern: /\bamericas\b|\bsouth america\b/i, country: 'Americas', code: '' }
  ];

  for (const { pattern, country, code } of countryPatterns) {
    if (pattern.test(text)) {
      return {
        country,
        country_code: code || undefined
      };
    }
  }

  return null;
}

/**
 * Check if this is a global health alert that should be included regardless of location
 */
function isGlobalHealthAlert(title: string, description: string): boolean {
  const text = (`${title  } ${  description}`).toLowerCase();
  const globalKeywords = [
    'pandemic', 'global outbreak', 'worldwide', 'international spread',
    'public health emergency', 'pheic', 'health emergency of international concern',
    'global health threat', 'novel virus', 'new variant'
  ];

  return globalKeywords.some(keyword => text.includes(keyword));
}

/**
 * Extract disease name from article text
 */
function extractDiseaseName(title: string, description: string): string | undefined {
  const text = `${title  } ${  description}`;

  for (const disease of KNOWN_DISEASES) {
    if (text.toLowerCase().includes(disease.toLowerCase())) {
      return disease;
    }
  }

  // Check for generic disease patterns
  const diseasePatterns = [
    /(\w+)\s+virus/i,
    /(\w+)\s+fever/i,
    /(\w+)\s+disease/i,
    /(\w+)\s+syndrome/i
  ];

  for (const pattern of diseasePatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return undefined;
}

/**
 * Classify health event type
 */
function classifyHealthEventType(title: string, description: string): string {
  const text = (`${title  } ${  description}`).toLowerCase();

  if (text.includes('pandemic') || text.includes('global outbreak')) return 'pandemic';
  if (text.includes('emergency') || text.includes('pheic') || text.includes('alert')) return 'health_emergency';
  if (text.includes('outbreak') || text.includes('cluster') || text.includes('cases reported')) return 'outbreak';
  if (text.includes('travel') && (text.includes('restriction') || text.includes('ban') || text.includes('notice'))) return 'travel_restriction';
  if (text.includes('quarantine') || text.includes('isolation') || text.includes('lockdown')) return 'quarantine';
  if (text.includes('mandate') || text.includes('requirement') || text.includes('guideline')) return 'mandate';
  if (text.includes('vaccine') || text.includes('vaccination')) return 'vaccination_update';

  return 'health_event';
}

/**
 * Check if article is travel-related
 */
function isTravelRelated(title: string, description: string): boolean {
  const text = (`${title  } ${  description}`).toLowerCase();
  const travelKeywords = [
    'travel', 'traveler', 'flight', 'airport', 'border',
    'entry', 'visa', 'quarantine requirement', 'testing requirement'
  ];

  return travelKeywords.some(keyword => text.includes(keyword));
}

/**
 * Extract case and death counts from text
 */
function extractCaseCounts(text: string): { cases?: number; deaths?: number } {
  const result: { cases?: number; deaths?: number } = {};

  // Look for case counts
  const casesPatterns = [
    /(\d+[\d,]*)\s+(?:confirmed\s+)?cases/i,
    /cases[:\s]+(\d+[\d,]*)/i,
    /(\d+[\d,]*)\s+(?:people\s+)?(?:infected|affected)/i
  ];

  for (const pattern of casesPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.cases = parseInt(match[1].replace(/,/g, ''));
      break;
    }
  }

  // Look for death counts
  const deathsPatterns = [
    /(\d+[\d,]*)\s+deaths?/i,
    /deaths?[:\s]+(\d+[\d,]*)/i,
    /(\d+[\d,]*)\s+(?:people\s+)?(?:died|killed)/i,
    /fatalities[:\s]+(\d+[\d,]*)/i
  ];

  for (const pattern of deathsPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.deaths = parseInt(match[1].replace(/,/g, ''));
      break;
    }
  }

  return result;
}

/**
 * Extract alert level from text
 */
function extractAlertLevel(title: string, description: string): string | undefined {
  const text = (`${title  } ${  description}`).toLowerCase();

  // CDC levels
  if (text.includes('level 4') || text.includes('do not travel')) return 'Level 4 - Do Not Travel';
  if (text.includes('level 3') || text.includes('reconsider travel')) return 'Level 3 - Reconsider Travel';
  if (text.includes('level 2') || text.includes('practice enhanced precautions')) return 'Level 2 - Enhanced Precautions';
  if (text.includes('level 1') || text.includes('practice usual precautions')) return 'Level 1 - Usual Precautions';

  // WHO levels
  if (text.includes('pheic') || text.includes('international concern')) return 'PHEIC';
  if (text.includes('grade 3') || text.includes('high emergency')) return 'WHO Grade 3';
  if (text.includes('grade 2')) return 'WHO Grade 2';
  if (text.includes('grade 1')) return 'WHO Grade 1';

  return undefined;
}

/**
 * Calculate severity for health event
 */
function calculateHealthSeverity(
  eventType: string,
  cases: number | undefined,
  deaths: number | undefined,
  title: string,
  description: string,
  disease: string | undefined
): number {
  let severity = 0.5;

  // Base severity by event type
  switch (eventType) {
    case 'pandemic': severity = 0.95; break;
    case 'health_emergency': severity = 0.9; break;
    case 'outbreak': severity = 0.7; break;
    case 'quarantine': severity = 0.7; break;
    case 'travel_restriction': severity = 0.6; break;
    case 'mandate': severity = 0.5; break;
    case 'vaccination_update': severity = 0.4; break;
    default: severity = 0.5;
  }

  // Increase for high-fatality diseases
  const highRiskDiseases = ['Ebola', 'Marburg', 'Nipah', 'Plague', 'Anthrax', 'H5N1', 'MERS'];
  if (disease && highRiskDiseases.some(d => disease.toLowerCase().includes(d.toLowerCase()))) {
    severity = Math.min(0.95, severity + 0.15);
  }

  // Increase based on case/death counts
  if (cases) {
    if (cases > 10000) severity = Math.min(0.95, severity + 0.15);
    else if (cases > 1000) severity = Math.min(0.9, severity + 0.1);
    else if (cases > 100) severity = Math.min(0.8, severity + 0.05);
  }

  if (deaths) {
    if (deaths > 100) severity = Math.min(0.95, severity + 0.15);
    else if (deaths > 10) severity = Math.min(0.9, severity + 0.1);
    else if (deaths > 0) severity = Math.min(0.85, severity + 0.05);
  }

  // Check for severity keywords
  const text = (`${title  } ${  description}`).toLowerCase();
  if (text.includes('critical') || text.includes('severe')) severity = Math.min(0.95, severity + 0.1);
  if (text.includes('spreading rapidly') || text.includes('surging')) severity = Math.min(0.95, severity + 0.1);
  if (text.includes('new variant') || text.includes('novel')) severity = Math.min(0.9, severity + 0.1);

  return Math.max(0.3, Math.min(0.99, severity));
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
