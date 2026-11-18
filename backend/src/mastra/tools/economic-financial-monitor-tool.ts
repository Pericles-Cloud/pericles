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
  affected_country_codes: z.array(z.string().length(2)).optional()
    .describe('Every monitored country this indicator applies to (e.g. ECBDFR for DE, FR, IT, ES)'),
  indicator_name: z.string().describe('FRED series name (e.g., CPIAUCSL, DEXUSEU)'),
  current_value: z.number(),
  previous_value: z.number().optional(),
  percent_change: z.number().optional().describe('Relative change, for level series (indices, prices, FX)'),
  change_points: z.number().optional().describe('Change in percentage points, for percentage series (rates, YoY inflation)'),
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
    indicators: z.array(z.string().min(1).max(64)).nullable().optional().describe('Specific FRED series IDs to monitor (e.g., CPIAUCSL, DEXUSEU). Pass null or omit for default indicators.'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_days: z.number().int().min(1).max(365).default(30).describe('Report a series only if FRED published new data for it within this many days. The default of 30 covers one release of a monthly series.'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    economic_events: z.array(EconomicEventSchema).describe('Detected economic risk events'),
    monitored_countries_count: z.number().int().describe('Number of countries checked'),
    indicators_checked: z.number().int().describe('Number of economic indicators checked'),
    api_calls_made: z.number().int().describe('Requests this run sent to FRED. Data served from the shared cache, or from a request another run already had in flight, is not counted.'),
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

/** Custom indicators past this many are not read (reported as one unavailable entry). */
const MAX_CUSTOM_INDICATORS = 30;

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
    cny_per_usd: 'DEXCHUS'       // Chinese yuan per US dollar (also CN's default)
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
 * Interest rates, unemployment and year-on-year inflation rates are measured in
 * percentage points; everything else in relative percent change.
 */
const CHANGE_THRESHOLDS: Record<string, { low: number; medium: number; high: number }> = {
  inflation: { low: 0.3, medium: 0.5, high: 1.0 },        // Monthly CPI change %, or YoY rate change pp
  ppi: { low: 0.5, medium: 1.0, high: 2.0 },              // Monthly PPI change % (PPI is never YoY)
  interest_rate: { low: 0.1, medium: 0.25, high: 0.5 },   // Rate change, percentage points
  unemployment: { low: 0.2, medium: 0.3, high: 0.5 },     // Unemployment change, percentage points
  currency: { low: 1.0, medium: 2.0, high: 5.0 },         // Currency % change
  commodity: { low: 3.0, medium: 5.0, high: 10.0 },      // Commodity % change
  percent: { low: 0.25, medium: 0.5, high: 1.0 }          // Any other series measured in percent, pp
};

/**
 * A series whose latest observation is older than this (by FRED frequency code)
 * has stopped updating and is reported as unavailable. FRED dates an
 * observation at the start of its period, so each limit is one period plus the
 * longest normal publication lag: daily series (EIA oil, H.10 FX) can trail by
 * two weeks over holidays; quarterly and annual data can arrive 6-18 months
 * after the period starts.
 *
 * The limit also bounds how old an observation can be when a revision bumps
 * last_updated and the series is read again: it is never older than this.
 */
const STALE_AFTER_DAYS: Record<string, number> = {
  D: 30, W: 45, BW: 60, M: 120, Q: 270, SA: 450, A: 913
};
const DEFAULT_STALE_AFTER_DAYS = 270;

/**
 * FRED allows 120 requests per minute per key. Requests from every invocation
 * in this process share one queue, one slot per 500ms.
 */
const fredPacing = { intervalMs: 500, retryMs: 2000 };
/** A request that would wait longer than this for its slot fails instead. */
const FRED_MAX_QUEUE_WAIT_MS = 180_000;
let nextFredSlot = 0;
/** After a 429, no request is sent before this time, including ones already waiting. */
let fredBackoffUntil = 0;

class FredQueueFullError extends Error {
  constructor() {
    super('FRED request queue is full');
    this.name = 'FredQueueFullError';
  }
}

/**
 * Series metadata (last_updated) is cached briefly so a new release is seen
 * within this time. Observations are keyed by last_updated, so they only need
 * to expire to free memory.
 */
const SERIES_META_TTL_MS = 30 * 60 * 1000;
const OBSERVATIONS_TTL_MS = 6 * 60 * 60 * 1000;
/** Upper bound on each cache; the oldest entries are dropped beyond it. */
const MAX_CACHE_ENTRIES = 500;
/** A fetch result: the value, or the reading that explains why there is none. */
type Fetched<T> = { ok: true; value: T } | { ok: false; reading: SeriesReading };

interface CacheEntry<T> {
  promise: Promise<Fetched<T>>;
  fetchedAt: number;
}

const seriesMetaCache = new Map<string, CacheEntry<FREDSeriesMeta>>();

/**
 * Observations only change when FRED publishes (last_updated), so they are
 * cached per series, transform and last_updated: concurrent and later runs for
 * other organizations reuse one fetch.
 */
const observationCache = new Map<string, CacheEntry<ObservationValues>>();

interface ObservationValues {
  values: Array<{ date: string; value: number }>;
}

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

interface FREDSeriesMeta {
  id: string;
  title: string;
  units: string;
  frequency_short: string;
  seasonal_adjustment_short: string;
  observation_end: string;
  last_updated: string;
}

interface FREDSeriesResponse {
  seriess?: FREDSeriesMeta[];
}

type SeriesReading =
  | {
      status: 'ok';
      title: string;
      units: string;
      date: string;
      current: number;
      previous: number;
      /** Picks thresholds and event types (from the ID, else FRED's title). */
      indicatorType: string;
      /** Values are year-on-year percent changes (FRED units=pc1), not levels. */
      yearOnYear: boolean;
      /** Values are percentages (rates, YoY): changes are in percentage points. */
      inPoints: boolean;
    }
  | { status: 'quiet' }
  | { status: 'unavailable'; reason: string };

type OkReading = Extract<SeriesReading, { status: 'ok' }>;
type EconomicEvent = z.infer<typeof EconomicEventSchema>;
interface Country { country_code: string; country_name: string }

/**
 * Fetch economic indicators from FRED API
 * API Docs: https://fred.stlouisfed.org/docs/api/fred/
 */
async function fetchFREDIndicators(
  countries: Country[],
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
    logger.error('FRED_API_KEY not set: economic monitoring cannot run');
    unavailableSeries.push({ series_id: '*', reason: 'FRED_API_KEY is not configured' });
    return { events, apiCallsMade: 0, indicatorsChecked: 0, unavailableSeries };
  }

  const client = createFredClient(apiKey);

  // Each series is read once and reported as one event. It is attributed to the
  // first country that lists it; every listing country is in
  // affected_country_codes. (ECBDFR is listed by DE, FR, IT and ES.)
  const { plan: seriesCountries, overLimit } = planSeries(countries, customIndicators);
  if (overLimit.length > 0) {
    // One entry, not one per ID: the list goes back to the agent unlimited.
    unavailableSeries.push({
      series_id: overLimit[0],
      reason: `${overLimit.length} indicator(s) from ${overLimit[0]} on not read: over the ${MAX_CUSTOM_INDICATORS}-indicator limit`
    });
  }

  // Reads run concurrently; the shared client queue paces the FRED requests,
  // so cached series don't wait behind uncached ones.
  const plan = Array.from(seriesCountries);
  const readings = await Promise.all(plan.map(([seriesId]) => readSeries(client, seriesId, lookbackDays)));

  plan.forEach(([seriesId, seriesFor], index) => {
    const reading = readings[index];
    if (reading.status === 'unavailable') {
      unavailableSeries.push({ series_id: seriesId, reason: reading.reason });
      return;
    }
    if (reading.status !== 'ok') return;

    const event = buildEvent(seriesId, reading, seriesFor, severityThreshold);
    if (event) events.push(event);
  });

  return { events, apiCallsMade: client.calls(), indicatorsChecked: seriesCountries.size, unavailableSeries };
}

/**
 * Which series to read, and the countries each one is reported for.
 * - Custom indicators apply to every country.
 * - Otherwise each country gets its own defaults. Countries with none get the
 *   US set as the global benchmark (Fed rate, US CPI, oil, USD FX), reported
 *   for those countries alongside any that list the series themselves.
 * - Global commodities apply to every country.
 * A country that lists a series in its own defaults comes first, so the event
 * is attributed to it (a Fed move to the US, not to a country borrowing the US
 * set).
 */
function planSeries(
  countries: Country[],
  customIndicators: string[] | undefined
): { plan: Map<string, Country[]>; overLimit: string[] } {
  const plan = new Map<string, Country[]>();
  const add = (seriesId: string, country: Country) => {
    const list = plan.get(seriesId) ?? [];
    if (!list.some(c => c.country_code === country.country_code)) list.push(country);
    plan.set(seriesId, list);
  };

  const normalized = countries.map(c => ({ ...c, country_code: c.country_code.toUpperCase() }));
  const custom = [...new Set((customIndicators ?? []).map(id => id.trim().toUpperCase()).filter(Boolean))];

  if (custom.length > 0) {
    for (const country of normalized) {
      for (const seriesId of custom.slice(0, MAX_CUSTOM_INDICATORS)) add(seriesId, country);
    }
    return { plan, overLimit: custom.slice(MAX_CUSTOM_INDICATORS) };
  }

  const borrowing: Country[] = [];
  for (const country of normalized) {
    const own = DEFAULT_FRED_INDICATORS[country.country_code];
    if (!own) {
      borrowing.push(country);
      continue;
    }
    for (const seriesId of Object.values(own)) add(seriesId, country);
  }
  for (const country of borrowing) {
    for (const seriesId of Object.values(DEFAULT_FRED_INDICATORS.US)) add(seriesId, country);
  }
  for (const country of normalized) {
    for (const seriesId of Object.values(DEFAULT_FRED_INDICATORS.GLOBAL || {})) add(seriesId, country);
  }

  return { plan, overLimit: [] };
}

/**
 * Rate-limited FRED GET. All invocations in the process share one request
 * slot every fredPacing.intervalMs; an HTTP 429 is retried once.
 */
function createFredClient(apiKey: string) {
  let calls = 0;

  const waitForSlot = async () => {
    const now = Date.now();
    const slot = Math.max(now, nextFredSlot);
    if (slot - now > FRED_MAX_QUEUE_WAIT_MS) throw new FredQueueFullError();
    nextFredSlot = slot + fredPacing.intervalMs;
    if (slot > now) await sleep(slot - now);
    // A 429 seen while this request was waiting pushes it back too.
    while (Date.now() < fredBackoffUntil) await sleep(fredBackoffUntil - Date.now());
  };

  const send = async (url: string) => {
    await waitForSlot();
    calls++;
    return fetch(url, { headers: FRED_HEADERS, signal: AbortSignal.timeout(15000) });
  };

  return {
    calls: () => calls,
    async get(path: string, params: Record<string, string>): Promise<Response> {
      const url = new URL(`https://api.stlouisfed.org/fred/${path}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('file_type', 'json');

      const response = await send(url.toString());
      if (response.status !== 429) return response;
      await response.body?.cancel();
      logger.warn({ path }, 'FRED rate limit hit; backing off and retrying once');
      // Back off the whole queue, not just this request (the key may be shared
      // with another process).
      fredBackoffUntil = Math.max(fredBackoffUntil, Date.now() + fredPacing.retryMs);
      nextFredSlot = Math.max(nextFredSlot, fredBackoffUntil);
      return send(url.toString());
    }
  };
}

type FredClient = ReturnType<typeof createFredClient>;

/**
 * Turn a non-ok FRED response into an unavailable reading. FRED answers both
 * an unknown series and a bad API key with HTTP 400; its error_message tells
 * them apart.
 */
async function unavailableForStatus(seriesId: string, response: Response): Promise<SeriesReading> {
  const { status } = response;
  let message = '';
  try {
    const body = await response.json() as { error_message?: unknown };
    if (typeof body.error_message === 'string') message = body.error_message;
  } catch {
    await response.body?.cancel().catch(() => undefined);
  }

  if (status === 400 && /api_key/i.test(message)) {
    logger.error({ statusCode: status, seriesId }, 'FRED rejected FRED_API_KEY');
    return { status: 'unavailable', reason: 'FRED rejected FRED_API_KEY (HTTP 400)' };
  }
  if (status === 400 && /does not exist/i.test(message)) {
    logger.warn({ seriesId }, 'Unknown FRED series ID');
    return { status: 'unavailable', reason: 'unknown series ID (FRED HTTP 400)' };
  }

  logger.error({ statusCode: status, seriesId }, 'FRED API error');
  return {
    status: 'unavailable',
    reason: status === 429 ? 'rate limited by FRED (HTTP 429)' : `FRED returned HTTP ${status}`
  };
}

/**
 * Get a value through a TTL cache that also shares in-flight requests. Only
 * successes are kept: an error is dropped so the next run asks again.
 */
async function cached<T>(
  cache: Map<string, CacheEntry<T>>,
  ttlMs: number,
  key: string,
  load: () => Promise<Fetched<T>>
): Promise<Fetched<T>> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < ttlMs) return hit.promise;

  // Expired and superseded entries go; Maps iterate oldest first.
  for (const [k, entry] of cache) {
    if (now - entry.fetchedAt >= ttlMs || cache.size >= MAX_CACHE_ENTRIES) cache.delete(k);
    else break;
  }

  const promise = load();
  const entry = { promise, fetchedAt: now };
  // Delete first so the key moves to the end: the sweep relies on oldest-first order.
  cache.delete(key);
  cache.set(key, entry);
  const forget = () => {
    if (cache.get(key) === entry) cache.delete(key);
  };
  try {
    const result = await promise;
    if (!result.ok) forget();
    return result;
  } catch (err) {
    // A thrown request (timeout, network, queue full) must not be replayed
    // from the cache to later runs.
    forget();
    throw err;
  }
}

async function getSeriesMeta(client: FredClient, seriesId: string): Promise<Fetched<FREDSeriesMeta>> {
  return cached(seriesMetaCache, SERIES_META_TTL_MS, seriesId, async () => {
    const response = await client.get('series', { series_id: seriesId });
    if (!response.ok) return { ok: false, reading: await unavailableForStatus(seriesId, response) };
    const meta = (await response.json() as FREDSeriesResponse).seriess?.[0];
    return meta
      ? { ok: true, value: meta }
      : { ok: false, reading: { status: 'unavailable', reason: 'series not found' } };
  });
}

async function getObservations(
  client: FredClient,
  seriesId: string,
  meta: FREDSeriesMeta,
  yearOnYear: boolean
): Promise<Fetched<ObservationValues>> {
  const key = `${seriesId}|${yearOnYear ? 'pc1' : 'lin'}|${meta.last_updated}`;
  return cached(observationCache, OBSERVATIONS_TTL_MS, key, async () => {
    const params: Record<string, string> = {
      series_id: seriesId,
      sort_order: 'desc',
      // Only the two most recent numeric values are compared; spare rows cover
      // missing values ('.').
      limit: '10'
    };
    if (yearOnYear) params.units = 'pc1';

    const response = await client.get('series/observations', params);
    if (!response.ok) return { ok: false, reading: await unavailableForStatus(seriesId, response) };
    const data = await response.json() as FREDObservationsResponse;

    const values = (data.observations ?? [])
      .map(o => ({ date: o.date, value: Number.parseFloat(o.value) }))
      .filter(o => Number.isFinite(o.value));
    if (values.length < 2) {
      logger.warn({ seriesId, numericObservations: values.length }, 'FRED series has too few numeric observations');
      return { ok: false, reading: { status: 'unavailable', reason: 'fewer than two numeric observations' } };
    }
    return { ok: true, value: { values } };
  });
}

/**
 * Read a series' metadata and its two most recent values.
 * - unavailable: FRED error, unknown series, stopped updating, or non-numeric data
 * - quiet: FRED has published nothing new for it within lookbackDays
 */
async function readSeries(client: FredClient, seriesId: string, lookbackDays: number): Promise<SeriesReading> {
  try {
    const metaResult = await getSeriesMeta(client, seriesId);
    if (!metaResult.ok) return metaResult.reading;
    const meta = metaResult.value;

    const staleAfter = STALE_AFTER_DAYS[meta.frequency_short] ?? DEFAULT_STALE_AFTER_DAYS;
    const observedDaysAgo = daysSince(meta.observation_end);
    if (!Number.isFinite(observedDaysAgo)) {
      logger.error({ seriesId, observationEnd: meta.observation_end }, 'Unreadable FRED observation_end');
      return { status: 'unavailable', reason: `unreadable observation_end (${meta.observation_end})` };
    }
    if (observedDaysAgo > staleAfter) {
      logger.warn({ seriesId, observationEnd: meta.observation_end }, 'FRED series has stopped updating');
      return { status: 'unavailable', reason: `stopped updating (last observation ${meta.observation_end})` };
    }

    const updatedDaysAgo = daysSince(parseFredTimestamp(meta.last_updated));
    if (!Number.isFinite(updatedDaysAgo)) {
      logger.error({ seriesId, lastUpdated: meta.last_updated }, 'Unreadable FRED last_updated');
      return { status: 'unavailable', reason: `unreadable last_updated (${meta.last_updated})` };
    }
    if (updatedDaysAgo > lookbackDays) {
      return { status: 'quiet' };
    }

    // Rates, yields, unemployment, growth rates: FRED's units say "Percent"
    // (or, for OECD series, "Growth rate ...").
    const isPercent = /^(percent|growth rate)/i.test(meta.units);
    const indicatorType = resolveIndicatorType(classifyIndicatorType(seriesId, meta.title), isPercent);

    // A non-seasonally-adjusted consumer price index swings month to month
    // with the season (January sales); compare its year-on-year rate instead.
    // Producer prices are not switched: their thresholds are monthly % changes
    // and the YoY rate of a commodity-driven index moves by whole points.
    const yearOnYear = indicatorType === 'inflation'
      && meta.seasonal_adjustment_short === 'NSA'
      && /^index/i.test(meta.units);

    const observations = await getObservations(client, seriesId, meta, yearOnYear);
    if (!observations.ok) return observations.reading;
    const [latest, previous] = observations.value.values;

    return {
      status: 'ok',
      title: meta.title,
      units: yearOnYear ? 'Percent change from year ago' : meta.units,
      date: latest.date,
      current: latest.value,
      previous: previous.value,
      indicatorType,
      yearOnYear,
      inPoints: yearOnYear || isPercent
    };
  } catch (err) {
    if (err instanceof FredQueueFullError) {
      logger.error({ seriesId }, 'FRED request queue is full');
      return { status: 'unavailable', reason: 'FRED request queue is full; try again later' };
    }
    logger.error({ err, seriesId }, 'Error fetching FRED series');
    return { status: 'unavailable', reason: 'request failed' };
  }
}

/** The event for a series, or null when the change is below the threshold. */
function buildEvent(
  seriesId: string,
  reading: OkReading,
  seriesFor: Country[],
  severityThreshold: string
): EconomicEvent | null {
  const { indicatorType, inPoints } = reading;
  const change = inPoints
    ? reading.current - reading.previous
    : relativeChange(reading.current, reading.previous);
  if (change === null) return null;

  const threshold = getThresholdForSeverity(indicatorType, severityThreshold);
  if (Math.abs(change) < threshold) return null;

  const unit = inPoints ? ' pp' : '%';
  const [country] = seriesFor;

  return {
    event_id: `fred-${seriesId}-${reading.date}`,
    event_type: classifyEconomicEventType(seriesId, change, indicatorType),
    title: `${displayName(seriesId, reading)}: ${change > 0 ? '+' : ''}${change.toFixed(2)}${unit} change`,
    description: generateEconomicDescription(seriesId, reading, change, unit, indicatorType),
    severity: calculateEconomicSeverity(indicatorType, change, reading),
    country: country.country_name,
    country_code: country.country_code,
    affected_country_codes: seriesFor.map(c => c.country_code),
    indicator_name: seriesId,
    current_value: reading.current,
    previous_value: reading.previous,
    // For a percentage series the meaningful change is in points; a relative
    // change of a rate (0.2% -> 0.8% = +300%) would only mislead.
    percent_change: inPoints ? undefined : change,
    change_points: inPoints ? change : undefined,
    threshold_exceeded: true,
    observation_date: reading.date,
    source_url: `https://fred.stlouisfed.org/series/${seriesId}`,
    raw_data: { units: reading.units }
  };
}

/** Relative percent change; null when undefined (previous value 0). */
function relativeChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * FRED's last_updated ("2026-11-13 07:46:02-06") as ISO 8601
 * ("2026-11-13T07:46:02-06:00"), keeping the time and offset.
 */
function parseFredTimestamp(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)([+-]\d{2})(?::?(\d{2}))?$/.exec(value.trim());
  return match ? `${match[1]}T${match[2]}${match[3]}:${match[4] ?? '00'}` : value;
}

function daysSince(isoDate: string): number {
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / (24 * 60 * 60 * 1000);
}

/**
 * Point-threshold types (rates, unemployment) only fit percentage series; a
 * level series that matched by name (UNEMPLOY in thousands, ECB balance-sheet
 * series) is 'general'. An unrecognised percentage series is 'percent'.
 */
function resolveIndicatorType(baseType: string, isPercent: boolean): string {
  if ((baseType === 'interest_rate' || baseType === 'unemployment') && !isPercent) return 'general';
  if (baseType === 'general' && isPercent) return 'percent';
  return baseType;
}

/**
 * Classify indicator type from the series ID, falling back to FRED's title for
 * IDs the rules don't know. An unrecognised percentage series becomes
 * 'percent' in readSeries (points thresholds, not relative change).
 */
function classifyIndicatorType(seriesId: string, title = ''): string {
  const id = seriesId.toUpperCase();

  // CP0000xxM086NEST is Eurostat's HICP (all items) on FRED.
  if (id.includes('CPI') || id.includes('HICP') || id.includes('M086NEST')) return 'inflation';
  if (id.includes('PPI')) return 'ppi';
  if (id.includes('DFF') || id.includes('FEDFUNDS') || id.includes('IRST') || id.includes('ECB') || id.startsWith('DGS')) return 'interest_rate';
  if (id.includes('UNRATE') || id.includes('UNEMP')) return 'unemployment';
  if (id.includes('DEX') || id.includes('EXR')) return 'currency';
  if (id.includes('OIL') || id.includes('GOLD') || id.includes('COPPER') || id.includes('PCOPP') || id.includes('BRENT')) return 'commodity';

  const name = title.toLowerCase();
  if (name.includes('producer price')) return 'ppi';
  if (name.includes('consumer price') || name.includes('personal consumption expenditures')) return 'inflation';
  if (name.includes('unemployment')) return 'unemployment';
  if (name.includes('interest rate') || name.includes('yield') || name.includes('policy rate')) return 'interest_rate';
  if (name.includes('exchange rate')) return 'currency';
  if (name.includes('price of') || name.includes('global price')) return 'commodity';

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
 * Whether the foreign currency strengthened against the US dollar. FRED quotes
 * DEXUSxx series as US dollars per foreign unit (a rise means it strengthened)
 * and the other DEX series as foreign units per US dollar (a rise means it
 * weakened). Null for a series whose quote direction is unknown.
 */
function foreignCurrencyStrengthened(seriesId: string, change: number): boolean | null {
  const id = seriesId.toUpperCase();
  if (!id.startsWith('DEX')) return null;
  return id.startsWith('DEXUS') ? change > 0 : change < 0;
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
      // A crash is a large fall of the foreign currency, never a rise.
      return Math.abs(change) > 5 && foreignCurrencyStrengthened(seriesId, change) === false
        ? 'currency_crash'
        : 'currency_volatility';

    case 'commodity':
      return change > 0 ? 'commodity_shock' : 'commodity_deflation';

    default:
      return 'economic_change';
  }
}

/**
 * Calculate severity based on magnitude of economic change
 */
function calculateEconomicSeverity(indicatorType: string, change: number, reading: OkReading): number {
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

  // Boost for high inflation. Only a year-on-year rate is an inflation level;
  // an index value (CPIAUCSL ~ 320) says nothing about it.
  if (indicatorType === 'inflation' && reading.yearOnYear && reading.current > 5) {
    severity = Math.min(0.95, severity + 0.1);
  }

  return Math.max(0.3, Math.min(0.99, severity));
}

function describeCurrencyMove(seriesId: string, change: number): string {
  const strengthened = foreignCurrencyStrengthened(seriesId, change);
  if (strengthened === null) {
    return 'Exchange-rate moves change the cost of goods priced in a foreign currency.';
  }
  return strengthened
    ? 'The currency strengthened against the US dollar, so goods priced in it cost more for dollar buyers.'
    : 'The currency weakened against the US dollar, so goods priced in it cost less for dollar buyers and dollar-priced imports cost more locally.';
}

/** Series name for titles; marks values that are year-on-year rates. */
function displayName(seriesId: string, reading: OkReading): string {
  const name = reading.title || seriesId;
  return reading.yearOnYear ? `${name} (year-on-year %)` : name;
}

/**
 * Generate human-readable description of economic event
 */
function generateEconomicDescription(
  seriesId: string,
  reading: OkReading,
  change: number,
  unit: string,
  indicatorType: string
): string {
  const name = displayName(seriesId, reading);
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

  return `${name} ${direction} from ${reading.previous.toFixed(2)} to ${reading.current.toFixed(2)} (${change > 0 ? '+' : ''}${change.toFixed(2)}${unit}). ${context}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Internals for unit tests; not part of the tool's interface. */
export const __testing = {
  planSeries,
  parseFredTimestamp,
  resolveIndicatorType,
  classifyIndicatorType,
  /** Clear caches and the request queue; set pacing (0 in tests). */
  reset(pacing: { intervalMs: number; retryMs: number } = { intervalMs: 500, retryMs: 2000 }): void {
    seriesMetaCache.clear();
    observationCache.clear();
    nextFredSlot = 0;
    fredBackoffUntil = 0;
    fredPacing.intervalMs = pacing.intervalMs;
    fredPacing.retryMs = pacing.retryMs;
  }
};
