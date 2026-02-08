import { createTool } from '@mastra/core/tools';
import { limitEvents, getFilterSummary } from './output-limiter.js';
import { toolLoggers } from './tool-logger.js';
import { z } from 'zod';

const logger = toolLoggers.regulatoryTrade;

/**
 * Regulatory & Trade Monitor Tool
 *
 * Purpose: Monitor regulatory changes, trade policies, tariffs, and sanctions affecting supply chains.
 *
 * Data Sources:
 * - WTO (World Trade Organization) RSS feeds
 * - GDELT for trade policy news
 * - US Trade Representative announcements
 *
 * Risk Categories:
 * - Tariff Changes & Trade Wars
 * - Sanctions & Export Controls
 * - Regulatory Changes (compliance, safety, environmental)
 * - Trade Agreement Changes
 * - Import/Export Restrictions
 * - Customs Policy Changes
 *
 * Organization Isolation: Filters based on organization's trade routes and regulated products
 */

const CountryInputSchema = z.object({
  country_code: z.string().length(2),
  country_name: z.string()
});

const ProductInputSchema = z.object({
  hs_code: z.string().nullable().optional().describe('Harmonized System code'),
  product_name: z.string()
});

const RegulatoryEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // tariff, sanctions, regulation, trade_agreement, restriction, customs
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1),
  affected_countries: z.array(z.string()),
  affected_products: z.array(z.string()).optional(),
  effective_date: z.string().optional().describe('When the regulation takes effect'),
  tariff_rate: z.number().optional().describe('Tariff percentage if applicable'),
  compliance_deadline: z.string().optional(),
  regulatory_body: z.string().optional(),
  event_timestamp: z.string().datetime(),
  source: z.string(),
  source_url: z.string().url().optional(),
  raw_data: z.record(z.string(), z.any()).optional()
});

export const regulatoryTradeMonitorTool = createTool({
  id: 'regulatory-trade-monitor',
  description: 'Monitor regulatory changes, tariff announcements, trade policies, sanctions, export controls, and customs regulations using WTO RSS feeds and GDELT trade news.',

  inputSchema: z.object({
    countries: z.array(CountryInputSchema).min(1).describe('Countries to monitor for regulatory changes'),
    products: z.array(ProductInputSchema).nullable().optional().describe('Products/HS codes to monitor. Pass null or omit to monitor all products.'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_days: z.number().int().min(1).max(365).default(30).describe('How many days back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    regulatory_events: z.array(RegulatoryEventSchema).describe('Detected regulatory and trade events'),
    tariff_count: z.number().int().describe('Number of tariff-related events'),
    sanction_count: z.number().int().describe('Number of sanction-related events'),
    high_severity_count: z.number().int().describe('Number of high severity events'),
    sources_checked: z.number().int().describe('Number of data sources checked')
  }),

  execute: async ({ context }) => {
    const { countries, products, severity_threshold, lookback_days, organization_id } = context;

    logger.debug({ context }, 'Tool executed');

    if (!organization_id) {
      throw new Error('organization_id is required for regulatory monitoring');
    }

    logger.info({ countryCount: countries.length, organizationId: organization_id }, 'Monitoring countries');

    try {
      const severityThresholdValue = severity_threshold === 'low' ? 0.3 : severity_threshold === 'medium' ? 0.5 : 0.7;

      // Fetch from all regulatory sources
      const { events, sourcesChecked } = await fetchRegulatoryData(
        countries,
        products ?? undefined,
        lookback_days
      );

      // Filter by severity threshold
      const filteredEvents = events.filter(e => e.severity >= severityThresholdValue);

      const tariffCount = filteredEvents.filter(e =>
        e.event_type === 'tariff' || e.event_type === 'duty'
      ).length;
      const sanctionCount = filteredEvents.filter(e =>
        e.event_type === 'sanctions' || e.event_type === 'embargo'
      ).length;
      const highSeverityCount = filteredEvents.filter(e => e.severity >= 0.7).length;

      // Limit output to prevent context overflow
      const MAX_EVENTS = 10;
      const limitedEvents = limitEvents(filteredEvents, MAX_EVENTS);
      logger.info({ total: filteredEvents.length, limited: limitedEvents.length }, getFilterSummary(filteredEvents.length, limitedEvents.length, 'Regulatory Monitor'));

      return {
        regulatory_events: limitedEvents,
        tariff_count: tariffCount,
        sanction_count: sanctionCount,
        high_severity_count: highSeverityCount,
        sources_checked: sourcesChecked
      };

    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch regulatory data');
      throw new Error(`Regulatory monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Data Source Integration
// ============================================================================

/**
 * Trade and regulatory RSS feeds
 */
const REGULATORY_RSS_FEEDS = [
  {
    name: 'WTO News',
    url: 'https://www.wto.org/english/news_e/news_e.rss',
    source: 'WTO',
    regulatoryBody: 'World Trade Organization',
    priority: 'high'
  },
  {
    name: 'USTR Press Releases',
    url: 'https://ustr.gov/about-us/policy-offices/press-office/press-releases/rss.xml',
    source: 'USTR',
    regulatoryBody: 'US Trade Representative',
    priority: 'high'
  },
  {
    name: 'EU Trade Policy',
    url: 'https://policy.trade.ec.europa.eu/rss_en',
    source: 'EU',
    regulatoryBody: 'European Commission DG Trade',
    priority: 'medium'
  }
];

/**
 * Trade-related search terms for GDELT
 */
// Reduced search terms for faster execution (was 8, now 3)
const TRADE_SEARCH_TERMS = [
  'tariff trade war',
  'sanctions embargo export',
  'import ban regulation'
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
 * Fetch regulatory data from all sources
 */
async function fetchRegulatoryData(
  countries: Array<{ country_code: string; country_name: string }>,
  products: Array<{ hs_code?: string | null; product_name: string }> | undefined,
  lookbackDays: number
): Promise<{ events: Array<z.infer<typeof RegulatoryEventSchema>>; sourcesChecked: number }> {
  const events: Array<z.infer<typeof RegulatoryEventSchema>> = [];
  const seenUrls = new Set<string>();
  let sourcesChecked = 0;

  const lookbackHours = lookbackDays * 24;
  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Fetch from RSS feeds
  for (const feed of REGULATORY_RSS_FEEDS) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          'Accept': 'application/rss+xml, application/xml, text/xml',
          'User-Agent': 'Pericles-SupplyChainMonitor/1.0'
        },
        signal: AbortSignal.timeout(15000)
      });

      sourcesChecked++;

      if (!response.ok) {
        logger.warn({ status: response.status, feedName: feed.name }, 'Feed error');
        continue;
      }

      const xmlText = await response.text();
      const items = parseRSSItems(xmlText);

      logger.debug({ itemCount: items.length, feedName: feed.name }, 'Parsed items from feed');

      for (const item of items) {
        if (item.link && seenUrls.has(item.link)) continue;
        if (item.link) seenUrls.add(item.link);

        const pubDate = new Date(item.pubDate);
        if (isNaN(pubDate.getTime()) || pubDate < cutoffDate) continue;

        // Check relevance to monitored countries
        const affectedCountries = extractAffectedCountries(item.title, item.description, countries);

        // For global trade organizations, include even without specific country match
        const isGlobalTradeNews = isGlobalTradeEvent(item.title, item.description);

        if (affectedCountries.length === 0 && !isGlobalTradeNews) continue;

        const eventType = classifyRegulatoryEventType(item.title, item.description);
        const severity = calculateRegulatorySeverity(eventType, item.title, item.description);
        const affectedProducts = products ? extractAffectedProducts(item.title, item.description, products) : undefined;
        const tariffRate = extractTariffRate(item.title, item.description);
        const effectiveDate = extractEffectiveDate(item.title, item.description);

        events.push({
          event_id: `reg-${feed.source.toLowerCase()}-${hashString(item.link || item.title)}`,
          event_type: eventType,
          title: item.title,
          description: item.description.substring(0, 1000),
          severity,
          affected_countries: affectedCountries.length > 0 ? affectedCountries : ['Global'],
          affected_products: affectedProducts,
          tariff_rate: tariffRate,
          effective_date: effectiveDate,
          regulatory_body: feed.regulatoryBody,
          event_timestamp: pubDate.toISOString(),
          source: feed.source,
          source_url: item.link,
          raw_data: { feed_name: feed.name, category: item.category }
        });
      }

      await sleep(300);

    } catch (err) {
      logger.error({ err, feedName: feed.name }, 'Error fetching feed');
    }
  }

  // Fetch trade news from GDELT
  try {
    const gdeltEvents = await fetchGDELTTradeNews(countries, lookbackHours, seenUrls);
    events.push(...gdeltEvents);
    sourcesChecked++;
    logger.info({ eventCount: gdeltEvents.length }, 'Added events from GDELT');
  } catch (err) {
    logger.error({ err }, 'Error fetching GDELT trade news');
  }

  return { events, sourcesChecked };
}

/**
 * Fetch trade-related news from GDELT
 */
async function fetchGDELTTradeNews(
  countries: Array<{ country_code: string; country_name: string }>,
  lookbackHours: number,
  seenUrls: Set<string>
): Promise<Array<z.infer<typeof RegulatoryEventSchema>>> {
  const events: Array<z.infer<typeof RegulatoryEventSchema>> = [];

  // Get country codes for filtering
  const countryCodes = new Set(countries.map(c => c.country_code.toUpperCase()));
  const searchCountries = countryCodes.size > 0 ? Array.from(countryCodes).slice(0, 3) : [''];

  for (const countryCode of searchCountries) {
    for (const searchTerm of TRADE_SEARCH_TERMS) {
      try {
        const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');

        const query = countryCode
          ? `${searchTerm} sourcecountry:${countryCode}`
          : searchTerm;

        url.searchParams.set('query', query);
        url.searchParams.set('mode', 'artlist');
        url.searchParams.set('timespan', `${Math.min(lookbackHours, 72)}h`);
        url.searchParams.set('maxrecords', '30');
        url.searchParams.set('format', 'json');

        const response = await fetch(url.toString(), {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) continue;

        // Safely parse JSON - GDELT can return text errors even with 200 status
        const responseText = await response.text();
        let data: GDELTResponse;
        try {
          data = JSON.parse(responseText) as GDELTResponse;
        } catch {
          logger.warn({ searchTerm }, 'Invalid JSON response from GDELT');
          continue;
        }

        if (!data.articles || !Array.isArray(data.articles)) continue;

        for (const article of data.articles) {
          if (seenUrls.has(article.url)) continue;
          seenUrls.add(article.url);

          const eventType = classifyRegulatoryEventType(article.title, '');
          const severity = calculateRegulatorySeverity(eventType, article.title, '');
          const eventTimestamp = parseGDELTDate(article.seendate);
          const affectedCountries = extractAffectedCountries(article.title, '', countries);

          if (affectedCountries.length === 0) {
            affectedCountries.push(article.sourcecountry || 'Unknown');
          }

          events.push({
            event_id: `gdelt-trade-${hashString(article.url)}`,
            event_type: eventType,
            title: article.title,
            description: `Trade policy news from ${article.domain}: ${article.title}`,
            severity,
            affected_countries: affectedCountries,
            event_timestamp: eventTimestamp,
            source: 'GDELT',
            source_url: article.url,
            raw_data: { domain: article.domain, language: article.language }
          });
        }

        await sleep(100);

      } catch (err) {
        logger.error({ err }, 'GDELT trade query error');
      }
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
 * Extract affected countries from text
 */
function extractAffectedCountries(
  title: string,
  description: string,
  monitoredCountries: Array<{ country_code: string; country_name: string }>
): string[] {
  const text = (`${title  } ${  description}`).toLowerCase();
  const affected: string[] = [];

  for (const country of monitoredCountries) {
    if (text.includes(country.country_name.toLowerCase())) {
      affected.push(country.country_name);
    }
  }

  // Also check for common country patterns
  const countryPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\bchina\b|\bchinese\b/i, name: 'China' },
    { pattern: /\bunited states\b|\busa\b|\bu\.s\.\b|\bamerican\b/i, name: 'United States' },
    { pattern: /\beuropean union\b|\beu\b/i, name: 'European Union' },
    { pattern: /\brunited kingdom\b|\buk\b|\bbritish\b/i, name: 'United Kingdom' },
    { pattern: /\bgermany\b|\bgerman\b/i, name: 'Germany' },
    { pattern: /\bjapan\b|\bjapanese\b/i, name: 'Japan' },
    { pattern: /\bcanada\b|\bcanadian\b/i, name: 'Canada' },
    { pattern: /\bmexico\b|\bmexican\b/i, name: 'Mexico' },
    { pattern: /\bindia\b|\bindian\b/i, name: 'India' },
    { pattern: /\brussia\b|\brussian\b/i, name: 'Russia' },
    { pattern: /\biran\b|\biranian\b/i, name: 'Iran' },
    { pattern: /\bnorth korea\b|\bdprk\b/i, name: 'North Korea' },
    { pattern: /\bvenezuela\b/i, name: 'Venezuela' },
    { pattern: /\bcuba\b|\bcuban\b/i, name: 'Cuba' },
    { pattern: /\bsyria\b|\bsyrian\b/i, name: 'Syria' }
  ];

  for (const { pattern, name } of countryPatterns) {
    if (pattern.test(text) && !affected.includes(name)) {
      affected.push(name);
    }
  }

  return affected;
}

/**
 * Check if this is a global trade event
 */
function isGlobalTradeEvent(title: string, description: string): boolean {
  const text = (`${title  } ${  description}`).toLowerCase();
  const globalKeywords = [
    'global trade', 'world trade', 'wto', 'multilateral',
    'international trade', 'global supply chain', 'worldwide tariff'
  ];

  return globalKeywords.some(keyword => text.includes(keyword));
}

/**
 * Extract affected products from text
 */
function extractAffectedProducts(
  title: string,
  description: string,
  products: Array<{ hs_code?: string | null; product_name: string }>
): string[] | undefined {
  const text = (`${title  } ${  description}`).toLowerCase();
  const affected: string[] = [];

  for (const product of products) {
    if (text.includes(product.product_name.toLowerCase())) {
      affected.push(product.product_name);
    }
  }

  // Common product categories in trade news
  const productKeywords = [
    'steel', 'aluminum', 'semiconductor', 'chips', 'automobiles', 'cars',
    'solar panels', 'electronics', 'textiles', 'agricultural', 'soybeans',
    'oil', 'gas', 'technology', 'pharmaceuticals', 'rare earth'
  ];

  for (const keyword of productKeywords) {
    if (text.includes(keyword) && !affected.includes(keyword)) {
      affected.push(keyword);
    }
  }

  return affected.length > 0 ? affected : undefined;
}

/**
 * Classify regulatory event type
 */
function classifyRegulatoryEventType(title: string, description: string): string {
  const text = (`${title  } ${  description}`).toLowerCase();

  if (text.includes('sanction') || text.includes('embargo') || text.includes('blacklist')) return 'sanctions';
  if (text.includes('tariff') || text.includes('duty') || text.includes('levy')) return 'tariff';
  if (text.includes('export control') || text.includes('export ban') || text.includes('export restriction')) return 'export_control';
  if (text.includes('import ban') || text.includes('import restriction')) return 'import_restriction';
  if (text.includes('trade agreement') || text.includes('trade deal') || text.includes('fta')) return 'trade_agreement';
  if (text.includes('customs') || text.includes('border')) return 'customs';
  if (text.includes('regulation') || text.includes('compliance') || text.includes('standard')) return 'regulation';
  if (text.includes('trade war') || text.includes('retaliation')) return 'trade_war';
  if (text.includes('anti-dumping') || text.includes('countervailing')) return 'trade_remedy';

  return 'trade_policy';
}

/**
 * Calculate severity for regulatory event
 */
function calculateRegulatorySeverity(eventType: string, title: string, description: string): number {
  let severity = 0.5;

  // Base severity by event type
  switch (eventType) {
    case 'sanctions': severity = 0.95; break;
    case 'export_control': severity = 0.85; break;
    case 'import_restriction': severity = 0.8; break;
    case 'trade_war': severity = 0.85; break;
    case 'tariff': severity = 0.7; break;
    case 'trade_remedy': severity = 0.65; break;
    case 'customs': severity = 0.5; break;
    case 'trade_agreement': severity = 0.55; break;
    case 'regulation': severity = 0.5; break;
    default: severity = 0.5;
  }

  const text = (`${title  } ${  description}`).toLowerCase();

  // Increase for severity keywords
  if (text.includes('immediate') || text.includes('effective immediately')) severity = Math.min(0.95, severity + 0.1);
  if (text.includes('significant') || text.includes('major')) severity = Math.min(0.95, severity + 0.05);
  if (text.includes('100%') || text.includes('complete ban')) severity = Math.min(0.99, severity + 0.15);
  if (text.includes('escalat') || text.includes('retaliat')) severity = Math.min(0.95, severity + 0.1);

  // Decrease for positive news
  if (text.includes('lift') || text.includes('remove') || text.includes('reduce')) severity = Math.max(0.3, severity - 0.1);
  if (text.includes('agreement') && text.includes('sign')) severity = Math.max(0.4, severity - 0.1);

  return Math.max(0.3, Math.min(0.99, severity));
}

/**
 * Extract tariff rate from text
 */
function extractTariffRate(title: string, description: string): number | undefined {
  const text = `${title  } ${  description}`;

  // Look for percentage patterns
  const patterns = [
    /(\d+(?:\.\d+)?)\s*%\s*(?:tariff|duty|levy)/i,
    /tariff\s*(?:of|at)?\s*(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*percent\s*(?:tariff|duty)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseFloat(match[1]);
    }
  }

  return undefined;
}

/**
 * Extract effective date from text
 */
function extractEffectiveDate(title: string, description: string): string | undefined {
  const text = `${title  } ${  description}`;

  // Look for date patterns
  const patterns = [
    /effective\s+(?:on\s+)?(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(?:starting|beginning)\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(?:from|on)\s+(\d{1,2}\s+\w+\s+\d{4})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        const date = new Date(match[1]);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      } catch {
        // Invalid date, continue
      }
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
