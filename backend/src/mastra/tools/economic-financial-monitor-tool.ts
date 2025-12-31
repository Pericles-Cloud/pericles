import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

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
 * - Commodity Prices (_oil, metals, etc.)
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
    indicators: z.array(z.string()).optional().describe('Specific FRED series IDs to monitor (e.g., CPIAUCSL, DEXUSEU)'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_days: z.number().int().min(1).max(365).default(30).describe('How many days back to check for data'),
    organization_id: z.string().uuid().describe('Organization identifier (_required)')
  }),

  outputSchema: z.object({
    economic_events: z.array(EconomicEventSchema).describe('Detected economic risk events'),
    monitored_countries_count: z.number().int().describe('Number of countries checked'),
    indicators_checked: z.number().int().describe('Number of economic indicators checked'),
    api_calls_made: z.number().int().describe('Number of API calls made to FRED')
  }),

  execute: async ({ context }) => {
    const { countries, indicators, severity_threshold: _severity_threshold, lookback_days: _lookback_days, organization_id } = context;

    // Log the input parameters received
    console.log(`[Economic Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for economic monitoring');
    }

    console.log(`[Economic Monitor] Monitoring ${countries.length} countries for organization: ${organization_id}`);

    // PLACEHOLDER: Actual FRED API integration to be implemented
    // API Documentation: https://fred.stlouisfed.org/docs/api/fred/
    // Requires API Key: https://fred.stlouisfed.org/docs/api/api_key.html

    try {
      const economicEvents: Array<z.infer<typeof EconomicEventSchema>> = [];
      const apiCallsMade = 0;

      // TODO: Implement FRED API integration
      // const events = await fetchFREDIndicators(_countries, indicators, lookback_days, severity_threshold);
      // apiCallsMade += (indicators?.length || DEFAULT_INDICATORS.length) * countries.length;

      // PLACEHOLDER: Return empty array for now
      console.log(`[Economic Monitor] Found ${economicEvents.length} events, made ${apiCallsMade} API calls`);

      return {
        economic_events: economicEvents,
        monitored_countries_count: countries.length,
        indicators_checked: indicators?.length || 0,
        api_calls_made: apiCallsMade
      };

    } catch (error) {
      console.error(`[Economic Monitor] Failed to fetch FRED data:`, error);
      throw new Error(`Economic monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Helper Functions (to be implemented with actual API integration)
// ============================================================================

/**
 * Default FRED series to monitor for supply chain economic risk
 */
const _DEFAULT_FRED_INDICATORS = {
  US: {
    inflation: 'CPIAUCSL',        // Consumer Price Index
    ppi: 'PPIACO',                // Producer Price Index
    interest_rate: 'DFF',         // Federal Funds Rate
    gdp: 'GDP',                   // Gross Domestic Product
    unemployment: 'UNRATE',       // Unemployment Rate
    oil_price: 'DCOILWTICO',      // Crude Oil WTI
    usd_eur: 'DEXUSEU',          // USD/EUR Exchange Rate
    usd_cny: 'DEXCHUS'           // USD/CNY Exchange Rate
  },
  EU: {
    inflation: 'CP0000EZ19M086NEST', // Euro Area HICP
    interest_rate: 'ECBDFR'          // ECB Deposit Facility Rate
  },
  CN: {
    cpi: 'CHNCPIALLMINMEI',      // China CPI
    ppi: 'CHNPPIALLINMEI'        // China PPI
  }
};

/**
 * Fetch economic indicators from FRED API
 * API Docs: https://fred.stlouisfed.org/docs/api/fred/
 *
 * Requires API Key (set in environment: FRED_API_KEY)
 */
async function _fetchFREDIndicators(
  _countries: Array<{ country_code: string; country_name: string }>,
  _customIndicators: string[] | undefined,
  _lookbackDays: number,
  _severityThreshold: string
): Promise<Array<z.infer<typeof EconomicEventSchema>>> {
  // TODO: Implement FRED API calls
  //
  // const apiKey = process.env.FRED_API_KEY;
  // if (!apiKey) {
  //   console.warn('[Economic Monitor] FRED_API_KEY not set, skipping economic check');
  //   return [];
  // }
  //
  // const events: z.infer<typeof EconomicEventSchema>[] = [];
  // const endDate = new Date();
  // const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  //
  // for (const country of countries) {
  //   // Get relevant FRED series for country
  //   const indicators = customIndicators ||
  //     Object.values(DEFAULT_FRED_INDICATORS[country.country_code] || DEFAULT_FRED_INDICATORS.US);
  //
  //   for (const seriesId of indicators) {
  //     try {
  //       // Fetch series observations
  //       const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  //       url.searchParams.set('series_id', _seriesId);
  //       url.searchParams.set('api_key', _apiKey);
  //       url.searchParams.set('file_type', 'json');
  //       url.searchParams.set('observation_start', startDate.toISOString().split('T')[0]);
  //       url.searchParams.set('observation_end', endDate.toISOString().split('T')[0]);
  //
  //       const response = await fetch(url.toString());
  //       const data = await response.json();
  //
  //       // Analyze observations for anomalies
  //       const observations = data.observations;
  //       if (observations.length < 2) continue;
  //
  //       const latest = observations[observations.length - 1];
  //       const previous = observations[observations.length - 2];
  //
  //       const currentValue = parseFloat(latest.value);
  //       const previousValue = parseFloat(previous.value);
  //
  //       if (isNaN(_currentValue) || isNaN(_previousValue)) continue;
  //
  //       const percentChange = ((currentValue - previousValue) / previousValue) * 100;
  //
  //       // Detect significant changes
  //       const isSignificant = detectSignificantChange(_seriesId, percentChange, _currentValue);
  //
  //       if (_isSignificant) {
  //         events.push({
  //           event_id: `fred-${seriesId}-${latest.date}`,
  //           event_type: classifyEconomicEventType(_seriesId, _percentChange),
  //           title: `${seriesId}: ${percentChange > 0 ? '+' : ''}${percentChange.toFixed(2)}% change`,
  //           description: generateEconomicDescription(_seriesId, currentValue, previousValue, _percentChange),
  //           severity: calculateEconomicSeverity(_seriesId, percentChange, _currentValue),
  //           country: country.country_name,
  //           country_code: country.country_code,
  //           indicator_name: seriesId,
  //           current_value: currentValue,
  //           previous_value: previousValue,
  //           percent_change: percentChange,
  //           threshold_exceeded: true,
  //           observation_date: latest.date,
  //           source_url: `https://fred.stlouisfed.org/series/${seriesId}`
  //         });
  //       }
  //     } catch (_err) {
  //       console.error(`[Economic Monitor] Error fetching ${seriesId}:`, _err);
  //       continue;
  //     }
  //   }
  // }
  //
  // return events;

  return [];
}

/**
 * Detect if economic indicator change is significant enough to report
 */
function _detectSignificantChange(_seriesId: string, _percentChange: number, _currentValue: number): boolean {
  // TODO: Implement detection logic based on indicator type
  //
  // Different thresholds for different indicators:
  // - Inflation (CPI/PPI): >0.5% monthly change is significant
  // - Interest Rates: >0.25% change is significant
  // - Currency: >2% change is significant
  // - GDP: >1% quarterly change is significant
  // - Unemployment: >0.3% change is significant
  // - Commodity Prices: >5% change is significant

  return false;
}

/**
 * Classify economic event type based on indicator and change direction
 */
function _classifyEconomicEventType(_seriesId: string, _percentChange: number): string {
  // TODO: Implement classification logic
  //
  // Examples:
  // - CPI/PPI increasing rapidly → inflation_spike
  // - Currency depreciating >5% → currency_crash
  // - Interest rates changing significantly → interest_rate_change
  // - GDP declining → recession_risk
  // - Oil prices spiking → commodity_shock

  return 'economic_change';
}

/**
 * Calculate severity based on magnitude of economic change
 */
function _calculateEconomicSeverity(_seriesId: string, _percentChange: number, _currentValue: number): number {
  // TODO: Implement severity calculation
  //
  // Higher severity for:
  // - Larger percent changes
  // - Changes in critical indicators (_inflation, interest rates)
  // - Values exceeding historical thresholds
  //
  // Return: 0.0 (_minimal) to 1.0 (_critical)

  return 0.5;
}

/**
 * Generate human-readable description of economic event
 */
function _generateEconomicDescription(
  seriesId: string,
  currentValue: number,
  previousValue: number,
  percentChange: number
): string {
  // TODO: Generate contextual description
  return `Economic indicator ${seriesId} changed from ${previousValue} to ${currentValue} (${percentChange.toFixed(2)}%)`;
}
