import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { limitEvents, getFilterSummary } from './output-limiter.js';
import { toolLoggers } from './tool-logger.js';

const logger = toolLoggers.newsSocialMedia;

/**
 * News & Social Media Monitor Tool
 *
 * Purpose: Monitor news articles and social media for early warning signals of supply chain disruptions.
 *
 * Data Sources:
 * - TheNewsAPI: Global news articles with geographic filtering
 *   API: https://www.thenewsapi.com/documentation
 * - TwitterAPI.io: Real-time social media signals
 *   API: https://docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search
 *
 * Geographic Filtering Priority:
 * 1. Monitoring Plan: If a plan is provided with specific regions, use those
 * 2. ERP Locations Fallback: Extract countries from plants, warehouses, suppliers, shipping lanes
 *
 * Risk Categories:
 * - Breaking News on Disruptions
 * - Social Media Early Warnings
 * - Viral Supply Chain Issues
 * - Public Sentiment Shifts
 * - Industry Announcements
 *
 * Organization Isolation: Filters based on organization's keywords and geographic exposure
 */

// Environment variable names
const THENEWSAPI_KEY = process.env.THENEWSAPI_API_KEY;
const TWITTERAPIIO_KEY = process.env.TWITTERAPIIO_API_KEY;

/**
 * Domains excluded from news monitoring because they publish opinion/editorial
 * content rather than reported news (#22) — TheNewsAPI has no source-quality
 * signal of its own, so nothing stopped an opinion outlet from being treated
 * as a raw event source. `article.source` (TheNewsAPIArticle.source) is a
 * bare domain, matching this list's format.
 *
 * Curated against the company's approved-sources list (Notion: "Data
 * Sources" > Newswires — AA, AFP, ANP, ANSA, AP, BNO, DPA, EFE, JTA, KNW, PA,
 * Reuters). This is deliberately a small, sourced denylist rather than an
 * allowlist restricted to that newswire table: several of those wires'
 * TheNewsAPI-facing domains aren't confidently known, and a mistyped
 * allowlist entry fails silently (coverage just quietly narrows) whereas a
 * denylist miss is at least a bounded, visible gap. Add entries here as
 * further non-news sources are identified — do not restrict to only the
 * newswires above without confirming each one's actual TheNewsAPI domain.
 */
const EXCLUDED_NEWS_DOMAINS = ['zerohedge.com'];

// Geographic location schema for supply chain locations
const SupplyChainLocationSchema = z.object({
  name: z.string().describe('Location name (e.g., plant name, warehouse name)'),
  city: z.string().nullable().default(null),
  country: z.string().describe('Country name'),
  country_code: z.string().length(2).nullable().default(null).describe('ISO 3166-1 alpha-2 country code'),
  latitude: z.number().nullable().default(null),
  longitude: z.number().nullable().default(null)
});

// Monitoring plan schema for region-specific monitoring
const MonitoringPlanSchema = z.object({
  plan_id: z.string().nullable().default(null).describe('Unique plan identifier'),
  plan_name: z.string().nullable().default(null).describe('Human-readable plan name'),
  regions: z.array(z.object({
    country: z.string().describe('Country name'),
    country_code: z.string().length(2).nullable().default(null).describe('ISO 3166-1 alpha-2 country code'),
    priority: z.enum(['high', 'medium', 'low']).nullable().default(null).describe('Monitoring priority for this region')
  })).describe('Specific regions to monitor from the plan'),
  keywords: z.array(z.string()).nullable().default(null).describe('Plan-specific keywords to add')
});

const KeywordInputSchema = z.object({
  keyword: z.string().min(1),
  category: z.string().nullable().optional().describe('Category tag (e.g., supplier_name, port_name, product). Pass null or omit if no category.')
});

const MediaEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // news_article, social_post, breaking_news, trending_topic
  source_type: z.enum(['news', 'twitter', 'reddit']),
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1),
  sentiment: z.number().min(-1).max(1).describe('Sentiment: -1 (very negative) to +1 (very positive)'),
  author: z.string().optional(),
  published_at: z.string(),
  url: z.string().url().optional(),
  engagement_metrics: z.object({
    views: z.number().int().optional(),
    shares: z.number().int().optional(),
    likes: z.number().int().optional(),
    retweets: z.number().int().optional()
  }).optional(),
  matched_keywords: z.array(z.string()),
  raw_data: z.record(z.string(), z.any()).optional()
});

export const newsSocialMediaMonitorTool = createTool({
  id: 'news-social-media-monitor',
  description: 'Monitor news articles and social media (X/Twitter) for early warning signals of supply chain disruptions, breaking news, viral issues, and industry announcements using TheNewsAPI and TwitterAPI.io.',

  inputSchema: z.object({
    keywords: z.array(KeywordInputSchema).min(1).describe('Keywords to monitor (suppliers, ports, products, etc.)'),
    sources: z.array(z.enum(['news', 'twitter'])).default(['news', 'twitter']).describe('Data sources to query'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    sentiment_threshold: z.number().min(-1).max(1).default(-0.3).describe('Report if sentiment below this threshold'),
    lookback_hours: z.number().int().min(1).max(168).default(24).describe('How many hours back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (required)'),
    // Geographic filtering - Priority: monitoring_plan > supply_chain_locations
    // Using .default(null).nullable() to make these truly optional in JSON Schema for OpenAI
    monitoring_plan: MonitoringPlanSchema.nullable().default(null).describe('Monitoring plan with specific regions to focus on (takes priority over supply chain locations). Pass null if not using a plan.'),
    supply_chain_locations: z.array(SupplyChainLocationSchema).nullable().default(null).describe('Fallback: Supply chain locations (plants, warehouses, suppliers) for geographic filtering when no plan is provided. Pass null to monitor globally.')
  }),

  outputSchema: z.object({
    media_events: z.array(MediaEventSchema).describe('Detected news and social media events'),
    news_count: z.number().int().describe('Number of news articles found'),
    social_count: z.number().int().describe('Number of social media posts found'),
    high_severity_count: z.number().int().describe('Number of high severity events'),
    api_calls_made: z.number().int().describe('Number of API calls made to data sources'),
    // Geographic filtering info
    regions_monitored: z.array(z.string()).describe('Country codes that were monitored'),
    region_source: z.enum(['monitoring_plan', 'supply_chain_locations', 'global']).describe('Source of geographic regions used')
  }),

  execute: async ({ context }) => {
    const {
      keywords,
      sources,
      severity_threshold,
      sentiment_threshold,
      lookback_hours,
      organization_id,
      monitoring_plan,
      supply_chain_locations
    } = context;

    // Log the input parameters received
    logger.debug({ context }, 'Tool executed with context');

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for news/social media monitoring');
    }

    // Determine geographic regions to monitor
    // Priority: 1. monitoring_plan, 2. supply_chain_locations, 3. global (no filter)
    let regionsMonitored: string[] = [];
    let regionSource: 'monitoring_plan' | 'supply_chain_locations' | 'global' = 'global';

    if (monitoring_plan?.regions && monitoring_plan.regions.length > 0) {
      // Use monitoring plan regions (highest priority)
      regionsMonitored = extractCountryCodesFromPlan(monitoring_plan.regions);
      regionSource = 'monitoring_plan';
      logger.info({ planName: monitoring_plan.plan_name, planId: monitoring_plan.plan_id, regions: regionsMonitored }, 'Using monitoring plan with regions');
    } else if (supply_chain_locations && supply_chain_locations.length > 0) {
      // Fallback to supply chain locations
      regionsMonitored = extractCountryCodesFromLocations(supply_chain_locations);
      regionSource = 'supply_chain_locations';
      logger.info({ regions: regionsMonitored }, 'Using supply chain locations with regions');
    } else {
      // No geographic filter - monitor globally
      logger.info('No geographic regions specified, monitoring globally');
    }

    logger.info({ keywordCount: keywords.length, organizationId: organization_id, regions: regionsMonitored.length > 0 ? regionsMonitored : ['global'] }, 'Starting monitoring');

    try {
      const mediaEvents: Array<z.infer<typeof MediaEventSchema>> = [];
      let apiCallsMade = 0;
      let newsCount = 0;
      let socialCount = 0;
      let highSeverityCount = 0;

      const severityThresholdValue = severity_threshold === 'low' ? 0.3 : severity_threshold === 'medium' ? 0.5 : 0.7;

      // Fetch news from TheNewsAPI with geographic filtering
      if (sources.includes('news')) {
        const newsEvents = await fetchNewsArticles(keywords, lookback_hours, sentiment_threshold, regionsMonitored);
        const filteredNews = newsEvents.filter(e => e.severity >= severityThresholdValue);
        mediaEvents.push(...filteredNews);
        newsCount = filteredNews.length;
        apiCallsMade += 1; // TheNewsAPI supports multiple keywords in one query
        highSeverityCount += filteredNews.filter(e => e.severity >= 0.7).length;
      }

      // Fetch tweets from TwitterAPI.io
      if (sources.includes('twitter')) {
        const twitterEvents = await fetchTwitterPosts(keywords, lookback_hours, sentiment_threshold);
        const filteredTweets = twitterEvents.filter(e => e.severity >= severityThresholdValue);
        mediaEvents.push(...filteredTweets);
        socialCount = filteredTweets.length;
        apiCallsMade += 1;
        highSeverityCount += filteredTweets.filter(e => e.severity >= 0.7).length;
      }

      // Limit output to prevent context overflow
      const MAX_EVENTS = 10;
      const limitedEvents = limitEvents(mediaEvents, MAX_EVENTS);
      logger.info({ totalEvents: mediaEvents.length, limitedEvents: limitedEvents.length }, getFilterSummary(mediaEvents.length, limitedEvents.length, 'News/Social Monitor'));
      logger.info({ newsCount, socialCount, apiCallsMade, regions: regionsMonitored.length > 0 ? regionsMonitored : ['global'] }, 'Monitoring completed');

      return {
        media_events: limitedEvents,
        news_count: newsCount,
        social_count: socialCount,
        high_severity_count: highSeverityCount,
        api_calls_made: apiCallsMade,
        regions_monitored: regionsMonitored,
        region_source: regionSource
      };

    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch media data');
      throw new Error(`News/social media monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Helper Functions - Real API Integrations
// ============================================================================

// Type definitions for API responses
interface TheNewsAPIArticle {
  uuid: string;
  title: string;
  description: string;
  keywords: string;
  snippet: string;
  url: string;
  image_url: string;
  published_at: string;
  source: string;
  language: string;
  categories: string[];
  relevance_score?: number;
}

interface TheNewsAPIResponse {
  meta: { found: number; returned: number; limit: number; page: number };
  data: TheNewsAPIArticle[];
}

interface TwitterAPITweet {
  id: string;
  text: string;
  createdAt: string;
  lang: string;
  retweetCount: number;
  replyCount: number;
  likeCount: number;
  quoteCount: number;
  viewCount: number;
  bookmarkCount: number;
  author: {
    userName: string;
    name: string;
    isBlueVerified: boolean;
    profilePicture: string;
    followers: number;
    following: number;
  };
}

interface TwitterAPIResponse {
  tweets: TwitterAPITweet[];
  has_next_page: boolean;
  next_cursor?: string;
}

/**
 * Fetch news articles from TheNewsAPI with geographic filtering
 * API Docs: https://www.thenewsapi.com/documentation
 *
 * @param keywords - Keywords to search for
 * @param lookbackHours - Hours to look back
 * @param sentimentThreshold - Minimum sentiment threshold
 * @param regions - Array of country codes (ISO 3166-1 alpha-2) to filter by
 */
async function fetchNewsArticles(
  keywords: Array<{ keyword: string; category?: string | null }>,
  lookbackHours: number,
  sentimentThreshold: number,
  regions: string[] = []
): Promise<Array<z.infer<typeof MediaEventSchema>>> {
  if (!THENEWSAPI_KEY) {
    logger.warn('THENEWSAPI_API_KEY not set, skipping news check');
    return [];
  }

  const events: Array<z.infer<typeof MediaEventSchema>> = [];
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackHours * 60 * 60 * 1000);

  // Build search query with OR operator for multiple keywords
  const searchQuery = keywords.map(k => k.keyword).join(' | ');

  try {
    const url = new URL('https://api.thenewsapi.com/v1/news/all');
    url.searchParams.set('api_token', THENEWSAPI_KEY);
    url.searchParams.set('search', searchQuery);
    url.searchParams.set('published_after', startDate.toISOString().split('T')[0]);
    url.searchParams.set('published_before', endDate.toISOString().split('T')[0]);
    url.searchParams.set('language', 'en');
    url.searchParams.set('limit', '50');
    // Focus on business/tech categories for supply chain relevance
    url.searchParams.set('categories', 'business,tech,general');
    // Opinion/editorial sources aren't raw news (#22) — exclude at the API
    // level so they never consume a result slot in the first place.
    url.searchParams.set('exclude_domains', EXCLUDED_NEWS_DOMAINS.join(','));

    // Apply geographic filtering if regions are specified
    // TheNewsAPI uses 'locale' parameter with comma-separated country codes
    if (regions.length > 0) {
      // Convert country codes to lowercase as TheNewsAPI expects lowercase locale codes
      const locales = regions.map(r => r.toLowerCase()).join(',');
      url.searchParams.set('locale', locales);
      logger.info({ searchQuery, locales }, 'Fetching news with region filter');
    } else {
      logger.info({ searchQuery }, 'Fetching news globally (no region filter)');
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15000), // 15 second timeout
    });

    if (!response.ok) {
      logger.error({ status: response.status, statusText: response.statusText }, 'TheNewsAPI error');
      return [];
    }

    const data = await response.json() as TheNewsAPIResponse;

    if (!data.data || !Array.isArray(data.data)) {
      logger.warn('No articles returned from TheNewsAPI');
      return [];
    }

    logger.info({ articleCount: data.data.length }, 'Found articles from TheNewsAPI');

    for (const article of data.data) {
      // Defense in depth: exclude_domains above should already have kept
      // these out, but don't rely solely on an external API honoring a
      // request param (#22) — check the actual returned source too.
      const sourceDomain = (article.source || '').toLowerCase();
      if (EXCLUDED_NEWS_DOMAINS.some(d => sourceDomain === d || sourceDomain.endsWith(`.${d}`))) {
        continue;
      }

      // Perform sentiment analysis on title + description
      const sentiment = analyzeSentiment(article.title, article.description);

      // Only include if sentiment is below threshold (negative news)
      if (sentiment > sentimentThreshold) continue;

      // Find which keywords matched
      const matchedKeywords = keywords
        .filter(k =>
          article.title?.toLowerCase().includes(k.keyword.toLowerCase()) ||
          article.description?.toLowerCase().includes(k.keyword.toLowerCase())
        )
        .map(k => k.keyword);

      if (matchedKeywords.length === 0) continue;

      const severity = calculateNewsSeverity(sentiment, article);

      events.push({
        event_id: `news-${article.uuid}`,
        event_type: 'news_article',
        source_type: 'news',
        title: article.title || '',
        description: article.description || article.snippet || '',
        severity,
        sentiment,
        author: article.source,
        published_at: article.published_at,
        url: article.url,
        matched_keywords: matchedKeywords,
        raw_data: article
      });
    }
  } catch (err) {
    logger.error({ err }, 'Error fetching news');
  }

  return events;
}

/**
 * Fetch tweets from TwitterAPI.io with retry logic
 * API Docs: https://docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search
 */
async function fetchTwitterPosts(
  keywords: Array<{ keyword: string; category?: string | null }>,
  lookbackHours: number,
  sentimentThreshold: number
): Promise<Array<z.infer<typeof MediaEventSchema>>> {
  if (!TWITTERAPIIO_KEY) {
    logger.warn('TWITTERAPIIO_API_KEY not set, skipping Twitter check');
    return [];
  }

  const events: Array<z.infer<typeof MediaEventSchema>> = [];

  // Build search query - combine keywords with OR
  // Add supply chain context to improve relevance
  const keywordQuery = keywords.map(k => k.keyword).join(' OR ');
  const searchQuery = `(${keywordQuery}) (supply chain OR logistics OR shipping OR disruption OR delay)`;

  // Retry configuration
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = new URL('https://api.twitterapi.io/twitter/tweet/advanced_search');
      url.searchParams.set('query', searchQuery);
      url.searchParams.set('queryType', 'Latest');

      if (attempt === 0) {
        logger.info({ searchQuery: searchQuery.substring(0, 100) }, 'Searching tweets');
      } else {
        logger.info({ attempt, maxRetries: MAX_RETRIES }, 'Retry attempt');
      }

      const response = await fetch(url.toString(), {
        headers: {
          'X-API-Key': TWITTERAPIIO_KEY,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(15000) // 15 second timeout
      });

      if (!response.ok) {
        const statusCode = response.status;
        logger.error({ status: statusCode, statusText: response.statusText }, 'TwitterAPI.io error');

        // Don't retry on client errors (4xx), only server errors (5xx)
        if (statusCode >= 500 && attempt < MAX_RETRIES) {
          logger.info({ statusCode, retryDelayMs: RETRY_DELAY_MS * (attempt + 1) }, 'Server error, will retry');
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }

        // Log but don't fail - return empty results
        logger.warn({ statusCode }, 'TwitterAPI.io unavailable, skipping Twitter results');
        return [];
      }

    const data = await response.json() as TwitterAPIResponse;

    if (!data.tweets || !Array.isArray(data.tweets)) {
      logger.warn('No tweets returned from TwitterAPI.io');
      return [];
    }

    logger.info({ tweetCount: data.tweets.length }, 'Found tweets from TwitterAPI.io');

    // Filter by lookback period
    const cutoffDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    for (const tweet of data.tweets) {
      const tweetDate = new Date(tweet.createdAt);
      if (tweetDate < cutoffDate) continue;

      // Perform sentiment analysis
      const sentiment = analyzeSentiment(tweet.text);

      // Only include if sentiment is below threshold (negative posts)
      if (sentiment > sentimentThreshold) continue;

      // Find which keywords matched
      const matchedKeywords = keywords
        .filter(k => tweet.text.toLowerCase().includes(k.keyword.toLowerCase()))
        .map(k => k.keyword);

      if (matchedKeywords.length === 0) continue;

      const severity = calculateSocialSeverity(sentiment, tweet);

      events.push({
        event_id: `twitter-${tweet.id}`,
        event_type: tweet.retweetCount > 1000 ? 'trending_topic' : 'social_post',
        source_type: 'twitter',
        title: tweet.text.substring(0, 100) + (tweet.text.length > 100 ? '...' : ''),
        description: tweet.text,
        severity,
        sentiment,
        author: `@${tweet.author.userName}`,
        published_at: tweet.createdAt,
        url: `https://twitter.com/${tweet.author.userName}/status/${tweet.id}`,
        engagement_metrics: {
          views: tweet.viewCount,
          retweets: tweet.retweetCount,
          likes: tweet.likeCount,
          shares: tweet.quoteCount
        },
        matched_keywords: matchedKeywords,
        raw_data: tweet
      });
    }

      // Success - break out of retry loop
      break;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      // Check if it's a timeout or network error (worth retrying)
      const isRetryable = errorMessage.includes('timeout') ||
                          errorMessage.includes('network') ||
                          errorMessage.includes('ECONNREFUSED') ||
                          errorMessage.includes('ENOTFOUND');

      if (isRetryable && attempt < MAX_RETRIES) {
        logger.warn({ errorMessage, retryDelayMs: RETRY_DELAY_MS * (attempt + 1) }, 'Request failed, retrying');
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }

      logger.error({ attempts: attempt + 1, errorMessage }, 'Error fetching tweets after retries');
    }
  }

  return events;
}

// ============================================================================
// Sentiment Analysis & Severity Calculation
// ============================================================================

// Supply chain specific negative keywords
const NEGATIVE_KEYWORDS = [
  // Disruption terms
  'disruption', 'disrupted', 'delay', 'delayed', 'shortage', 'shortages',
  'crisis', 'shutdown', 'closure', 'closed', 'halt', 'halted', 'suspend', 'suspended',
  // Incident terms
  'strike', 'protest', 'fire', 'explosion', 'accident', 'collision', 'derailment',
  'bankruptcy', 'bankrupt', 'insolvent', 'default',
  // Quality issues
  'recall', 'contamination', 'contaminated', 'defect', 'defective', 'failure',
  // Security issues
  'cyberattack', 'ransomware', 'breach', 'hacked', 'outage',
  // Weather/disaster
  'hurricane', 'typhoon', 'earthquake', 'flood', 'flooding', 'storm',
  // Trade issues
  'tariff', 'sanction', 'embargo', 'ban', 'restriction', 'blocked'
];

const POSITIVE_KEYWORDS = [
  'resolved', 'restored', 'recovery', 'recovered', 'improvement', 'improved',
  'expansion', 'expanded', 'investment', 'growth', 'partnership', 'reopened',
  'resumed', 'normalized', 'stable', 'stabilized'
];

// Major news sources get higher weight
const MAJOR_NEWS_SOURCES = [
  'reuters', 'bloomberg', 'wsj', 'financial times', 'cnbc', 'bbc',
  'associated press', 'afp', 'nytimes', 'washington post'
];

/**
 * Perform keyword-based sentiment analysis
 * Returns: -1.0 (very negative) to +1.0 (very positive)
 */
function analyzeSentiment(title: string, description?: string): number {
  const text = `${title || ''} ${description || ''}`.toLowerCase();

  let score = 0;

  // Check negative keywords
  for (const word of NEGATIVE_KEYWORDS) {
    if (text.includes(word)) {
      score -= 0.15;
    }
  }

  // Check positive keywords
  for (const word of POSITIVE_KEYWORDS) {
    if (text.includes(word)) {
      score += 0.1;
    }
  }

  // Clamp to [-1, 1]
  return Math.max(-1, Math.min(1, score));
}

/**
 * Calculate severity for news article based on sentiment, source, and content
 * Returns: 0.0 (minimal) to 1.0 (critical)
 */
function calculateNewsSeverity(sentiment: number, article: TheNewsAPIArticle): number {
  let severity = Math.abs(sentiment);

  // Boost severity for major news sources
  const sourceLower = (article.source || '').toLowerCase();
  if (MAJOR_NEWS_SOURCES.some(s => sourceLower.includes(s))) {
    severity += 0.2;
  }

  // Boost for high relevance score
  if (article.relevance_score && article.relevance_score > 50) {
    severity += 0.1;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, severity));
}

/**
 * Calculate severity for social media post based on sentiment and engagement
 * Returns: 0.0 (minimal) to 1.0 (critical)
 */
function calculateSocialSeverity(sentiment: number, tweet: TwitterAPITweet): number {
  let severity = Math.abs(sentiment);

  // Boost for high engagement
  const totalEngagement = (tweet.retweetCount || 0) + (tweet.likeCount || 0) + (tweet.quoteCount || 0);

  if (totalEngagement > 10000) {
    severity += 0.3; // Viral
  } else if (totalEngagement > 1000) {
    severity += 0.2; // High engagement
  } else if (totalEngagement > 100) {
    severity += 0.1; // Moderate engagement
  }

  // Boost for verified accounts
  if (tweet.author?.isBlueVerified) {
    severity += 0.1;
  }

  // Boost for accounts with large following
  if (tweet.author?.followers > 100000) {
    severity += 0.15;
  } else if (tweet.author?.followers > 10000) {
    severity += 0.05;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, severity));
}

// ============================================================================
// Geographic Region Extraction Helpers
// ============================================================================

// Common country name to ISO 3166-1 alpha-2 code mapping
const COUNTRY_CODE_MAP: Record<string, string> = {
  'united states': 'US', 'usa': 'US', 'us': 'US', 'america': 'US',
  'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB', 'england': 'GB',
  'china': 'CN', 'prc': 'CN',
  'japan': 'JP',
  'germany': 'DE',
  'france': 'FR',
  'italy': 'IT',
  'spain': 'ES',
  'canada': 'CA',
  'australia': 'AU',
  'india': 'IN',
  'brazil': 'BR',
  'mexico': 'MX',
  'south korea': 'KR', 'korea': 'KR',
  'taiwan': 'TW',
  'vietnam': 'VN',
  'thailand': 'TH',
  'indonesia': 'ID',
  'malaysia': 'MY',
  'singapore': 'SG',
  'philippines': 'PH',
  'bangladesh': 'BD',
  'pakistan': 'PK',
  'turkey': 'TR',
  'netherlands': 'NL', 'holland': 'NL',
  'belgium': 'BE',
  'switzerland': 'CH',
  'sweden': 'SE',
  'poland': 'PL',
  'hong kong': 'HK',
  'sri lanka': 'LK',
  'cambodia': 'KH',
  'egypt': 'EG',
  'south africa': 'ZA',
  'uae': 'AE', 'united arab emirates': 'AE',
  'saudi arabia': 'SA',
  'russia': 'RU',
  'ukraine': 'UA',
  'argentina': 'AR',
  'chile': 'CL',
  'colombia': 'CO',
  'peru': 'PE',
  'portugal': 'PT',
  'austria': 'AT',
  'ireland': 'IE',
  'denmark': 'DK',
  'norway': 'NO',
  'finland': 'FI',
  'czech republic': 'CZ', 'czechia': 'CZ',
  'hungary': 'HU',
  'romania': 'RO',
  'greece': 'GR',
  'israel': 'IL',
  'new zealand': 'NZ',
  'myanmar': 'MM', 'burma': 'MM',
  'laos': 'LA',
  'panama': 'PA',
  'costa rica': 'CR',
  'honduras': 'HN',
  'guatemala': 'GT',
  'el salvador': 'SV',
  'nicaragua': 'NI',
  'haiti': 'HT',
  'dominican republic': 'DO',
  'puerto rico': 'PR',
  'morocco': 'MA',
  'tunisia': 'TN',
  'kenya': 'KE',
  'nigeria': 'NG',
  'ethiopia': 'ET',
  'jordan': 'JO',
  'lebanon': 'LB',
  'qatar': 'QA',
  'kuwait': 'KW',
  'bahrain': 'BH',
  'oman': 'OM'
};

/**
 * Extract country codes from monitoring plan regions
 *
 * @param regions - Array of region objects from monitoring plan
 * @returns Array of unique ISO 3166-1 alpha-2 country codes
 */
function extractCountryCodesFromPlan(
  regions: Array<{ country: string; country_code?: string | null; priority?: string | null }>
): string[] {
  const codes = new Set<string>();

  for (const region of regions) {
    if (region.country_code?.length === 2) {
      // Use provided country code
      codes.add(region.country_code.toUpperCase());
    } else if (region.country) {
      // Try to map country name to code
      const normalizedCountry = region.country.toLowerCase().trim();
      const code = COUNTRY_CODE_MAP[normalizedCountry];
      if (code) {
        codes.add(code);
      } else {
        logger.warn({ country: region.country }, 'Could not map country to code');
      }
    }
  }

  return Array.from(codes);
}

/**
 * Extract country codes from supply chain locations (plants, warehouses, suppliers)
 *
 * @param locations - Array of supply chain location objects
 * @returns Array of unique ISO 3166-1 alpha-2 country codes
 */
function extractCountryCodesFromLocations(
  locations: Array<{ name: string; city?: string | null; country: string; country_code?: string | null; latitude?: number | null; longitude?: number | null }>
): string[] {
  const codes = new Set<string>();

  for (const location of locations) {
    if (location.country_code?.length === 2) {
      // Use provided country code
      codes.add(location.country_code.toUpperCase());
    } else if (location.country) {
      // Try to map country name to code
      const normalizedCountry = location.country.toLowerCase().trim();
      const code = COUNTRY_CODE_MAP[normalizedCountry];
      if (code) {
        codes.add(code);
      } else {
        logger.warn({ country: location.country, locationName: location.name }, 'Could not map country to code');
      }
    }
  }

  return Array.from(codes);
}
