/**
 * Data Source Tool Configuration Definitions
 *
 * This file defines all available monitoring tools organized by data source category.
 * Used for:
 * - Seeding default configurations for new organizations
 * - Displaying available tools in the UI
 * - Validating tool configuration updates
 */

export type DataSourceCategory =
  | 'weather'
  | 'political'
  | 'cybersecurity'
  | 'economic'
  | 'news'
  | 'maritime'
  | 'labor'
  | 'regulatory'
  | 'pandemic'
  | 'geopolitical';

export interface ToolConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'select';
  description: string;
  default: string | number | boolean | string[];
  options?: Array<{ value: string; label: string }>; // For select type
  min?: number; // For number type
  max?: number; // For number type
  required?: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  documentationUrl?: string;
  apiKeyEnvVar?: string;
  apiKeyLabel?: string; // Human-readable label for the API key field
  requiresApiKey?: boolean; // Whether this tool requires an API key to function
  defaultEnabled: boolean;
  defaultTimeoutMs: number;
  defaultSeverityThreshold: number;
  defaultLookbackHours: number;
  configFields: ToolConfigField[];
}

export interface DataSourceDefinition {
  id: DataSourceCategory;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  tools: ToolDefinition[];
}

// ============================================================================
// WEATHER & NATURAL DISASTERS
// ============================================================================
const weatherTools: ToolDefinition[] = [
  {
    id: 'noaa',
    name: 'NOAA Weather API',
    description: 'National Oceanic and Atmospheric Administration weather alerts and forecasts',
    documentationUrl: 'https://www.weather.gov/documentation/services-web-api',
    requiresApiKey: false, // NOAA API is free and does not require a key
    defaultEnabled: true,
    defaultTimeoutMs: 10000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 24,
    configFields: [
      {
        key: 'proximity_radius_km',
        label: 'Proximity Radius (km)',
        type: 'number',
        description: 'Maximum distance from supply chain assets to include alerts',
        default: 500,
        min: 50,
        max: 2000,
      },
      {
        key: 'alert_types',
        label: 'Alert Types',
        type: 'string[]',
        description: 'Types of weather alerts to monitor',
        default: ['Hurricane', 'Tornado', 'Flood', 'Winter Storm', 'Severe Thunderstorm'],
      },
    ],
  },
  {
    id: 'eonet',
    name: 'NASA EONET',
    description: 'NASA Earth Observatory Natural Event Tracker for natural disasters',
    documentationUrl: 'https://eonet.gsfc.nasa.gov/docs/v3',
    requiresApiKey: false, // NASA EONET API is free and does not require a key
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 72,
    configFields: [
      {
        key: 'proximity_radius_km',
        label: 'Proximity Radius (km)',
        type: 'number',
        description: 'Maximum distance from supply chain assets to include events',
        default: 500,
        min: 50,
        max: 2000,
      },
      {
        key: 'event_categories',
        label: 'Event Categories',
        type: 'string[]',
        description: 'EONET event categories to monitor',
        default: ['wildfires', 'severeStorms', 'volcanoes', 'earthquakes', 'floods'],
      },
      {
        key: 'min_magnitude',
        label: 'Minimum Magnitude (Earthquakes)',
        type: 'number',
        description: 'Minimum earthquake magnitude to report',
        default: 4.0,
        min: 1.0,
        max: 10.0,
      },
    ],
  },
  {
    id: 'openweather',
    name: 'OpenWeather API',
    description: 'Global weather data and severe weather alerts from OpenWeather',
    documentationUrl: 'https://openweathermap.org/api',
    apiKeyEnvVar: 'OPENWEATHER_API_KEY',
    apiKeyLabel: 'OpenWeather API Key',
    requiresApiKey: true,
    defaultEnabled: false,
    defaultTimeoutMs: 10000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 24,
    configFields: [
      {
        key: 'proximity_radius_km',
        label: 'Proximity Radius (km)',
        type: 'number',
        description: 'Maximum distance from supply chain assets to include alerts',
        default: 500,
        min: 50,
        max: 2000,
      },
      {
        key: 'alert_types',
        label: 'Alert Types',
        type: 'string[]',
        description: 'Types of weather alerts to monitor',
        default: ['extreme', 'severe', 'warning', 'watch'],
      },
      {
        key: 'include_forecast',
        label: 'Include Forecast Data',
        type: 'boolean',
        description: 'Include 5-day forecast data for risk assessment',
        default: true,
      },
    ],
  },
];

// ============================================================================
// POLITICAL RISK
// ============================================================================
const politicalTools: ToolDefinition[] = [
  {
    id: 'gdelt_political',
    name: 'GDELT Political Monitor',
    description: 'Global Database of Events, Language, and Tone for political instability',
    documentationUrl: 'http://data.gdeltproject.org/gdeltv2',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 24,
    configFields: [
      {
        key: 'search_terms',
        label: 'Search Terms',
        type: 'string[]',
        description: 'Keywords to search for political events',
        default: [
          'political instability',
          'government collapse',
          'coup attempt',
          'mass protests',
          'civil unrest',
          'state of emergency',
        ],
      },
      {
        key: 'country_filters',
        label: 'Country Filters',
        type: 'string[]',
        description: 'ISO country codes to focus on (empty for all)',
        default: [],
      },
      {
        key: 'min_article_count',
        label: 'Minimum Article Count',
        type: 'number',
        description: 'Minimum number of articles for event to be significant',
        default: 5,
        min: 1,
        max: 100,
      },
    ],
  },
];

// ============================================================================
// CYBERSECURITY
// ============================================================================
const cybersecurityTools: ToolDefinition[] = [
  {
    id: 'nvd',
    name: 'NVD Vulnerability Database',
    description: 'NIST National Vulnerability Database for CVE monitoring',
    documentationUrl: 'https://services.nvd.nist.gov/rest/json/cves/2.0',
    apiKeyEnvVar: 'NVD_API_KEY',
    apiKeyLabel: 'NVD API Key',
    requiresApiKey: false, // Works without key but rate-limited
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.7,
    defaultLookbackHours: 24,
    configFields: [
      {
        key: 'min_cvss_score',
        label: 'Minimum CVSS Score',
        type: 'number',
        description: 'Minimum CVSS score to report (0-10)',
        default: 7.0,
        min: 0,
        max: 10,
      },
      {
        key: 'vendor_filters',
        label: 'Vendor Filters',
        type: 'string[]',
        description: 'Specific vendors to monitor (empty for all)',
        default: [],
      },
      {
        key: 'cwe_filters',
        label: 'CWE Filters',
        type: 'string[]',
        description: 'Specific CWE IDs to monitor (empty for all)',
        default: [],
      },
    ],
  },
  {
    id: 'cisa',
    name: 'CISA Security Alerts',
    description: 'Cybersecurity and Infrastructure Security Agency alerts via RSS',
    documentationUrl: 'https://www.cisa.gov/news-events/cybersecurity-advisories',
    defaultEnabled: true,
    defaultTimeoutMs: 10000,
    defaultSeverityThreshold: 0.6,
    defaultLookbackHours: 48,
    configFields: [
      {
        key: 'feed_urls',
        label: 'RSS Feed URLs',
        type: 'string[]',
        description: 'CISA RSS feed URLs to monitor',
        default: [
          'https://www.cisa.gov/cybersecurity-advisories/all.xml',
          'https://www.cisa.gov/news.xml',
        ],
      },
      {
        key: 'keyword_filters',
        label: 'Keyword Filters',
        type: 'string[]',
        description: 'Keywords to filter alerts (empty for all)',
        default: ['critical', 'emergency', 'actively exploited'],
      },
    ],
  },
];

// ============================================================================
// ECONOMIC & FINANCIAL
// ============================================================================
const economicTools: ToolDefinition[] = [
  {
    id: 'fred',
    name: 'FRED Economic Data',
    description: 'Federal Reserve Economic Data for market indicators',
    documentationUrl: 'https://fred.stlouisfed.org/docs/api/fred/',
    apiKeyEnvVar: 'FRED_API_KEY',
    apiKeyLabel: 'FRED API Key',
    requiresApiKey: true,
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 168, // 1 week
    configFields: [
      {
        key: 'series_ids',
        label: 'FRED Series IDs',
        type: 'string[]',
        description: 'Economic indicator series to monitor',
        default: [
          'UNRATE', // Unemployment Rate
          'CPIAUCSL', // Consumer Price Index
          'GDP', // Gross Domestic Product
          'FEDFUNDS', // Federal Funds Rate
          'DGS10', // 10-Year Treasury Rate
        ],
      },
      {
        key: 'change_threshold_pct',
        label: 'Change Threshold (%)',
        type: 'number',
        description: 'Minimum percentage change to trigger alert',
        default: 5.0,
        min: 0.1,
        max: 50,
      },
    ],
  },
];

// ============================================================================
// NEWS & SOCIAL MEDIA
// ============================================================================
const newsTools: ToolDefinition[] = [
  {
    id: 'thenewsapi',
    name: 'TheNewsAPI',
    description: 'Real-time news aggregation from global sources',
    documentationUrl: 'https://www.thenewsapi.com/documentation',
    apiKeyEnvVar: 'THENEWSAPI_API_KEY',
    apiKeyLabel: 'TheNewsAPI Key',
    requiresApiKey: true,
    defaultEnabled: true,
    defaultTimeoutMs: 10000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 24,
    configFields: [
      {
        key: 'search_keywords',
        label: 'Search Keywords',
        type: 'string[]',
        description: 'Keywords to search for supply chain news',
        default: [
          'supply chain disruption',
          'port closure',
          'factory shutdown',
          'shipping delay',
          'logistics crisis',
        ],
      },
      {
        key: 'categories',
        label: 'News Categories',
        type: 'string[]',
        description: 'News categories to monitor',
        default: ['business', 'politics', 'science'],
      },
      {
        key: 'language',
        label: 'Language',
        type: 'select',
        description: 'Language filter for news articles',
        default: 'en',
        options: [
          { value: 'en', label: 'English' },
          { value: 'es', label: 'Spanish' },
          { value: 'fr', label: 'French' },
          { value: 'de', label: 'German' },
          { value: 'zh', label: 'Chinese' },
        ],
      },
    ],
  },
  {
    id: 'twitter',
    name: 'X/Twitter Monitor',
    description: 'Social media monitoring via X/Twitter API',
    documentationUrl: 'https://docs.twitterapi.io/introduction',
    apiKeyEnvVar: 'TWITTERAPIIO_API_KEY',
    apiKeyLabel: 'Twitter API.io Key',
    requiresApiKey: true,
    defaultEnabled: false,
    defaultTimeoutMs: 10000,
    defaultSeverityThreshold: 0.4,
    defaultLookbackHours: 12,
    configFields: [
      {
        key: 'search_queries',
        label: 'Search Queries',
        type: 'string[]',
        description: 'Twitter search queries',
        default: [
          'supply chain',
          'port congestion',
          'shipping crisis',
          'factory fire',
        ],
      },
      {
        key: 'min_followers',
        label: 'Minimum Followers',
        type: 'number',
        description: 'Minimum follower count for source credibility',
        default: 1000,
        min: 0,
        max: 1000000,
      },
      {
        key: 'exclude_retweets',
        label: 'Exclude Retweets',
        type: 'boolean',
        description: 'Filter out retweets from results',
        default: true,
      },
    ],
  },
];

// ============================================================================
// MARITIME & LOGISTICS
// ============================================================================
const maritimeTools: ToolDefinition[] = [
  {
    id: 'maritime_rss',
    name: 'Maritime Industry RSS',
    description: 'Maritime news from industry publications',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 48,
    configFields: [
      {
        key: 'feed_urls',
        label: 'RSS Feed URLs',
        type: 'string[]',
        description: 'Maritime news RSS feeds to monitor',
        default: [
          'https://www.maritime-executive.com/rss',
          'https://gcaptain.com/feed/',
          'https://splash247.com/feed/',
        ],
      },
      {
        key: 'keyword_filters',
        label: 'Keyword Filters',
        type: 'string[]',
        description: 'Keywords to filter maritime news',
        default: [
          'port closure',
          'congestion',
          'strike',
          'grounding',
          'collision',
          'piracy',
          'canal',
        ],
      },
    ],
  },
  {
    id: 'gdelt_maritime',
    name: 'GDELT Maritime Events',
    description: 'GDELT monitoring for port and shipping disruptions',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 24,
    configFields: [
      {
        key: 'search_terms',
        label: 'Search Terms',
        type: 'string[]',
        description: 'Maritime-related search terms',
        default: [
          'port closure',
          'shipping disruption',
          'canal blocked',
          'maritime strike',
          'container shortage',
        ],
      },
      {
        key: 'major_ports',
        label: 'Major Ports to Monitor',
        type: 'string[]',
        description: 'Port names to specifically track',
        default: [
          'Shanghai',
          'Singapore',
          'Rotterdam',
          'Los Angeles',
          'Long Beach',
          'Busan',
          'Hong Kong',
        ],
      },
    ],
  },
];

// ============================================================================
// LABOR & SOCIAL
// ============================================================================
const laborTools: ToolDefinition[] = [
  {
    id: 'labor_rss',
    name: 'Labor News RSS',
    description: 'Labor union and workforce news feeds',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 48,
    configFields: [
      {
        key: 'feed_urls',
        label: 'RSS Feed URLs',
        type: 'string[]',
        description: 'Labor news RSS feeds to monitor',
        default: [
          'https://www.ilo.org/global/about-the-ilo/newsroom/news/rss.xml',
          'https://labornotes.org/rss.xml',
          'https://www.industriall-union.org/rss.xml',
          'https://aflcio.org/feed',
          'https://www.ituc-csi.org/rss',
        ],
      },
      {
        key: 'keyword_filters',
        label: 'Keyword Filters',
        type: 'string[]',
        description: 'Keywords to filter labor news',
        default: ['strike', 'walkout', 'labor dispute', 'union', 'protest', 'shutdown'],
      },
    ],
  },
  {
    id: 'gdelt_labor',
    name: 'GDELT Labor Events',
    description: 'GDELT monitoring for strikes and labor unrest',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 24,
    configFields: [
      {
        key: 'search_terms',
        label: 'Search Terms',
        type: 'string[]',
        description: 'Labor-related search terms',
        default: [
          'worker strike',
          'labor protest',
          'factory walkout',
          'union action',
          'wage dispute',
        ],
      },
      {
        key: 'industries',
        label: 'Industry Focus',
        type: 'string[]',
        description: 'Industries to monitor for labor issues',
        default: [
          'manufacturing',
          'logistics',
          'transportation',
          'ports',
          'warehousing',
        ],
      },
    ],
  },
];

// ============================================================================
// REGULATORY & TRADE
// ============================================================================
const regulatoryTools: ToolDefinition[] = [
  {
    id: 'trade_rss',
    name: 'Trade Policy RSS',
    description: 'Trade policy news from official sources',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 168, // 1 week
    configFields: [
      {
        key: 'feed_urls',
        label: 'RSS Feed URLs',
        type: 'string[]',
        description: 'Trade policy RSS feeds to monitor',
        default: [
          'https://www.wto.org/english/news_e/news_e.rss',
          'https://ustr.gov/rss.xml',
          'https://trade.ec.europa.eu/rss/news.xml',
        ],
      },
      {
        key: 'keyword_filters',
        label: 'Keyword Filters',
        type: 'string[]',
        description: 'Keywords to filter trade news',
        default: ['tariff', 'sanction', 'trade war', 'export ban', 'import restriction'],
      },
    ],
  },
  {
    id: 'gdelt_trade',
    name: 'GDELT Trade Events',
    description: 'GDELT monitoring for trade policy changes',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.5,
    defaultLookbackHours: 24,
    configFields: [
      {
        key: 'search_terms',
        label: 'Search Terms',
        type: 'string[]',
        description: 'Trade-related search terms',
        default: [
          'trade sanctions',
          'tariff increase',
          'export controls',
          'import ban',
          'trade agreement',
        ],
      },
      {
        key: 'country_pairs',
        label: 'Country Pairs to Monitor',
        type: 'string[]',
        description: 'Country pairs for trade relationship monitoring (e.g., "US-CN")',
        default: ['US-CN', 'US-EU', 'EU-CN', 'US-MX'],
      },
    ],
  },
];

// ============================================================================
// PANDEMIC & HEALTH
// ============================================================================
const pandemicTools: ToolDefinition[] = [
  {
    id: 'who_rss',
    name: 'WHO Disease Outbreaks',
    description: 'World Health Organization disease outbreak news',
    documentationUrl: 'https://www.who.int/news-room/events',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.6,
    defaultLookbackHours: 72,
    configFields: [
      {
        key: 'feed_urls',
        label: 'RSS Feed URLs',
        type: 'string[]',
        description: 'WHO RSS feeds to monitor',
        default: [
          'https://www.who.int/feeds/entity/csr/don/en/rss.xml',
          'https://www.who.int/feeds/entity/news/en/rss.xml',
        ],
      },
      {
        key: 'disease_filters',
        label: 'Disease Filters',
        type: 'string[]',
        description: 'Specific diseases to monitor (empty for all)',
        default: [],
      },
    ],
  },
  {
    id: 'cdc_rss',
    name: 'CDC Health Alerts',
    description: 'US Centers for Disease Control health alerts',
    documentationUrl: 'https://www.cdc.gov/rss/',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.6,
    defaultLookbackHours: 72,
    configFields: [
      {
        key: 'feed_urls',
        label: 'RSS Feed URLs',
        type: 'string[]',
        description: 'CDC RSS feeds to monitor',
        default: [
          'https://www2c.cdc.gov/podcasts/createrss.asp?c=146',
          'https://wwwnc.cdc.gov/travel/rss/notices.xml',
          'https://www.cdc.gov/outbreaks/feed/index.xml',
        ],
      },
      {
        key: 'alert_levels',
        label: 'Alert Levels',
        type: 'string[]',
        description: 'CDC alert levels to include',
        default: ['Warning', 'Alert', 'Watch'],
      },
    ],
  },
];

// ============================================================================
// GEOPOLITICAL & CONFLICT
// ============================================================================
const geopoliticalTools: ToolDefinition[] = [
  {
    id: 'gdelt_conflict',
    name: 'GDELT Conflict Monitor',
    description: 'GDELT monitoring for armed conflicts and geopolitical tensions',
    documentationUrl: 'http://data.gdeltproject.org/gdeltv2',
    defaultEnabled: true,
    defaultTimeoutMs: 15000,
    defaultSeverityThreshold: 0.6,
    defaultLookbackHours: 24,
    configFields: [
      {
        key: 'search_terms',
        label: 'Search Terms',
        type: 'string[]',
        description: 'Conflict-related search terms',
        default: [
          'armed conflict',
          'military action',
          'border dispute',
          'territorial conflict',
          'war',
          'invasion',
        ],
      },
      {
        key: 'conflict_regions',
        label: 'Conflict Regions',
        type: 'string[]',
        description: 'Regions to specifically monitor for conflicts',
        default: [],
      },
      {
        key: 'actor_filters',
        label: 'Actor Filters',
        type: 'string[]',
        description: 'Specific actors/countries to monitor',
        default: [],
      },
      {
        key: 'goldstein_threshold',
        label: 'Goldstein Score Threshold',
        type: 'number',
        description: 'Minimum absolute Goldstein scale score (-10 to +10)',
        default: -5,
        min: -10,
        max: 0,
      },
    ],
  },
];

// ============================================================================
// COMPLETE DATA SOURCE DEFINITIONS
// ============================================================================
export const DATA_SOURCE_DEFINITIONS: DataSourceDefinition[] = [
  {
    id: 'weather',
    name: 'Weather & Natural Disasters',
    description: 'Monitor severe weather events, earthquakes, wildfires, and other natural disasters',
    icon: 'Cloud',
    tools: weatherTools,
  },
  {
    id: 'political',
    name: 'Political Risk',
    description: 'Track political instability, government changes, and civil unrest',
    icon: 'Landmark',
    tools: politicalTools,
  },
  {
    id: 'cybersecurity',
    name: 'Cybersecurity',
    description: 'Monitor vulnerabilities, security advisories, and cyber threats',
    icon: 'Shield',
    tools: cybersecurityTools,
  },
  {
    id: 'economic',
    name: 'Economic & Financial',
    description: 'Track economic indicators, market conditions, and financial risks',
    icon: 'TrendingUp',
    tools: economicTools,
  },
  {
    id: 'news',
    name: 'News & Social Media',
    description: 'Real-time news and social media monitoring for supply chain events',
    icon: 'Newspaper',
    tools: newsTools,
  },
  {
    id: 'maritime',
    name: 'Maritime & Logistics',
    description: 'Monitor port conditions, shipping disruptions, and logistics events',
    icon: 'Anchor',
    tools: maritimeTools,
  },
  {
    id: 'labor',
    name: 'Labor & Social',
    description: 'Track strikes, labor disputes, and workforce disruptions',
    icon: 'Users',
    tools: laborTools,
  },
  {
    id: 'regulatory',
    name: 'Regulatory & Trade',
    description: 'Monitor tariffs, sanctions, trade policies, and regulatory changes',
    icon: 'Scale',
    tools: regulatoryTools,
  },
  {
    id: 'pandemic',
    name: 'Pandemic & Health',
    description: 'Track disease outbreaks, health emergencies, and pandemic risks',
    icon: 'Heart',
    tools: pandemicTools,
  },
  {
    id: 'geopolitical',
    name: 'Geopolitical & Conflict',
    description: 'Monitor armed conflicts, territorial disputes, and geopolitical tensions',
    icon: 'Globe',
    tools: geopoliticalTools,
  },
];

/**
 * Get all tool definitions for a specific data source
 */
export function getToolsForDataSource(dataSource: DataSourceCategory): ToolDefinition[] {
  const source = DATA_SOURCE_DEFINITIONS.find((ds) => ds.id === dataSource);
  return source?.tools ?? [];
}

/**
 * Get a specific tool definition
 */
export function getToolDefinition(
  dataSource: DataSourceCategory,
  toolId: string
): ToolDefinition | undefined {
  const tools = getToolsForDataSource(dataSource);
  return tools.find((t) => t.id === toolId);
}

/**
 * Get default configuration for a tool
 * Returns a plain object that's compatible with Prisma's Json type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDefaultToolConfig(tool: ToolDefinition): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: Record<string, any> = {};
  for (const field of tool.configFields) {
    config[field.key] = field.default;
  }
  return config;
}

/**
 * Validate tool configuration against its schema
 */
export function validateToolConfig(
  tool: ToolDefinition,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const field of tool.configFields) {
    const value = config[field.key];

    if (field.required && (value === undefined || value === null)) {
      errors.push(`${field.label} is required`);
      continue;
    }

    if (value === undefined || value === null) {
      continue; // Optional field not provided
    }

    switch (field.type) {
      case 'number':
        if (typeof value !== 'number') {
          errors.push(`${field.label} must be a number`);
        } else {
          if (field.min !== undefined && value < field.min) {
            errors.push(`${field.label} must be at least ${field.min}`);
          }
          if (field.max !== undefined && value > field.max) {
            errors.push(`${field.label} must be at most ${field.max}`);
          }
        }
        break;

      case 'string':
        if (typeof value !== 'string') {
          errors.push(`${field.label} must be a string`);
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${field.label} must be a boolean`);
        }
        break;

      case 'string[]':
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          errors.push(`${field.label} must be an array of strings`);
        }
        break;

      case 'select':
        if (field.options && !field.options.some((opt) => opt.value === value)) {
          errors.push(`${field.label} must be one of: ${field.options.map((o) => o.label).join(', ')}`);
        }
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}
