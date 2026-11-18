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

const UnavailableSeriesSchema = z.object({
  series_id: z.string(),
  reason: z.string()
});

export const economicFinancialMonitorTool = createTool({
  id: 'economic-financial-monitor',
  description: 'Monitor economic indicators including inflation (CPI/PPI), currency exchange rates, interest rates, GDP growth, commodity prices, and financial instability using FRED (Federal Reserve Economic Data).',

  inputSchema: z.object({
    countries: z.array(CountryInputSchema).min(1).describe('Countries to monitor for economic events'),
    indicators: z.array(z.string()).nullable().optional().describe('Specific FRED series IDs to monitor (e.g., CPIAUCSL, DEXUSEU). Pass null or omit for default indicators.'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_days: z.number().int().min(1).max(365).default(30).describe('Report a series only if FRED published new data for it within this many days. The default of 30 covers one release of a monthly series.'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    economic_events: z.array(EconomicEventSchema).describe('Detected economic risk events'),
    monitored_countries_count: z.number().int().describe('Number of countries checked'),
    indicators_checked: z.number().int().describe('Number of economic indicators checked'),
    api_calls_made: z.number().int().describe('Number of API calls made to FRED'),
    unavailable_series: z.array(UnavailableSeriesSchema)
      .describe('FRED series that returned an error or have stopped updating')
  }),

  execute: async ({ context }) => {
    const { countries, indicators, severity_threshold, lookback_days, organization_id } = context;

    logger.debug({ context }, 'Tool executed');

    if (!organization_id) {
      throw new Error('organization_id is required for economic monitoring');
    }

    logger.info({ countryCount: countries.length, organizationId: organization_id }, 'Monitoring countries');

    try {
      const { events, apiCallsMade, indicatorsChecked, unavailableSeries } = await fetchFREDIndicators(
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
        api_calls_made: apiCallsMade,
        unavailable_series: unavailableSeries
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
    usd_per_eur: 'DEXUSEU',      // US dollars per euro
    cny_per_usd: 'DEXCHUS'       // Chinese yuan per US dollar
    // GSCPI (NY Fed Global Supply Chain Pressure Index) is not published on FRED.
  },
  // EU countries: national HICP + the ECB deposit facility rate
  DE: { inflation: 'CP0000DEM086NEST', interest_rate: 'ECBDFR' },
  FR: { inflation: 'CP0000FRM086NEST', interest_rate: 'ECBDFR' },
  IT: { inflation: 'CP0000ITM086NEST', interest_rate: 'ECBDFR' },
  ES: { inflation: 'CP0000ESM086NEST', interest_rate: 'ECBDFR' },
  // China
  // FRED has no current monthly CPI or PPI for China, Japan or the UK: the OECD
  // MEI series it carried stopped between 2021 and 2025. Their USD exchange
  // rates are daily and current.
  CN: { cny_per_usd: 'DEXCHUS' },
  JP: { jpy_per_usd: 'DEXJPUS', interest_rate: 'IRSTCI01JPM156N' },
  GB: { usd_per_gbp: 'DEXUSUK', interest_rate: 'IRSTCI01GBM156N' },
  // Global commodities (assigned to US as default source)
  GLOBAL: {
    // LBMA gold (GOLDPMGBD228NLBM) was withdrawn from FRED.
    oil_brent: 'DCOILBRENTEU',
    copper: 'PCOPPUSDM'
  }
};

/**
 * Thresholds for detecting significant changes in different indicator types.
 * Interest rates and unemployment are measured in percentage points; every
 * other type in relative percent change (see POINT_CHANGE_TYPES).
 */
const CHANGE_THRESHOLDS: Record<string, { low: number; medium: number; high: number }> = {
  inflation: { low: 0.3, medium: 0.5, high: 1.0 },        // Monthly CPI change %
  ppi: { low: 0.5, medium: 1.0, high: 2.0 },              // Monthly PPI change %
  interest_rate: { low: 0.1, medium: 0.25, high: 0.5 },   // Rate change, percentage points
  unemployment: { low: 0.2, medium: 0.3, high: 0.5 },     // Unemployment change, percentage points
  currency: { low: 1.0, medium: 2.0, high: 5.0 },         // Currency % change
  commodity: { low: 3.0, medium: 5.0, high: 10.0 }        // Commodity % change
};

/** Indicator types whose values are already percentages: compare them in points. */
const POINT_CHANGE_TYPES = new Set(['interest_rate', 'unemployment']);

/**
 * A series whose latest observation is older than this (by FRED frequency code)
 * has stopped updating and is reported as unavailable.
 */
const STALE_AFTER_DAYS: Record<string, number> = {
  D: 30, W: 60, BW: 60, M: 180, Q: 365, SA: 550, A: 800
};
const DEFAULT_STALE_AFTER_DAYS = 400;

/** FRED allows 120 requests per minute; one request per 500ms stays inside it. */
const FRED_REQUEST_INTERVAL_MS = 500;

const FRED_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Pericles-SupplyChainMonitor/1.0 (contact@pericles.cloud)'
};

interface FREDObservation {
  date: string;
  value: string;
}

interface FREDObservationsResponse {
  units: string;
  observations?: FREDObservation[];
}

interface FREDSeriesResponse {
  seriess?: Array<{
    id: string;
    title: string;
    units: string;
    frequency_short: string;
    observation_end: string;
    last_updated: string;
  }>;
}

type SeriesReading =
  | { status: 'ok'; title: string; units: string; date: string; current: number; previous: number }
  | { status: 'quiet' }
  | { status: 'unavailable'; reason: string };

type EconomicEvent = z.infer<typeof EconomicEventSchema>;

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
  events: EconomicEvent[];
  apiCallsMade: number;
  indicatorsChecked: number;
  unavailableSeries: Array<z.infer<typeof UnavailableSeriesSchema>>;
}> {
  const events: EconomicEvent[] = [];
  const unavailableSeries: Array<z.infer<typeof UnavailableSeriesSchema>> = [];

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    logger.warn('FRED_API_KEY not set, skipping economic monitoring');
    return { events, apiCallsMade: 0, indicatorsChecked: 0, unavailableSeries };
  }

  const client = createFredClient(apiKey);
  // One reading per series per run. A series shared by several countries
  // (ECBDFR, custom indicators) is fetched once and reported for each of them.
  const readings = new Map<string, SeriesReading>();

  // Always include global commodity indicators
  const globalIndicators = Object.values(DEFAULT_FRED_INDICATORS.GLOBAL || {});

  for (const [index, country] of countries.entries()) {
    const countryCode = country.country_code.toUpperCase();
    let seriesToCheck: string[];

    if (customIndicators && customIndicators.length > 0) {
      seriesToCheck = customIndicators;
    } else {
      const countryIndicators = DEFAULT_FRED_INDICATORS[countryCode] || DEFAULT_FRED_INDICATORS.US;
      seriesToCheck = [...Object.values(countryIndicators)];

      // Add global commodities for first country only (to avoid duplicates)
      if (index === 0) {
        seriesToCheck.push(...globalIndicators);
      }
    }

    for (const seriesId of new Set(seriesToCheck)) {
      let reading = readings.get(seriesId);
      if (!reading) {
        reading = await readSeries(client, seriesId, lookbackDays);
        readings.set(seriesId, reading);
        if (reading.status === 'unavailable') {
          unavailableSeries.push({ series_id: seriesId, reason: reading.reason });
        }
      }
      if (reading.status !== 'ok') continue;

      const event = buildEvent(seriesId, reading, { ...country, country_code: countryCode }, severityThreshold);
      if (event) events.push(event);
    }
  }

  return { events, apiCallsMade: client.calls(), indicatorsChecked: readings.size, unavailableSeries };
}

/** Rate-limited FRED GET. Every request waits FRED_REQUEST_INTERVAL_MS after the previous one. */
function createFredClient(apiKey: string) {
  let calls = 0;
  return {
    calls: () => calls,
    async get(path: string, params: Record<string, string>): Promise<Response> {
      if (calls > 0) await sleep(FRED_REQUEST_INTERVAL_MS);
      calls++;
      const url = new URL(`https://api.stlouisfed.org/fred/${path}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('file_type', 'json');
      return fetch(url.toString(), { headers: FRED_HEADERS, signal: AbortSignal.timeout(15000) });
    }
  };
}

/**
 * Read a series' metadata and its two most recent values.
 * - unavailable: FRED error, unknown series, stopped updating, or non-numeric data
 * - quiet: FRED has published nothing new for it within lookbackDays
 */
async function readSeries(
  client: ReturnType<typeof createFredClient>,
  seriesId: string,
  lookbackDays: number
): Promise<SeriesReading> {
  try {
    const metaResponse = await client.get('series', { series_id: seriesId });
    if (!metaResponse.ok) {
      logger.error({ statusCode: metaResponse.status, seriesId }, 'FRED API error');
      return { status: 'unavailable', reason: `FRED returned HTTP ${metaResponse.status}` };
    }
    const meta = (await metaResponse.json() as FREDSeriesResponse).seriess?.[0];
    if (!meta) return { status: 'unavailable', reason: 'series not found' };

    const staleAfter = STALE_AFTER_DAYS[meta.frequency_short] ?? DEFAULT_STALE_AFTER_DAYS;
    if (daysSince(meta.observation_end) > staleAfter) {
      logger.warn({ seriesId, observationEnd: meta.observation_end }, 'FRED series has stopped updating');
      return { status: 'unavailable', reason: `stopped updating (last observation ${meta.observation_end})` };
    }

    // last_updated is when FRED last published data for the series ("2026-11-13 07:46:02-06").
    if (daysSince(meta.last_updated.slice(0, 10)) > lookbackDays) {
      return { status: 'quiet' };
    }

    const obsResponse = await client.get('series/observations', {
      series_id: seriesId,
      sort_order: 'desc',
      // Only the two most recent numeric values are compared; spare rows cover
      // missing values ('.').
      limit: '10'
    });
    if (!obsResponse.ok) {
      logger.error({ statusCode: obsResponse.status, seriesId }, 'FRED API error');
      return { status: 'unavailable', reason: `FRED returned HTTP ${obsResponse.status}` };
    }
    const obsData = await obsResponse.json() as FREDObservationsResponse;

    const values = (obsData.observations ?? [])
      .map(o => ({ date: o.date, value: Number.parseFloat(o.value) }))
      .filter(o => Number.isFinite(o.value));
    if (values.length < 2) {
      logger.warn({ seriesId, numericObservations: values.length }, 'FRED series has too few numeric observations');
      return { status: 'unavailable', reason: 'fewer than two numeric observations' };
    }

    return {
      status: 'ok',
      title: meta.title,
      units: obsData.units ?? meta.units,
      date: values[0].date,
      current: values[0].value,
      previous: values[1].value
    };
  } catch (err) {
    logger.error({ err, seriesId }, 'Error fetching FRED series');
    return { status: 'unavailable', reason: 'request failed' };
  }
}

/** The event for one country, or null when the change is below the threshold. */
function buildEvent(
  seriesId: string,
  reading: Extract<SeriesReading, { status: 'ok' }>,
  country: { country_code: string; country_name: string },
  severityThreshold: string
): EconomicEvent | null {
  const indicatorType = classifyIndicatorType(seriesId);
  const change = measureChange(indicatorType, reading.current, reading.previous);
  if (change === null) return null;

  const threshold = getThresholdForSeverity(indicatorType, severityThreshold);
  if (Math.abs(change) < threshold) return null;

  const unit = POINT_CHANGE_TYPES.has(indicatorType) ? ' pp' : '%';
  const percentChange = reading.previous !== 0
    ? ((reading.current - reading.previous) / Math.abs(reading.previous)) * 100
    : undefined;

  return {
    event_id: `fred-${seriesId}-${country.country_code}-${reading.date}`,
    event_type: classifyEconomicEventType(seriesId, change, indicatorType),
    title: `${reading.title || seriesId}: ${change > 0 ? '+' : ''}${change.toFixed(2)}${unit} change`,
    description: generateEconomicDescription(seriesId, reading.title, reading.current, reading.previous, change, unit, indicatorType),
    severity: calculateEconomicSeverity(indicatorType, change, reading.current),
    country: country.country_name,
    country_code: country.country_code,
    indicator_name: seriesId,
    current_value: reading.current,
    previous_value: reading.previous,
    percent_change: percentChange,
    threshold_exceeded: true,
    observation_date: reading.date,
    source_url: `https://fred.stlouisfed.org/series/${seriesId}`,
    raw_data: { units: reading.units }
  };
}

/**
 * Change between the two latest values: percentage points for rate-like
 * indicators, relative percent otherwise. Null when a relative change is
 * undefined (previous value 0).
 */
function measureChange(indicatorType: string, current: number, previous: number): number | null {
  if (POINT_CHANGE_TYPES.has(indicatorType)) return current - previous;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function daysSince(isoDate: string): number {
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / (24 * 60 * 60 * 1000);
}

/**
 * Classify indicator type from series ID
 */
function classifyIndicatorType(seriesId: string): string {
  const id = seriesId.toUpperCase();

  // CP0000xxM086NEST is Eurostat's HICP (all items) on FRED.
  if (id.includes('CPI') || id.includes('HICP') || id.includes('M086NEST')) return 'inflation';
  if (id.includes('PPI')) return 'ppi';
  if (id.includes('DFF') || id.includes('IRST') || id.includes('ECB')) return 'interest_rate';
  if (id.includes('UNRATE') || id.includes('UNEMP')) return 'unemployment';
  if (id.includes('DEX') || id.includes('EXR')) return 'currency';
  if (id.includes('OIL') || id.includes('GOLD') || id.includes('COPPER') || id.includes('PCOPP') || id.includes('BRENT')) return 'commodity';

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
function classifyEconomicEventType(seriesId: string, change: number, indicatorType: string): string {
  switch (indicatorType) {
    case 'inflation':
    case 'ppi':
      return change > 0 ? 'inflation_spike' : 'deflation_risk';

    case 'interest_rate':
      return 'interest_rate_change';

    case 'unemployment':
      return change > 0 ? 'unemployment_rise' : 'labor_market_tightening';

    case 'currency':
      return Math.abs(change) > 5 ? 'currency_crash' : 'currency_volatility';

    case 'commodity':
      return change > 0 ? 'commodity_shock' : 'commodity_deflation';

    default:
      return 'economic_change';
  }
}

/**
 * Calculate severity based on magnitude of economic change
 */
function calculateEconomicSeverity(indicatorType: string, change: number, currentValue: number): number {
  const absChange = Math.abs(change);
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

  return Math.max(0.3, Math.min(0.99, severity));
}

/**
 * Explain an exchange-rate move. FRED quotes DEXUSxx series as US dollars per
 * foreign unit (a rise means the foreign currency strengthened) and the other
 * DEX series as foreign units per US dollar (a rise means it weakened).
 */
function describeCurrencyMove(seriesId: string, change: number): string {
  const id = seriesId.toUpperCase();
  if (!id.startsWith('DEX')) {
    return 'Exchange-rate moves change the cost of goods priced in a foreign currency.';
  }
  const usdPerForeign = id.startsWith('DEXUS');
  const foreignStrengthened = usdPerForeign ? change > 0 : change < 0;
  return foreignStrengthened
    ? 'The currency strengthened against the US dollar, so goods priced in it cost more for dollar buyers.'
    : 'The currency weakened against the US dollar, so goods priced in it cost less for dollar buyers and dollar-priced imports cost more locally.';
}

/**
 * Generate human-readable description of economic event
 */
function generateEconomicDescription(
  seriesId: string,
  seriesTitle: string | null,
  currentValue: number,
  previousValue: number,
  change: number,
  unit: string,
  indicatorType: string
): string {
  const name = seriesTitle || seriesId;
  const direction = change > 0 ? 'increased' : 'decreased';

  let context = '';
  switch (indicatorType) {
    case 'inflation':
      context = change > 0
        ? 'Rising inflation may increase input costs and erode purchasing power.'
        : 'Declining inflation could signal weakening demand.';
      break;
    case 'interest_rate':
      context = change > 0
        ? 'Higher interest rates increase borrowing costs and may slow economic activity.'
        : 'Lower interest rates may stimulate borrowing and investment.';
      break;
    case 'currency':
      context = describeCurrencyMove(seriesId, change);
      break;
    case 'commodity':
      context = change > 0
        ? 'Rising commodity prices may increase production and transportation costs.'
        : 'Falling commodity prices may signal weakening demand or oversupply.';
      break;
    default:
      context = 'Monitor this indicator for potential supply chain impact.';
  }

  return `${name} ${direction} from ${previousValue.toFixed(2)} to ${currentValue.toFixed(2)} (${change > 0 ? '+' : ''}${change.toFixed(2)}${unit}). ${context}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
