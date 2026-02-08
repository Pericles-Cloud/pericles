import { createTool } from '@mastra/core/tools';
import { limitEvents, getFilterSummary } from './output-limiter.js';
import { toolLoggers } from './tool-logger.js';
import { z } from 'zod';

const logger = toolLoggers.economicFinancial;

/**
 * Economic & Financial Monitor Tool
 *
 * Purpose: Track economic indicators, inflation, currency fluctuations, and financial instability.
 *
 * Data Source:
 * - FRED (Federal Reserve Economic Data)
 *   API: https://fred.stlouisfed.org/docs/api/fred/
 *
 * Economic Indicators:
 * - Inflation (CPI, PPI)
 * - Currency Exchange Rates
 * - Interest Rates
 * - GDP Growth
 * - Unemployment Rates
 * - Commodity Prices (oil, metals, etc.)
 * - Stock Market Indices
 *
 * Organization Isolation: Filters based on organization's operating countries and currencies
 */

const CountryInputSchema = z.object({
  country_code: z.string().length(2).describe('ISO 3166-1 alpha-2 country code'),
  country_name: z.string()
});

const EconomicEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // inflation_spike, currency_crash, interest_rate_change, recession_risk, commodity_shock
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1),
  country: z.string(),
  country_code: z.string().length(2),
  indicator_name: z.string().describe('FRED series name (e.g., CPIAUCSL, DEXUSEU)'),
  current_value: z.number(),
  previous_value: z.number().optional(),
  percent_change: z.number().optional(),
  threshold_exceeded: z.boolean().optional(),
  observation_date: z.string().describe('Date of the economic data point'),
  source_url: z.string().url().optional(),
  raw_data: z.record(z.string(), z.any()).optional()
});

export const economicFinancialMonitorTool = createTool({
  id: 'economic-financial-monitor',
  description: 'Monitor economic indicators including inflation (CPI/PPI), currency exchange rates, interest rates, GDP growth, commodity prices, and financial instability using FRED (Federal Reserve Economic Data).',

  inputSchema: z.object({
    countries: z.array(CountryInputSchema).min(1).describe('Countries to monitor for economic events'),
    indicators: z.array(z.string()).nullable().optional().describe('Specific FRED series IDs to monitor (e.g., CPIAUCSL, DEXUSEU). Pass null or omit for default indicators.'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_days: z.number().int().min(1).max(365).default(30).describe('How many days back to check for data'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    economic_events: z.array(EconomicEventSchema).describe('Detected economic risk events'),
    monitored_countries_count: z.number().int().describe('Number of countries checked'),
    indicators_checked: z.number().int().describe('Number of economic indicators checked'),
    api_calls_made: z.number().int().describe('Number of API calls made to FRED')
  }),

  execute: async ({ context }) => {
    const { countries, indicators, severity_threshold, lookback_days, organization_id } = context;

    logger.debug({ context }, 'Tool executed');

    if (!organization_id) {
      throw new Error('organization_id is required for economic monitoring');
    }

    logger.info({ countryCount: countries.length, organizationId: organization_id }, 'Monitoring countries');

    try {
      const { events, apiCallsMade, indicatorsChecked } = await fetchFREDIndicators(
        countries,
        indicators ?? undefined,
        lookback_days,
        severity_threshold
      );

      // Limit output to prevent context overflow
      const MAX_EVENTS = 10;
      const limitedEvents = limitEvents(events, MAX_EVENTS);
      logger.info({ originalCount: events.length, limitedCount: limitedEvents.length }, getFilterSummary(events.length, limitedEvents.length, 'Economic Monitor'));

      return {
        economic_events: limitedEvents,
        monitored_countries_count: countries.length,
        indicators_checked: indicatorsChecked,
        api_calls_made: apiCallsMade
      };

    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch FRED data');
      throw new Error(`Economic monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// FRED API Integration
// ============================================================================

/**
 * Default FRED series to monitor for supply chain economic risk
 * Organized by country code
 */
const DEFAULT_FRED_INDICATORS: Record<string, Record<string, string>> = {
  US: {
    inflation: 'CPIAUCSL',        // Consumer Price Index
    ppi: 'PPIACO',                // Producer Price Index
    interest_rate: 'DFF',         // Federal Funds Rate
    unemployment: 'UNRATE',       // Unemployment Rate
    oil_price: 'DCOILWTICO',      // Crude Oil WTI
    usd_eur: 'DEXUSEU',          // USD/EUR Exchange Rate
    usd_cny: 'DEXCHUS',          // USD/CNY Exchange Rate
    supply_chain_pressure: 'GSCPI' // Global Supply Chain Pressure Index
  },
  // EU countries use Euro-area indicators
  DE: { inflation: 'CP0000DE19M086NEST', interest_rate: 'ECBDFR' },
  FR: { inflation: 'CP0000FR19M086NEST', interest_rate: 'ECBDFR' },
  IT: { inflation: 'CP0000IT19M086NEST', interest_rate: 'ECBDFR' },
  ES: { inflation: 'CP0000ES19M086NEST', interest_rate: 'ECBDFR' },
  // China
  CN: { cpi: 'CHNCPIALLMINMEI', ppi: 'CHNPPIALLINMEI' },
  // Japan
  JP: { cpi: 'JPNCPIALLMINMEI', interest_rate: 'IRSTCI01JPM156N' },
  // UK
  GB: { cpi: 'GBRCPIALLMINMEI', interest_rate: 'IRSTCI01GBM156N' },
  // Global commodities (assigned to US as default source)
  GLOBAL: {
    oil_brent: 'DCOILBRENTEU',
    gold: 'GOLDPMGBD228NLBM',
    copper: 'PCOPPUSDM'
  }
};

/**
 * Thresholds for detecting significant changes in different indicator types
 */
const CHANGE_THRESHOLDS: Record<string, { low: number; medium: number; high: number }> = {
  inflation: { low: 0.3, medium: 0.5, high: 1.0 },        // Monthly CPI change %
  ppi: { low: 0.5, medium: 1.0, high: 2.0 },              // Monthly PPI change %
  interest_rate: { low: 0.1, medium: 0.25, high: 0.5 },   // Rate change points
  unemployment: { low: 0.2, medium: 0.3, high: 0.5 },     // Unemployment % point change
  currency: { low: 1.0, medium: 2.0, high: 5.0 },         // Currency % change
  commodity: { low: 3.0, medium: 5.0, high: 10.0 },       // Commodity % change
  supply_chain: { low: 0.5, medium: 1.0, high: 2.0 }      // GSCPI change
};

interface FREDObservation {
  realtime_start: string;
  realtime_end: string;
  date: string;
  value: string;
}

interface FREDObservationsResponse {
  realtime_start: string;
  realtime_end: string;
  observation_start: string;
  observation_end: string;
  units: string;
  output_type: number;
  file_type: string;
  order_by: string;
  sort_order: string;
  count: number;
  offset: number;
  limit: number;
  observations: FREDObservation[];
}

interface FREDSeriesResponse {
  realtime_start: string;
  realtime_end: string;
  seriess: Array<{
    id: string;
    title: string;
    units: string;
    frequency: string;
    notes: string;
  }>;
}

/**
 * Fetch economic indicators from FRED API
 * API Docs: https://fred.stlouisfed.org/docs/api/fred/
 */
async function fetchFREDIndicators(
  countries: Array<{ country_code: string; country_name: string }>,
  customIndicators: string[] | undefined,
  lookbackDays: number,
  severityThreshold: string
): Promise<{
  events: Array<z.infer<typeof EconomicEventSchema>>;
  apiCallsMade: number;
  indicatorsChecked: number;
}> {
  const events: Array<z.infer<typeof EconomicEventSchema>> = [];
  let apiCallsMade = 0;
  let indicatorsChecked = 0;

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    logger.warn('FRED_API_KEY not set, skipping economic monitoring');
    return { events, apiCallsMade, indicatorsChecked };
  }

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // Always include global commodity indicators
  const globalIndicators = Object.values(DEFAULT_FRED_INDICATORS.GLOBAL || {});

  for (const country of countries) {
    // Get relevant FRED series for this country
    let seriesToCheck: string[];

    if (customIndicators && customIndicators.length > 0) {
      seriesToCheck = customIndicators;
    } else {
      const countryIndicators = DEFAULT_FRED_INDICATORS[country.country_code] || DEFAULT_FRED_INDICATORS.US;
      seriesToCheck = [...Object.values(countryIndicators)];

      // Add global commodities for first country only (to avoid duplicates)
      if (countries.indexOf(country) === 0) {
        seriesToCheck.push(...globalIndicators);
      }
    }

    for (const seriesId of seriesToCheck) {
      try {
        // Fetch series observations
        const obsUrl = new URL('https://api.stlouisfed.org/fred/series/observations');
        obsUrl.searchParams.set('series_id', seriesId);
        obsUrl.searchParams.set('api_key', apiKey);
        obsUrl.searchParams.set('file_type', 'json');
        obsUrl.searchParams.set('observation_start', startDateStr);
        obsUrl.searchParams.set('observation_end', endDateStr);
        obsUrl.searchParams.set('sort_order', 'desc');

        const obsResponse = await fetch(obsUrl.toString(), {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15000)
        });

        apiCallsMade++;
        indicatorsChecked++;

        if (!obsResponse.ok) {
          logger.warn({ statusCode: obsResponse.status, seriesId }, 'FRED API error');
          continue;
        }

        const obsData = await obsResponse.json() as FREDObservationsResponse;

        if (!obsData.observations || obsData.observations.length < 2) {
          continue;
        }

        // Get the two most recent observations
        const validObs = obsData.observations.filter(o => o.value !== '.');
        if (validObs.length < 2) continue;

        const latest = validObs[0];
        const previous = validObs[1];

        const currentValue = parseFloat(latest.value);
        const previousValue = parseFloat(previous.value);

        if (isNaN(currentValue) || isNaN(previousValue)) continue;

        const percentChange = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;

        // Detect significant changes
        const indicatorType = classifyIndicatorType(seriesId);
        const threshold = getThresholdForSeverity(indicatorType, severityThreshold);

        if (Math.abs(percentChange) >= threshold) {
          // Fetch series info for better title
          const seriesTitle = await fetchSeriesTitle(seriesId, apiKey);
          apiCallsMade++;

          const eventType = classifyEconomicEventType(seriesId, percentChange, indicatorType);
          const severity = calculateEconomicSeverity(indicatorType, percentChange, currentValue);

          events.push({
            event_id: `fred-${seriesId}-${latest.date}`,
            event_type: eventType,
            title: `${seriesTitle || seriesId}: ${percentChange > 0 ? '+' : ''}${percentChange.toFixed(2)}% change`,
            description: generateEconomicDescription(seriesId, seriesTitle, currentValue, previousValue, percentChange, indicatorType),
            severity,
            country: country.country_name,
            country_code: country.country_code,
            indicator_name: seriesId,
            current_value: currentValue,
            previous_value: previousValue,
            percent_change: percentChange,
            threshold_exceeded: true,
            observation_date: latest.date,
            source_url: `https://fred.stlouisfed.org/series/${seriesId}`,
            raw_data: { units: obsData.units }
          });
        }

        // Rate limiting: FRED allows 120 requests per minute
        await sleep(500);

      } catch (err) {
        logger.error({ err, seriesId }, 'Error fetching FRED series');
      }
    }
  }

  return { events, apiCallsMade, indicatorsChecked };
}

/**
 * Fetch series title from FRED
 */
async function fetchSeriesTitle(seriesId: string, apiKey: string): Promise<string | null> {
  try {
    const url = new URL('https://api.stlouisfed.org/fred/series');
    url.searchParams.set('series_id', seriesId);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('file_type', 'json');

    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return null;

    const data = await response.json() as FREDSeriesResponse;
    return data.seriess?.[0]?.title || null;
  } catch {
    return null;
  }
}

/**
 * Classify indicator type from series ID
 */
function classifyIndicatorType(seriesId: string): string {
  const id = seriesId.toUpperCase();

  if (id.includes('CPI') || id.includes('HICP')) return 'inflation';
  if (id.includes('PPI')) return 'ppi';
  if (id.includes('DFF') || id.includes('IRST') || id.includes('ECB')) return 'interest_rate';
  if (id.includes('UNRATE') || id.includes('UNEMP')) return 'unemployment';
  if (id.includes('DEX') || id.includes('EXR')) return 'currency';
  if (id.includes('OIL') || id.includes('GOLD') || id.includes('COPPER') || id.includes('BRENT')) return 'commodity';
  if (id.includes('GSCPI') || id.includes('SUPPLY')) return 'supply_chain';

  return 'general';
}

/**
 * Get threshold value based on severity level
 */
function getThresholdForSeverity(indicatorType: string, severity: string): number {
  const thresholds = CHANGE_THRESHOLDS[indicatorType] || CHANGE_THRESHOLDS.commodity;

  switch (severity) {
    case 'low': return thresholds.low;
    case 'medium': return thresholds.medium;
    case 'high': return thresholds.high;
    default: return thresholds.medium;
  }
}

/**
 * Classify economic event type based on indicator and change direction
 */
function classifyEconomicEventType(seriesId: string, percentChange: number, indicatorType: string): string {
  switch (indicatorType) {
    case 'inflation':
    case 'ppi':
      return percentChange > 0 ? 'inflation_spike' : 'deflation_risk';

    case 'interest_rate':
      return 'interest_rate_change';

    case 'unemployment':
      return percentChange > 0 ? 'unemployment_rise' : 'labor_market_tightening';

    case 'currency':
      return Math.abs(percentChange) > 5 ? 'currency_crash' : 'currency_volatility';

    case 'commodity':
      return percentChange > 0 ? 'commodity_shock' : 'commodity_deflation';

    case 'supply_chain':
      return percentChange > 0 ? 'supply_chain_pressure' : 'supply_chain_easing';

    default:
      return 'economic_change';
  }
}

/**
 * Calculate severity based on magnitude of economic change
 */
function calculateEconomicSeverity(indicatorType: string, percentChange: number, currentValue: number): number {
  const absChange = Math.abs(percentChange);
  const thresholds = CHANGE_THRESHOLDS[indicatorType] || CHANGE_THRESHOLDS.commodity;

  // Base severity on how far above the high threshold we are
  let severity: number;

  if (absChange >= thresholds.high * 2) {
    severity = 0.95;
  } else if (absChange >= thresholds.high) {
    severity = 0.7 + ((absChange - thresholds.high) / thresholds.high) * 0.2;
  } else if (absChange >= thresholds.medium) {
    severity = 0.5 + ((absChange - thresholds.medium) / (thresholds.high - thresholds.medium)) * 0.2;
  } else {
    severity = 0.3 + ((absChange - thresholds.low) / (thresholds.medium - thresholds.low)) * 0.2;
  }

  // Boost severity for critical indicators
  if (indicatorType === 'inflation' && currentValue > 5) {
    severity = Math.min(0.95, severity + 0.1);
  }
  if (indicatorType === 'supply_chain' && currentValue > 2) {
    severity = Math.min(0.95, severity + 0.1);
  }

  return Math.max(0.3, Math.min(0.99, severity));
}

/**
 * Generate human-readable description of economic event
 */
function generateEconomicDescription(
  seriesId: string,
  seriesTitle: string | null,
  currentValue: number,
  previousValue: number,
  percentChange: number,
  indicatorType: string
): string {
  const name = seriesTitle || seriesId;
  const direction = percentChange > 0 ? 'increased' : 'decreased';

  let context = '';
  switch (indicatorType) {
    case 'inflation':
      context = percentChange > 0
        ? 'Rising inflation may increase input costs and erode purchasing power.'
        : 'Declining inflation could signal weakening demand.';
      break;
    case 'interest_rate':
      context = percentChange > 0
        ? 'Higher interest rates increase borrowing costs and may slow economic activity.'
        : 'Lower interest rates may stimulate borrowing and investment.';
      break;
    case 'currency':
      context = percentChange > 0
        ? 'Currency appreciation makes exports more expensive and imports cheaper.'
        : 'Currency depreciation makes imports more expensive and may increase costs.';
      break;
    case 'commodity':
      context = percentChange > 0
        ? 'Rising commodity prices may increase production and transportation costs.'
        : 'Falling commodity prices may signal weakening demand or oversupply.';
      break;
    case 'supply_chain':
      context = percentChange > 0
        ? 'Increased supply chain pressure indicates logistics challenges and potential delays.'
        : 'Easing supply chain pressure suggests improving logistics conditions.';
      break;
    default:
      context = 'Monitor this indicator for potential supply chain impact.';
  }

  return `${name} ${direction} from ${previousValue.toFixed(2)} to ${currentValue.toFixed(2)} (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(2)}%). ${context}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
