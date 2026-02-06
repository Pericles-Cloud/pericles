import { createTool } from '@mastra/core/tools';
import { limitEvents, getFilterSummary } from './output-limiter';
import { z } from 'zod';

/**
 * Labor & Social Monitor Tool
 *
 * Purpose: Monitor labor strikes, protests, and social unrest affecting supply chains.
 *
 * Data Sources:
 * - RSS Feeds from labor and social news:
 *   - ILO News: https://www.ilo.org/rss
 *   - Labor Notes: https://labornotes.org/feed
 *   - IndustriALL Global Union: https://www.industriall-union.org/rss.xml
 * - GDELT DOC 2.0 API for global labor/strike coverage
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
  city: z.string().nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional()
});

const IndustryInputSchema = z.object({
  industry_code: z.string().nullable().optional(),
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
    locations: z.array(LocationInputSchema).nullable().optional().describe('Locations to monitor for labor events. Pass null or omit to monitor globally.'),
    industries: z.array(IndustryInputSchema).nullable().optional().describe('Industries to monitor. Pass null or omit to monitor all industries.'),
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
    const { locations, industries, severity_threshold, lookback_hours, organization_id } = context;

    // Log the input parameters received
    console.log(`[Labor Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for labor monitoring');
    }

    console.log(`[Labor Monitor] Monitoring for organization: ${organization_id}`);

    // Map severity threshold to numeric value
    const severityThresholdValue = {
      low: 0.3,
      medium: 0.5,
      high: 0.7
    }[severity_threshold ?? 'medium'];

    try {
      const allEvents: Array<z.infer<typeof LaborEventSchema>> = [];
      const seenUrls = new Set<string>();
      let feedsChecked = 0;

      // Fetch from RSS feeds
      console.log(`[Labor Monitor] Fetching from RSS feeds...`);
      const rssEvents = await fetchLaborRSSFeeds(locations ?? undefined, industries ?? undefined, lookback_hours ?? 24);
      feedsChecked = LABOR_RSS_FEEDS.length;

      for (const event of rssEvents) {
        const key = event.source_url ?? event.event_id;
        if (!seenUrls.has(key)) {
          seenUrls.add(key);
          allEvents.push(event);
        }
      }
      console.log(`[Labor Monitor] Found ${rssEvents.length} events from RSS feeds`);

      // Fetch from GDELT for additional labor news coverage
      console.log(`[Labor Monitor] Fetching from GDELT...`);
      const gdeltEvents = await fetchGDELTLaborNews(locations ?? undefined, industries ?? undefined, lookback_hours ?? 24);

      for (const event of gdeltEvents) {
        const key = event.source_url ?? event.event_id;
        if (!seenUrls.has(key)) {
          seenUrls.add(key);
          allEvents.push(event);
        }
      }
      console.log(`[Labor Monitor] Found ${gdeltEvents.length} events from GDELT`);

      // Filter by severity threshold
      const filteredEvents = allEvents.filter(e => e.severity >= severityThresholdValue);

      // Calculate counts
      const strikeCount = filteredEvents.filter(e =>
        e.event_type === 'strike' || e.event_type === 'walkout' || e.event_type === 'work_stoppage'
      ).length;
      const protestCount = filteredEvents.filter(e =>
        e.event_type === 'protest' || e.event_type === 'demonstration' || e.event_type === 'civil_unrest'
      ).length;
      const highSeverityCount = filteredEvents.filter(e => e.severity >= 0.7).length;

      // Sort by severity (highest first) then by timestamp (most recent first)
      filteredEvents.sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        return new Date(b.event_timestamp).getTime() - new Date(a.event_timestamp).getTime();
      });

      // Limit output to prevent context overflow
      const MAX_EVENTS = 10;
      const limitedEvents = limitEvents(filteredEvents, MAX_EVENTS);
      console.log(getFilterSummary(filteredEvents.length, limitedEvents.length, 'Labor Monitor'));

      return {
        labor_events: limitedEvents,
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
// RSS Feed Configuration
// ============================================================================

interface LaborRSSFeed {
  name: string;
  url: string;
  priority: 'high' | 'medium' | 'low';
  type: 'labor' | 'union' | 'general';
}

const LABOR_RSS_FEEDS: LaborRSSFeed[] = [
  {
    name: 'ILO News',
    url: 'https://www.ilo.org/resource/rss/news.xml',
    priority: 'high',
    type: 'labor'
  },
  {
    name: 'Labor Notes',
    url: 'https://labornotes.org/feed',
    priority: 'high',
    type: 'labor'
  },
  {
    name: 'IndustriALL Global Union',
    url: 'https://www.industriall-union.org/rss.xml',
    priority: 'high',
    type: 'union'
  },
  {
    name: 'AFL-CIO Blog',
    url: 'https://aflcio.org/feed',
    priority: 'medium',
    type: 'union'
  },
  {
    name: 'ITUC Global Rights Index',
    url: 'https://www.ituc-csi.org/spip.php?page=backend',
    priority: 'medium',
    type: 'labor'
  }
];

// ============================================================================
// Country and Location Data
// ============================================================================

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'afghanistan': 'AF', 'albania': 'AL', 'algeria': 'DZ', 'argentina': 'AR',
  'australia': 'AU', 'austria': 'AT', 'bangladesh': 'BD', 'belgium': 'BE',
  'brazil': 'BR', 'canada': 'CA', 'chile': 'CL', 'china': 'CN',
  'colombia': 'CO', 'czech republic': 'CZ', 'czechia': 'CZ', 'denmark': 'DK',
  'egypt': 'EG', 'finland': 'FI', 'france': 'FR', 'germany': 'DE',
  'greece': 'GR', 'hong kong': 'HK', 'hungary': 'HU', 'india': 'IN',
  'indonesia': 'ID', 'iran': 'IR', 'iraq': 'IQ', 'ireland': 'IE',
  'israel': 'IL', 'italy': 'IT', 'japan': 'JP', 'kenya': 'KE',
  'korea': 'KR', 'south korea': 'KR', 'malaysia': 'MY', 'mexico': 'MX',
  'morocco': 'MA', 'netherlands': 'NL', 'new zealand': 'NZ', 'nigeria': 'NG',
  'norway': 'NO', 'pakistan': 'PK', 'peru': 'PE', 'philippines': 'PH',
  'poland': 'PL', 'portugal': 'PT', 'romania': 'RO', 'russia': 'RU',
  'saudi arabia': 'SA', 'singapore': 'SG', 'south africa': 'ZA', 'spain': 'ES',
  'sweden': 'SE', 'switzerland': 'CH', 'taiwan': 'TW', 'thailand': 'TH',
  'turkey': 'TR', 'ukraine': 'UA', 'united arab emirates': 'AE', 'uae': 'AE',
  'united kingdom': 'GB', 'uk': 'GB', 'britain': 'GB', 'great britain': 'GB',
  'united states': 'US', 'usa': 'US', 'us': 'US', 'america': 'US',
  'vietnam': 'VN', 'venezuela': 'VE'
};

// Major industrial cities for location extraction
const MAJOR_INDUSTRIAL_CITIES: Array<{ city: string; country: string; countryCode: string }> = [
  { city: 'Detroit', country: 'United States', countryCode: 'US' },
  { city: 'Pittsburgh', country: 'United States', countryCode: 'US' },
  { city: 'Los Angeles', country: 'United States', countryCode: 'US' },
  { city: 'Chicago', country: 'United States', countryCode: 'US' },
  { city: 'Shanghai', country: 'China', countryCode: 'CN' },
  { city: 'Shenzhen', country: 'China', countryCode: 'CN' },
  { city: 'Dongguan', country: 'China', countryCode: 'CN' },
  { city: 'Mumbai', country: 'India', countryCode: 'IN' },
  { city: 'Dhaka', country: 'Bangladesh', countryCode: 'BD' },
  { city: 'Ho Chi Minh City', country: 'Vietnam', countryCode: 'VN' },
  { city: 'Bangkok', country: 'Thailand', countryCode: 'TH' },
  { city: 'Mexico City', country: 'Mexico', countryCode: 'MX' },
  { city: 'São Paulo', country: 'Brazil', countryCode: 'BR' },
  { city: 'Johannesburg', country: 'South Africa', countryCode: 'ZA' },
  { city: 'London', country: 'United Kingdom', countryCode: 'GB' },
  { city: 'Paris', country: 'France', countryCode: 'FR' },
  { city: 'Berlin', country: 'Germany', countryCode: 'DE' },
  { city: 'Tokyo', country: 'Japan', countryCode: 'JP' },
  { city: 'Seoul', country: 'South Korea', countryCode: 'KR' }
];

// ============================================================================
// Industry Keywords for Classification
// ============================================================================

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  'automotive': ['auto', 'automotive', 'car', 'vehicle', 'motor', 'tesla', 'toyota', 'ford', 'gm', 'volkswagen', 'honda', 'bmw'],
  'manufacturing': ['factory', 'manufacturing', 'production', 'assembly', 'plant', 'industrial'],
  'logistics': ['logistics', 'warehouse', 'shipping', 'freight', 'trucking', 'delivery', 'port', 'dock'],
  'retail': ['retail', 'store', 'amazon', 'walmart', 'target', 'costco'],
  'technology': ['tech', 'software', 'hardware', 'semiconductor', 'chip', 'apple', 'google', 'microsoft'],
  'healthcare': ['hospital', 'healthcare', 'medical', 'nurse', 'doctor', 'pharmaceutical'],
  'construction': ['construction', 'building', 'infrastructure'],
  'mining': ['mining', 'coal', 'iron ore', 'copper', 'gold'],
  'energy': ['oil', 'gas', 'energy', 'petroleum', 'refinery'],
  'textiles': ['textile', 'garment', 'apparel', 'clothing', 'fashion'],
  'food': ['food', 'agriculture', 'farm', 'meat', 'processing'],
  'aviation': ['airline', 'aviation', 'airport', 'pilot', 'flight attendant'],
  'rail': ['rail', 'railroad', 'train', 'locomotive']
};

// Major companies for tracking
const MAJOR_COMPANIES: string[] = [
  'Amazon', 'Walmart', 'UPS', 'FedEx', 'DHL',
  'Tesla', 'Toyota', 'Ford', 'General Motors', 'Volkswagen', 'BMW', 'Honda',
  'Apple', 'Foxconn', 'Samsung', 'Intel', 'TSMC',
  'Boeing', 'Airbus', 'Delta', 'United Airlines', 'Southwest',
  'Starbucks', 'McDonalds', 'Chipotle',
  'Nike', 'Adidas', 'H&M', 'Zara',
  'BNSF', 'Union Pacific', 'CSX', 'Norfolk Southern'
];

// ============================================================================
// Helper Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch and parse labor RSS feeds
 */
async function fetchLaborRSSFeeds(
  locations: Array<{ country_code: string; country_name: string; city?: string | null }> | undefined,
  industries: Array<{ industry_name: string }> | undefined,
  lookbackHours: number
): Promise<Array<z.infer<typeof LaborEventSchema>>> {
  const events: Array<z.infer<typeof LaborEventSchema>> = [];
  const cutoffDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  for (const feed of LABOR_RSS_FEEDS) {
    try {
      console.log(`[Labor Monitor] Fetching RSS feed: ${feed.name}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => { controller.abort(); }, 15000);

      const response = await fetch(feed.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PericlesBot/1.0; +https://pericles.cloud)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.log(`[Labor Monitor] Feed ${feed.name} returned ${response.status}`);
        continue;
      }

      const xmlText = await response.text();
      const items = parseRSSItems(xmlText);

      console.log(`[Labor Monitor] Parsed ${items.length} items from ${feed.name}`);

      for (const item of items) {
        // Check if within lookback period
        if (item.pubDate && item.pubDate < cutoffDate) continue;

        const title = item.title || '';
        const description = item.description || '';
        const text = `${title} ${description}`.toLowerCase();

        // Check relevance to labor/strike topics
        if (!isLaborRelevant(text)) continue;

        // Check relevance to monitored locations
        if (locations && locations.length > 0) {
          const isLocationRelevant = locations.some(loc =>
            text.includes(loc.country_name.toLowerCase()) ||
            (loc.city && text.includes(loc.city.toLowerCase()))
          );
          if (!isLocationRelevant) continue;
        }

        // Check relevance to monitored industries
        if (industries && industries.length > 0) {
          const isIndustryRelevant = industries.some(ind =>
            text.includes(ind.industry_name.toLowerCase())
          );
          if (!isIndustryRelevant) continue;
        }

        // Classify event type
        const eventType = classifyLaborEventType(title, description);

        // Extract location
        const location = extractLaborLocation(title, description);

        // Extract industry
        const industry = extractIndustry(title, description);

        // Extract company name
        const company = extractCompanyName(title, description);

        // Extract worker count
        const workersAffected = extractWorkerCount(title, description);

        // Calculate severity
        const severity = calculateLaborSeverity(eventType, workersAffected, title, description);

        const eventId = `labor-${feed.name.toLowerCase().replace(/\s+/g, '-')}-${hashString(title + (item.pubDate?.toISOString() || ''))}`;

        events.push({
          event_id: eventId,
          event_type: eventType,
          title: title.slice(0, 500),
          description: description.slice(0, 2000),
          severity,
          location,
          industry,
          company,
          workers_affected: workersAffected,
          event_timestamp: item.pubDate?.toISOString() ?? new Date().toISOString(),
          source: feed.name,
          source_url: item.link || undefined
        });
      }

      // Rate limiting between feeds
      await sleep(200);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`[Labor Monitor] Timeout fetching ${feed.name}`);
      } else {
        console.error(`[Labor Monitor] Error fetching ${feed.name}:`, error);
      }
      continue;
    }
  }

  return events;
}

/**
 * Parse RSS XML into items
 */
function parseRSSItems(xmlText: string): Array<{
  title: string;
  description: string;
  link: string;
  pubDate: Date | null;
}> {
  const items: Array<{
    title: string;
    description: string;
    link: string;
    pubDate: Date | null;
  }> = [];

  // Match <item> or <entry> elements
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1] || match[2];

    // Extract title
    const titleRegex = /<title[^>]*>([\s\S]*?)<\/title>/i;
    const titleMatch = titleRegex.exec(itemContent);
    const title = titleMatch ? decodeHTMLEntities(titleMatch[1]) : '';

    // Extract description (could be description, summary, or content)
    const descRegex = /<description[^>]*>([\s\S]*?)<\/description>|<summary[^>]*>([\s\S]*?)<\/summary>|<content[^>]*>([\s\S]*?)<\/content>/i;
    const descMatch = descRegex.exec(itemContent);
    const description = descMatch ? decodeHTMLEntities(descMatch[1] || descMatch[2] || descMatch[3]) : '';

    // Extract link
    const linkRegex = /<link[^>]*>([^<]+)<\/link>|<link[^>]*href=["']([^"']+)["']/i;
    const linkMatch = linkRegex.exec(itemContent);
    const link = linkMatch ? (linkMatch[1] || linkMatch[2] || '').trim() : '';

    // Extract publication date
    const dateRegex = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>|<published[^>]*>([\s\S]*?)<\/published>|<dc:date[^>]*>([\s\S]*?)<\/dc:date>|<updated[^>]*>([\s\S]*?)<\/updated>/i;
    const dateMatch = dateRegex.exec(itemContent);
    let pubDate: Date | null = null;
    if (dateMatch) {
      const dateStr = (dateMatch[1] || dateMatch[2] || dateMatch[3] || dateMatch[4] || '').trim();
      pubDate = new Date(dateStr);
      if (isNaN(pubDate.getTime())) pubDate = null;
    }

    if (title || description) {
      items.push({ title, description, link, pubDate });
    }
  }

  return items;
}

/**
 * Check if content is relevant to labor/strike topics
 */
function isLaborRelevant(text: string): boolean {
  const laborKeywords = [
    'strike', 'walkout', 'work stoppage', 'labor dispute', 'union',
    'protest', 'demonstration', 'workers rights', "workers' rights",
    'collective bargaining', 'labor action', 'industrial action',
    'labor shortage', 'wage', 'minimum wage', 'pay raise', 'pay cut',
    'layoff', 'mass layoff', 'job cuts', 'workforce reduction',
    'safety violation', 'workplace accident', 'osha', 'working conditions',
    'picket', 'boycott', 'lockout', 'contract negotiation',
    'unfair labor', 'labor law', 'employment rights'
  ];

  return laborKeywords.some(keyword => text.includes(keyword));
}

/**
 * Classify labor event type from article content
 */
function classifyLaborEventType(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();

  // Check for specific event types
  if (text.includes('strike') || text.includes('walkout') || text.includes('work stoppage')) {
    return 'strike';
  }
  if (text.includes('protest') || text.includes('demonstration') || text.includes('march')) {
    return 'protest';
  }
  if (text.includes('negotiation') || text.includes('contract') || text.includes('collective bargaining')) {
    return 'negotiation';
  }
  if (text.includes('accident') || text.includes('safety') || text.includes('injury') || text.includes('fatality') || text.includes('osha')) {
    return 'safety_incident';
  }
  if (text.includes('shortage') || text.includes('lack of workers') || text.includes('hiring')) {
    return 'shortage';
  }
  if (text.includes('wage') || text.includes('pay') || text.includes('salary') || text.includes('compensation')) {
    return 'wage_dispute';
  }
  if (text.includes('layoff') || text.includes('job cuts') || text.includes('downsizing')) {
    return 'layoff';
  }
  if (text.includes('lockout')) {
    return 'lockout';
  }
  if (text.includes('civil unrest') || text.includes('riot') || text.includes('uprising')) {
    return 'civil_unrest';
  }

  return 'labor_event';
}

/**
 * Extract location from labor article
 */
function extractLaborLocation(title: string, description: string): {
  country: string;
  country_code?: string;
  city?: string;
} {
  const text = `${title} ${description}`.toLowerCase();

  // Check for cities first (more specific)
  for (const cityData of MAJOR_INDUSTRIAL_CITIES) {
    if (text.includes(cityData.city.toLowerCase())) {
      return {
        country: cityData.country,
        country_code: cityData.countryCode,
        city: cityData.city
      };
    }
  }

  // Check for country names
  for (const [countryName, countryCode] of Object.entries(COUNTRY_NAME_TO_CODE)) {
    if (text.includes(countryName)) {
      // Convert to proper case for display
      const displayName = countryName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return {
        country: displayName,
        country_code: countryCode
      };
    }
  }

  return { country: 'Unknown' };
}

/**
 * Extract industry from article content
 */
function extractIndustry(title: string, description: string): string | undefined {
  const text = `${title} ${description}`.toLowerCase();

  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      return industry;
    }
  }

  return undefined;
}

/**
 * Extract company name from article content
 */
function extractCompanyName(title: string, description: string): string | undefined {
  const text = `${title} ${description}`;

  for (const company of MAJOR_COMPANIES) {
    if (text.toLowerCase().includes(company.toLowerCase())) {
      return company;
    }
  }

  return undefined;
}

/**
 * Extract number of affected workers from article text
 */
function extractWorkerCount(title: string, description: string): number | undefined {
  const text = `${title} ${description}`;

  // Look for patterns like "1,000 workers", "10000 employees", "thousands of staff"
  const patterns = [
    /(\d{1,3}(?:,\d{3})*|\d+)\s*(?:thousand|k)?\s*(?:workers|employees|staff|members|people)/i,
    /(?:about|approximately|around|nearly|over|more than)\s*(\d{1,3}(?:,\d{3})*|\d+)\s*(?:thousand|k)?/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let count = parseInt(match[1].replace(/,/g, ''), 10);
      // Check if "thousand" modifier
      if (/thousand|k/i.test(match[0])) {
        count *= 1000;
      }
      if (count > 0 && count < 10000000) { // Sanity check
        return count;
      }
    }
  }

  // Handle word-based counts
  if (/thousands/i.test(text)) return 5000;
  if (/hundreds/i.test(text)) return 500;

  return undefined;
}

/**
 * Calculate severity for labor event
 */
function calculateLaborSeverity(
  eventType: string,
  workersAffected: number | undefined,
  title: string,
  description: string
): number {
  const text = `${title} ${description}`.toLowerCase();

  // Base severity by event type
  const baseSeverity: Record<string, number> = {
    'strike': 0.7,
    'protest': 0.6,
    'safety_incident': 0.75,
    'layoff': 0.65,
    'lockout': 0.7,
    'civil_unrest': 0.8,
    'shortage': 0.55,
    'wage_dispute': 0.5,
    'negotiation': 0.4,
    'labor_event': 0.5
  };

  let severity = baseSeverity[eventType] ?? 0.5;

  // Increase severity based on scale of workers affected
  if (workersAffected) {
    if (workersAffected > 50000) severity = Math.min(1.0, severity + 0.25);
    else if (workersAffected > 10000) severity = Math.min(1.0, severity + 0.2);
    else if (workersAffected > 1000) severity = Math.min(1.0, severity + 0.1);
    else if (workersAffected > 100) severity = Math.min(1.0, severity + 0.05);
  }

  // Adjust for severity-indicating keywords
  const highSeverityKeywords = [
    'indefinite strike', 'general strike', 'nationwide', 'national',
    'critical', 'major', 'massive', 'widespread', 'disruption',
    'shutdown', 'halt', 'paralyzed', 'gridlock', 'emergency',
    'violence', 'injury', 'death', 'fatality', 'killed'
  ];

  if (highSeverityKeywords.some(kw => text.includes(kw))) {
    severity = Math.min(1.0, severity + 0.15);
  }

  const lowSeverityKeywords = [
    'minor', 'brief', 'limited', 'small', 'local',
    'resolved', 'ended', 'agreement reached', 'settled'
  ];

  if (lowSeverityKeywords.some(kw => text.includes(kw))) {
    severity = Math.max(0.2, severity - 0.1);
  }

  // Port/transport strikes are particularly impactful for supply chains
  if (/port|dock|shipping|rail|trucking|freight/i.test(text)) {
    severity = Math.min(1.0, severity + 0.1);
  }

  return Math.round(severity * 100) / 100;
}

/**
 * Fetch labor news from GDELT DOC 2.0 API
 */
async function fetchGDELTLaborNews(
  locations: Array<{ country_code: string; country_name: string; city?: string | null }> | undefined,
  industries: Array<{ industry_name: string }> | undefined,
  lookbackHours: number
): Promise<Array<z.infer<typeof LaborEventSchema>>> {
  const events: Array<z.infer<typeof LaborEventSchema>> = [];

  try {
    // Build search queries for labor topics (reduced for faster execution)
    const laborQueries = [
      'strike workers union',
      'labor protest walkout',
      'port truckers strike'
    ];

    // Build location filter if provided
    let locationFilter = '';
    if (locations && locations.length > 0) {
      const countryFilters = locations
        .slice(0, 3)
        .map(loc => `sourcecountry:${loc.country_code.toLowerCase()}`)
        .join(' OR ');
      locationFilter = ` (${countryFilters})`;
    }

    // Limit lookback for GDELT (last 48 hours max for this API)
    const effectiveLookback = Math.min(lookbackHours, 48);
    const startDate = new Date(Date.now() - effectiveLookback * 60 * 60 * 1000);
    const startDateStr = startDate.toISOString().slice(0, 10).replace(/-/g, '');

    // Query each topic
    for (const query of laborQueries.slice(0, 3)) { // Limit to 3 queries
      try {
        const encodedQuery = encodeURIComponent(`${query}${locationFilter}`);
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodedQuery}&mode=artlist&format=json&maxrecords=25&startdatetime=${startDateStr}000000&sort=DateDesc`;

        console.log(`[Labor Monitor] GDELT query: ${query}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => { controller.abort(); }, 15000);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json'
          }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.log(`[Labor Monitor] GDELT returned ${response.status}`);
          continue;
        }

        // Safely parse JSON - GDELT can return text errors even with 200 status
        const responseText = await response.text();
        let data: { articles?: Array<{ title?: string; seendate?: string; url?: string; sourcecountry?: string; domain?: string }> };
        try {
          data = JSON.parse(responseText);
        } catch {
          console.warn(`[Labor Monitor] GDELT returned invalid JSON for query: ${query}`);
          continue;
        }
        const articles = data.articles || [];

        console.log(`[Labor Monitor] GDELT returned ${articles.length} articles for "${query}"`);

        for (const article of articles) {
          const title = article.title || '';
          const description = article.seendate ? `Published: ${article.seendate}` : '';
          const text = `${title} ${description}`.toLowerCase();

          // Check industry relevance if specified
          if (industries && industries.length > 0) {
            const isIndustryRelevant = industries.some(ind =>
              text.includes(ind.industry_name.toLowerCase())
            );
            if (!isIndustryRelevant) continue;
          }

          // Parse date
          let eventDate = new Date();
          if (article.seendate) {
            // Format: YYYYMMDDTHHmmssZ
            const dateStr = article.seendate;
            if (dateStr.length >= 8) {
              const year = dateStr.slice(0, 4);
              const month = dateStr.slice(4, 6);
              const day = dateStr.slice(6, 8);
              eventDate = new Date(`${year}-${month}-${day}`);
              if (isNaN(eventDate.getTime())) eventDate = new Date();
            }
          }

          // Classify and extract
          const eventType = classifyLaborEventType(title, '');
          const location = extractLaborLocation(title, '');
          const industry = extractIndustry(title, '');
          const company = extractCompanyName(title, '');
          const workersAffected = extractWorkerCount(title, '');
          const severity = calculateLaborSeverity(eventType, workersAffected, title, '');

          const eventId = `gdelt-labor-${hashString(article.url || title)}`;

          events.push({
            event_id: eventId,
            event_type: eventType,
            title: title.slice(0, 500),
            description: `Source: ${article.sourcecountry || 'Unknown'}. ${article.domain || ''}`.trim().slice(0, 2000),
            severity,
            location: location.country !== 'Unknown' ? location : {
              country: article.sourcecountry || 'Unknown'
            },
            industry,
            company,
            workers_affected: workersAffected,
            event_timestamp: eventDate.toISOString(),
            source: 'GDELT',
            source_url: article.url || undefined
          });
        }

        // Rate limit between GDELT queries
        await sleep(500);

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`[Labor Monitor] GDELT timeout for query: ${query}`);
        } else {
          console.error(`[Labor Monitor] GDELT error for query ${query}:`, error);
        }
      }
    }

  } catch (error) {
    console.error(`[Labor Monitor] GDELT fetch error:`, error);
  }

  return events;
}
