import { createTool } from '@mastra/core/tools';
import { limitEvents, getFilterSummary } from './output-limiter';
import { z } from 'zod';

/**
 * Maritime & Logistics Monitor Tool
 *
 * Purpose: Monitor shipping disruptions, port closures, and logistics delays.
 *
 * Data Sources:
 * - RSS Feeds from maritime news sources:
 *   - Lloyd's List: https://lloydslist.maritimeintelligence.informa.com/
 *   - TradeWinds: https://www.tradewindsnews.com/
 *   - Maritime Executive: https://maritime-executive.com/
 *   - JOC (Journal of Commerce): https://www.joc.com/
 * - GDELT for maritime and shipping news
 *
 * Risk Categories:
 * - Port Closures & Congestion
 * - Shipping Route Disruptions
 * - Vessel Delays & Diversions
 * - Container Shortages
 * - Maritime Accidents
 * - Piracy & Security Threats
 *
 * Organization Isolation: Filters based on organization's shipping lanes and ports
 */

const PortInputSchema = z.object({
  port_code: z.string().describe('UN/LOCODE port code (e.g., USNYC, CNSHA)'),
  port_name: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

const ShippingLaneInputSchema = z.object({
  lane_id: z.string(),
  origin_port: z.string(),
  destination_port: z.string(),
  key_waypoints: z.array(z.string()).nullable().optional()
});

const MaritimeEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // port_closure, port_congestion, route_disruption, vessel_delay, accident, piracy
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1),
  location: z.object({
    port_code: z.string().optional(),
    port_name: z.string(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    region: z.string().optional()
  }),
  affected_ports: z.array(z.string()).optional(),
  affected_routes: z.array(z.string()).optional(),
  delay_estimate_days: z.number().optional(),
  event_timestamp: z.string().datetime(),
  source: z.string(),
  source_url: z.string().url().optional(),
  raw_data: z.record(z.string(), z.any()).optional()
});

export const maritimeLogisticsMonitorTool = createTool({
  id: 'maritime-logistics-monitor',
  description: 'Monitor shipping disruptions, port closures, congestion, route blockages, vessel delays, and maritime incidents using RSS feeds from maritime news sources and GDELT.',

  inputSchema: z.object({
    ports: z.array(PortInputSchema).nullable().optional().describe('Ports to monitor for disruptions. Pass null or omit to monitor general maritime news.'),
    shipping_lanes: z.array(ShippingLaneInputSchema).nullable().optional().describe('Shipping routes to monitor. Pass null or omit to monitor all routes.'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_hours: z.number().int().min(1).max(168).default(24).describe('How many hours back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    maritime_events: z.array(MaritimeEventSchema).describe('Detected maritime and logistics events'),
    port_events_count: z.number().int().describe('Number of port-related events'),
    route_events_count: z.number().int().describe('Number of shipping route events'),
    high_severity_count: z.number().int().describe('Number of high severity events'),
    feeds_checked: z.number().int().describe('Number of RSS feeds checked')
  }),

  execute: async ({ context }) => {
    const { ports, shipping_lanes, severity_threshold, lookback_hours, organization_id } = context;

    console.log(`[Maritime Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    if (!organization_id) {
      throw new Error('organization_id is required for maritime monitoring');
    }

    console.log(`[Maritime Monitor] Monitoring for organization: ${organization_id}`);

    try {
      const severityThresholdValue = severity_threshold === 'low' ? 0.3 : severity_threshold === 'medium' ? 0.5 : 0.7;

      // Fetch from all maritime sources
      const { events, feedsChecked } = await fetchMaritimeData(
        ports ?? undefined,
        shipping_lanes ?? undefined,
        lookback_hours
      );

      // Filter by severity threshold
      const filteredEvents = events.filter(e => e.severity >= severityThresholdValue);

      const portEventsCount = filteredEvents.filter(e =>
        e.event_type === 'port_closure' || e.event_type === 'port_congestion'
      ).length;
      const routeEventsCount = filteredEvents.filter(e =>
        e.event_type === 'route_disruption' || e.event_type === 'vessel_delay'
      ).length;
      const highSeverityCount = filteredEvents.filter(e => e.severity >= 0.7).length;

      // Limit output to prevent context overflow
      const MAX_EVENTS = 10;
      const limitedEvents = limitEvents(filteredEvents, MAX_EVENTS);
      console.log(getFilterSummary(filteredEvents.length, limitedEvents.length, 'Maritime Monitor'));

      return {
        maritime_events: limitedEvents,
        port_events_count: portEventsCount,
        route_events_count: routeEventsCount,
        high_severity_count: highSeverityCount,
        feeds_checked: feedsChecked
      };

    } catch (error) {
      console.error(`[Maritime Monitor] Failed to fetch maritime data:`, error);
      throw new Error(`Maritime monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Data Source Integration
// ============================================================================

/**
 * Maritime RSS feeds to monitor
 */
const MARITIME_RSS_FEEDS = [
  {
    name: 'Maritime Executive',
    url: 'https://maritime-executive.com/rss.xml',
    source: 'Maritime Executive',
    priority: 'high'
  },
  {
    name: 'gCaptain',
    url: 'https://gcaptain.com/feed/',
    source: 'gCaptain',
    priority: 'high'
  },
  {
    name: 'Splash 247',
    url: 'https://splash247.com/feed/',
    source: 'Splash 247',
    priority: 'medium'
  }
];

/**
 * Maritime-related search terms for GDELT
 */
// Reduced search terms for faster execution (was 8, now 3)
const MARITIME_SEARCH_TERMS = [
  'port closure congestion',
  'shipping delay shortage',
  'maritime accident piracy'
];

/**
 * Major ports for detection
 */
const MAJOR_PORTS: Array<{ name: string; code: string; region: string }> = [
  { name: 'Shanghai', code: 'CNSHA', region: 'Asia' },
  { name: 'Singapore', code: 'SGSIN', region: 'Asia' },
  { name: 'Shenzhen', code: 'CNSZX', region: 'Asia' },
  { name: 'Ningbo', code: 'CNNGB', region: 'Asia' },
  { name: 'Busan', code: 'KRPUS', region: 'Asia' },
  { name: 'Hong Kong', code: 'HKHKG', region: 'Asia' },
  { name: 'Rotterdam', code: 'NLRTM', region: 'Europe' },
  { name: 'Antwerp', code: 'BEANR', region: 'Europe' },
  { name: 'Hamburg', code: 'DEHAM', region: 'Europe' },
  { name: 'Los Angeles', code: 'USLAX', region: 'North America' },
  { name: 'Long Beach', code: 'USLGB', region: 'North America' },
  { name: 'New York', code: 'USNYC', region: 'North America' },
  { name: 'Savannah', code: 'USSAV', region: 'North America' },
  { name: 'Dubai', code: 'AEJEA', region: 'Middle East' },
  { name: 'Suez Canal', code: 'EGPSD', region: 'Middle East' },
  { name: 'Panama Canal', code: 'PAPAC', region: 'Central America' }
];

interface RSSItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  category?: string;
}

interface GDELTArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

interface GDELTResponse {
  articles?: GDELTArticle[];
}

/**
 * Fetch maritime data from all sources
 */
async function fetchMaritimeData(
  ports: Array<{ port_code: string; port_name: string; latitude: number; longitude: number }> | undefined,
  shippingLanes: Array<{ lane_id: string; origin_port: string; destination_port: string }> | undefined,
  lookbackHours: number
): Promise<{ events: Array<z.infer<typeof MaritimeEventSchema>>; feedsChecked: number }> {
  const events: Array<z.infer<typeof MaritimeEventSchema>> = [];
  const seenUrls = new Set<string>();
  let feedsChecked = 0;

  const cutoffDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  // Fetch from RSS feeds
  for (const feed of MARITIME_RSS_FEEDS) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml',
          'User-Agent': 'Pericles-SupplyChainMonitor/1.0'
        },
        signal: AbortSignal.timeout(15000)
      });

      feedsChecked++;

      if (!response.ok) {
        console.warn(`[Maritime Monitor] Feed error ${response.status}: ${feed.name}`);
        continue;
      }

      const xmlText = await response.text();
      const items = parseRSSItems(xmlText);

      console.log(`[Maritime Monitor] Parsed ${items.length} items from ${feed.name}`);

      for (const item of items) {
        if (item.link && seenUrls.has(item.link)) continue;
        if (item.link) seenUrls.add(item.link);

        const pubDate = new Date(item.pubDate);
        if (isNaN(pubDate.getTime()) || pubDate < cutoffDate) continue;

        // Check relevance to monitored ports/lanes
        const location = extractMaritimeLocation(item.title, item.description, ports);
        const isRelevant = checkMaritimeRelevance(item.title, item.description, ports, shippingLanes);

        if (!isRelevant && !location) continue;

        const eventType = classifyMaritimeEventType(item.title, item.description);
        const severity = calculateMaritimeSeverity(item.title, item.description, eventType);
        const affectedPorts = extractAffectedPorts(item.title, item.description);
        const delayDays = extractDelayEstimate(item.title, item.description);

        events.push({
          event_id: `maritime-${feed.source.toLowerCase().replace(/\s+/g, '-')}-${hashString(item.link || item.title)}`,
          event_type: eventType,
          title: item.title,
          description: item.description.substring(0, 1000),
          severity,
          location: location || { port_name: 'Unknown', region: 'Unknown' },
          affected_ports: affectedPorts.length > 0 ? affectedPorts : undefined,
          delay_estimate_days: delayDays,
          event_timestamp: pubDate.toISOString(),
          source: feed.source,
          source_url: item.link,
          raw_data: { feed_name: feed.name, category: item.category }
        });
      }

      await sleep(300);

    } catch (err) {
      console.error(`[Maritime Monitor] Error fetching ${feed.name}:`, err);
    }
  }

  // Fetch maritime news from GDELT
  try {
    const gdeltEvents = await fetchGDELTMaritimeNews(lookbackHours, seenUrls, ports);
    events.push(...gdeltEvents);
    feedsChecked++;
    console.log(`[Maritime Monitor] Added ${gdeltEvents.length} events from GDELT`);
  } catch (err) {
    console.error(`[Maritime Monitor] Error fetching GDELT maritime news:`, err);
  }

  return { events, feedsChecked };
}

/**
 * Fetch maritime news from GDELT
 */
async function fetchGDELTMaritimeNews(
  lookbackHours: number,
  seenUrls: Set<string>,
  monitoredPorts?: Array<{ port_code: string; port_name: string }>
): Promise<Array<z.infer<typeof MaritimeEventSchema>>> {
  const events: Array<z.infer<typeof MaritimeEventSchema>> = [];

  for (const searchTerm of MARITIME_SEARCH_TERMS) {
    try {
      const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');

      url.searchParams.set('query', searchTerm);
      url.searchParams.set('mode', 'artlist');
      url.searchParams.set('timespan', `${Math.min(lookbackHours, 72)}h`);
      url.searchParams.set('maxrecords', '30');
      url.searchParams.set('format', 'json');

      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) continue;

      // Safely parse JSON - GDELT can return text errors even with 200 status
      const responseText = await response.text();
      let data: GDELTResponse;
      try {
        data = JSON.parse(responseText) as GDELTResponse;
      } catch {
        console.warn(`[GDELT Maritime] Invalid JSON response for search term: ${searchTerm}`);
        continue;
      }

      if (!data.articles || !Array.isArray(data.articles)) continue;

      for (const article of data.articles) {
        if (seenUrls.has(article.url)) continue;
        seenUrls.add(article.url);

        const eventType = classifyMaritimeEventType(article.title, '');
        const severity = calculateMaritimeSeverity(article.title, '', eventType);
        const eventTimestamp = parseGDELTDate(article.seendate);
        const location = extractMaritimeLocation(article.title, '', monitoredPorts);
        const affectedPorts = extractAffectedPorts(article.title, '');

        events.push({
          event_id: `gdelt-maritime-${hashString(article.url)}`,
          event_type: eventType,
          title: article.title,
          description: `Maritime news from ${article.domain}: ${article.title}`,
          severity,
          location: location || { port_name: 'Unknown', region: 'Global' },
          affected_ports: affectedPorts.length > 0 ? affectedPorts : undefined,
          event_timestamp: eventTimestamp,
          source: 'GDELT',
          source_url: article.url,
          raw_data: { domain: article.domain, language: article.language }
        });
      }

      await sleep(100);

    } catch (err) {
      console.error(`[GDELT Maritime] Error:`, err);
    }
  }

  return events;
}

function parseRSSItems(xmlText: string): RSSItem[] {
  const items: RSSItem[] = [];

  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];

    const title = extractXMLTag(itemContent, 'title');
    const description = extractXMLTag(itemContent, 'description');
    const link = extractXMLTag(itemContent, 'link');
    const pubDate = extractXMLTag(itemContent, 'pubDate') || extractXMLTag(itemContent, 'dc:date');
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
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const cdataMatch = content.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

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
    .replace(/<[^>]+>/g, '');
}

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

/**
 * Check if maritime news is relevant to monitored ports/lanes
 */
function checkMaritimeRelevance(
  title: string,
  description: string,
  ports: Array<{ port_code: string; port_name: string }> | undefined,
  shippingLanes: Array<{ lane_id: string; origin_port: string; destination_port: string }> | undefined
): boolean {
  const text = `${title} ${description}`.toLowerCase();

  // If no specific ports/lanes configured, include all maritime disruptions
  if (!ports && !shippingLanes) {
    const disruptionKeywords = [
      'closure', 'congestion', 'delay', 'disruption', 'blockage',
      'accident', 'collision', 'piracy', 'diversion', 'shortage'
    ];

    return disruptionKeywords.some(keyword => text.includes(keyword));
  }

  // Check monitored ports
  if (ports) {
    for (const port of ports) {
      if (text.includes(port.port_name.toLowerCase()) ||
          text.includes(port.port_code.toLowerCase())) {
        return true;
      }
    }
  }

  // Check monitored shipping lanes
  if (shippingLanes) {
    for (const lane of shippingLanes) {
      if (text.includes(lane.origin_port.toLowerCase()) ||
          text.includes(lane.destination_port.toLowerCase())) {
        return true;
      }
    }
  }

  // Check major ports
  for (const port of MAJOR_PORTS) {
    if (text.includes(port.name.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Extract maritime location from text
 */
function extractMaritimeLocation(
  title: string,
  description: string,
  monitoredPorts?: Array<{ port_code: string; port_name: string; latitude?: number; longitude?: number }>
): { port_code?: string; port_name: string; latitude?: number; longitude?: number; region?: string } | null {
  const text = `${title} ${description}`.toLowerCase();

  // Check monitored ports first
  if (monitoredPorts) {
    for (const port of monitoredPorts) {
      if (text.includes(port.port_name.toLowerCase())) {
        return {
          port_code: port.port_code,
          port_name: port.port_name,
          latitude: port.latitude,
          longitude: port.longitude
        };
      }
    }
  }

  // Check major ports
  for (const port of MAJOR_PORTS) {
    if (text.includes(port.name.toLowerCase())) {
      return {
        port_code: port.code,
        port_name: port.name,
        region: port.region
      };
    }
  }

  // Check for canal/strait mentions
  if (text.includes('suez')) return { port_name: 'Suez Canal', region: 'Middle East' };
  if (text.includes('panama')) return { port_name: 'Panama Canal', region: 'Central America' };
  if (text.includes('strait of hormuz')) return { port_name: 'Strait of Hormuz', region: 'Middle East' };
  if (text.includes('strait of malacca') || text.includes('malacca strait')) return { port_name: 'Strait of Malacca', region: 'Asia' };
  if (text.includes('bosporus') || text.includes('bosphorus')) return { port_name: 'Bosphorus Strait', region: 'Europe' };

  return null;
}

/**
 * Extract affected ports from text
 */
function extractAffectedPorts(title: string, description: string): string[] {
  const text = `${title} ${description}`.toLowerCase();
  const affected: string[] = [];

  for (const port of MAJOR_PORTS) {
    if (text.includes(port.name.toLowerCase()) && !affected.includes(port.name)) {
      affected.push(port.name);
    }
  }

  return affected;
}

/**
 * Classify maritime event type
 */
function classifyMaritimeEventType(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();

  if (text.includes('closure') || text.includes('closed') || text.includes('shutdown')) return 'port_closure';
  if (text.includes('congestion') || text.includes('congested') || text.includes('backlog')) return 'port_congestion';
  if (text.includes('delay') || text.includes('delayed') || text.includes('wait time')) return 'vessel_delay';
  if (text.includes('blocked') || text.includes('blockade') || text.includes('route')) return 'route_disruption';
  if (text.includes('accident') || text.includes('collision') || text.includes('grounding')) return 'accident';
  if (text.includes('piracy') || text.includes('pirate') || text.includes('hijack') || text.includes('attack')) return 'piracy';
  if (text.includes('shortage') || text.includes('container')) return 'container_shortage';
  if (text.includes('strike') || text.includes('labor')) return 'labor_action';

  return 'maritime_event';
}

/**
 * Calculate severity for maritime event
 */
function calculateMaritimeSeverity(title: string, description: string, eventType: string): number {
  let severity = 0.5;

  // Base severity by event type
  switch (eventType) {
    case 'port_closure': severity = 0.9; break;
    case 'route_disruption': severity = 0.85; break;
    case 'accident': severity = 0.75; break;
    case 'piracy': severity = 0.8; break;
    case 'port_congestion': severity = 0.6; break;
    case 'vessel_delay': severity = 0.5; break;
    case 'container_shortage': severity = 0.65; break;
    case 'labor_action': severity = 0.7; break;
    default: severity = 0.5;
  }

  const text = `${title} ${description}`.toLowerCase();

  // Increase for major chokepoints
  if (text.includes('suez') || text.includes('panama')) {
    severity = Math.min(0.95, severity + 0.15);
  }

  // Increase for severity keywords
  if (text.includes('major') || text.includes('significant')) {
    severity = Math.min(0.95, severity + 0.1);
  }
  if (text.includes('indefinite') || text.includes('unknown duration')) {
    severity = Math.min(0.95, severity + 0.1);
  }

  // Decrease for resolved events
  if (text.includes('reopened') || text.includes('resolved') || text.includes('cleared')) {
    severity = Math.max(0.3, severity - 0.2);
  }

  return Math.max(0.3, Math.min(0.99, severity));
}

/**
 * Extract delay estimate in days from text
 */
function extractDelayEstimate(title: string, description: string): number | undefined {
  const text = `${title} ${description}`;

  const patterns = [
    /(\d+)\s*(?:day|days?)\s*(?:delay|delayed)/i,
    /delay\s*(?:of\s+)?(\d+)\s*(?:day|days?)/i,
    /(\d+)-(\d+)\s*(?:day|days?)\s*delay/i,
    /wait\s*(?:time\s+)?(?:of\s+)?(\d+)\s*(?:day|days?)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // If range, return upper bound
      if (match[2]) {
        return parseInt(match[2]);
      }
      return parseInt(match[1]);
    }
  }

  return undefined;
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
