/**
 * economic-financial-monitor — FRED integration tests (Vitest, per pericles-testing).
 *
 * FRED is replaced by a stubbed global fetch serving a small table of series,
 * so these run without network or an API key. Covers the series plan, the
 * stale / quiet / unavailable readings, points vs percent, the year-on-year
 * transform, error reasons, and the shared cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { z } from 'zod';
import { economicFinancialMonitorTool, __testing } from './economic-financial-monitor-tool.js';

type ToolOutput = z.infer<NonNullable<typeof economicFinancialMonitorTool.outputSchema>>;
type ToolEvent = ToolOutput['economic_events'][number];

const ORG = '00000000-0000-4000-8000-000000000000';
const DAY = 24 * 60 * 60 * 1000;

const isoDate = (daysAgo: number): string => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
/** FRED's last_updated format: "2026-11-13 07:46:02-06". */
const fredUpdated = (daysAgo: number): string => {
  const d = new Date(Date.now() - daysAgo * DAY - 6 * 60 * 60 * 1000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}-06`;
};

interface FakeSeries {
  title: string;
  units: string;
  frequency_short: string;
  seasonal_adjustment_short: string;
  observation_end: string;
  last_updated: string;
  /** Newest first. */
  values: string[];
  /** Newest first, served for units=pc1. */
  pc1?: string[];
}

let series: Record<string, FakeSeries>;
let requests: string[];
let failNext: Set<string>;
let badKey: boolean;

function monthly(overrides: Partial<FakeSeries> & Pick<FakeSeries, 'title' | 'units' | 'values'>): FakeSeries {
  return {
    frequency_short: 'M',
    seasonal_adjustment_short: 'SA',
    observation_end: isoDate(48),
    last_updated: fredUpdated(5),
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeFred(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const id = url.searchParams.get('series_id') ?? '';
  requests.push(`${url.pathname.replace('/fred/', '')}:${id}${url.searchParams.get('units') ? `:${url.searchParams.get('units')}` : ''}`);

  if (failNext.has(id)) {
    failNext.delete(id);
    return Promise.reject(new Error('simulated network error'));
  }
  if (badKey) {
    return Promise.resolve(json(400, { error_code: 400, error_message: 'Bad Request.  The value for variable api_key is not registered.' }));
  }
  const s = series[id];
  if (!s) return Promise.resolve(json(400, { error_code: 400, error_message: 'Bad Request.  The series does not exist.' }));

  if (url.pathname.endsWith('/series')) {
    const { values: _values, pc1: _pc1, ...meta } = s;
    return Promise.resolve(json(200, { seriess: [{ id, ...meta }] }));
  }
  const values = url.searchParams.get('units') === 'pc1' ? s.pc1 ?? [] : s.values;
  return Promise.resolve(json(200, {
    units: url.searchParams.get('units') ?? 'lin',
    observations: values.map((value, i) => ({ date: isoDate(48 + 30 * i), value })),
  }));
}

// Mastra's execute takes the full invocation context; only `context` matters here.
type Execute = (args: { context: Record<string, unknown> }, options: object) => Promise<ToolOutput>;
const run = (context: Record<string, unknown>): Promise<ToolOutput> =>
  (economicFinancialMonitorTool.execute as unknown as Execute)({
    context: { organization_id: ORG, severity_threshold: 'low', lookback_days: 30, ...context },
  }, {});

const event = (r: ToolOutput, id: string): ToolEvent => {
  const found = r.economic_events.find(e => e.indicator_name === id);
  if (!found) throw new Error(`no event for ${id}`);
  return found;
};

const C = (...codes: string[]) => codes.map(code => ({ country_code: code, country_name: code }));

beforeEach(() => {
  __testing.reset({ intervalMs: 0, retryMs: 0 });
  requests = [];
  failNext = new Set();
  badKey = false;
  series = {
    CPIAUCSL: monthly({ title: 'Consumer Price Index', units: 'Index 1982-1984=100', values: ['101.0', '100.0'] }),
    DFF: monthly({ title: 'Federal Funds Effective Rate', units: 'Percent', frequency_short: 'D', observation_end: isoDate(2), values: ['4.08', '4.33'] }),
    UNEMPLOY: monthly({ title: 'Unemployment Level', units: 'Thousands of Persons', values: ['7040', '7010'] }),
    HICPIT: monthly({
      title: 'Harmonized Index of Consumer Prices: Total for Italy', units: 'Index 2025=100',
      seasonal_adjustment_short: 'NSA', values: ['98.0', '100.0'], pc1: ['2.6', '2.0'],
    }),
    PPIACO: monthly({ title: 'Producer Price Index', units: 'Index 1982=100', seasonal_adjustment_short: 'NSA', values: ['250.0', '249.9'] }),
    DEADCPI: monthly({ title: 'Consumer Price Index: Old', units: 'Index 2015=100', observation_end: isoDate(400), values: ['1', '2'] }),
    QUIETCPI: monthly({ title: 'Consumer Price Index: Quiet', units: 'Index', last_updated: fredUpdated(45), values: ['110', '100'] }),
    BADDATE: monthly({ title: 'Consumer Price Index: Bad date', units: 'Index', last_updated: 'sometime', values: ['110', '100'] }),
  };
  vi.stubGlobal('fetch', vi.fn(fakeFred));
  process.env.FRED_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('planSeries', () => {
  it('attributes a series to a country that lists it in its own defaults', () => {
    const { plan } = __testing.planSeries(C('MX', 'US'), undefined);
    expect(plan.get('DFF')?.map(c => c.country_code)).toEqual(['US', 'MX']);
  });

  it('gives a country without defaults the US benchmark set under its own code', () => {
    const { plan } = __testing.planSeries(C('VN'), undefined);
    expect(plan.get('DFF')?.map(c => c.country_code)).toEqual(['VN']);
  });

  it('shares one series across the countries that list it', () => {
    const { plan } = __testing.planSeries(C('DE', 'FR'), undefined);
    expect(plan.get('ECBDFR')?.map(c => c.country_code)).toEqual(['DE', 'FR']);
  });

  it('normalises custom IDs and reports those over the limit', () => {
    const ids = [' cpiaucsl ', 'CPIAUCSL', ...Array.from({ length: 31 }, (_, i) => `S${i}`)];
    const { plan, overLimit } = __testing.planSeries(C('us'), ids);
    expect(plan.has('CPIAUCSL')).toBe(true);
    expect(plan.size).toBe(30);
    expect(overLimit).toEqual(['S29', 'S30']);
  });
});

describe('parseFredTimestamp', () => {
  it('keeps the time and offset', () => {
    expect(__testing.parseFredTimestamp('2026-11-17 15:46:02-06')).toBe('2026-11-17T15:46:02-06:00');
    expect(__testing.parseFredTimestamp('2026-11-17 15:46+05:30')).toBe('2026-11-17T15:46+05:30');
  });
});

describe('resolveIndicatorType', () => {
  it('keeps point thresholds for percentage series only', () => {
    expect(__testing.resolveIndicatorType('unemployment', false)).toBe('general');
    expect(__testing.resolveIndicatorType('interest_rate', true)).toBe('interest_rate');
    expect(__testing.resolveIndicatorType('general', true)).toBe('percent');
  });
});

describe('economic-financial-monitor tool', () => {
  it('compares a percentage series in points and a level series in percent', async () => {
    const r = await run({ countries: C('US'), indicators: ['DFF', 'CPIAUCSL'] });
    const dff = event(r, 'DFF');
    const cpi = event(r, 'CPIAUCSL');
    expect(dff.change_points).toBeCloseTo(-0.25);
    expect(dff.percent_change).toBeUndefined();
    expect(dff.event_type).toBe('interest_rate_change');
    expect(cpi.percent_change).toBeCloseTo(1.0);
    expect(cpi.change_points).toBeUndefined();
  });

  it('uses relative thresholds for a level series matched by name (UNEMPLOY)', async () => {
    const r = await run({ countries: C('US'), indicators: ['UNEMPLOY'] });
    // +0.43% in a level series: below the 3% 'general' threshold, so no event.
    expect(r.economic_events).toEqual([]);
  });

  it('compares a non-seasonally-adjusted CPI year on year', async () => {
    const r = await run({ countries: C('IT'), indicators: ['HICPIT'] });
    expect(requests).toContain('series/observations:HICPIT:pc1');
    const hicp = event(r, 'HICPIT');
    expect(hicp.change_points).toBeCloseTo(0.6);
    expect(hicp.event_type).toBe('inflation_spike');
    expect(hicp.title).toContain('(year-on-year %)');
  });

  it('does not switch an NSA producer price index to year on year', async () => {
    await run({ countries: C('US'), indicators: ['PPIACO'] });
    expect(requests).toContain('series/observations:PPIACO');
  });

  it('reports stale, unknown, and unreadable series; skips quiet ones', async () => {
    const r = await run({ countries: C('US'), indicators: ['DEADCPI', 'NOPE', 'BADDATE', 'QUIETCPI'] });
    const reasons = Object.fromEntries(r.unavailable_series.map(u => [u.series_id, u.reason]));
    expect(reasons.DEADCPI).toMatch(/^stopped updating/);
    expect(reasons.NOPE).toBe('unknown series ID (FRED HTTP 400)');
    expect(reasons.BADDATE).toMatch(/^unreadable last_updated/);
    expect(reasons.QUIETCPI).toBeUndefined();
    expect(r.economic_events).toEqual([]);
  });

  it('reports a rejected API key as such', async () => {
    badKey = true;
    const r = await run({ countries: C('US'), indicators: ['CPIAUCSL'] });
    expect(r.unavailable_series).toEqual([{ series_id: 'CPIAUCSL', reason: 'FRED rejected FRED_API_KEY (HTTP 400)' }]);
  });

  it('reports custom indicators over the limit as one entry', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `X${i}`);
    const r = await run({ countries: C('US'), indicators: ids });
    const over = r.unavailable_series.filter(u => u.reason.includes('limit'));
    expect(over).toHaveLength(1);
    expect(over[0].reason).toMatch(/^10 indicator\(s\) from X30 on not read/);
  });

  it('reports an unreadable observation_end as unreadable, not stopped', async () => {
    series.CPIAUCSL.observation_end = '';
    const r = await run({ countries: C('US'), indicators: ['CPIAUCSL'] });
    expect(r.unavailable_series[0].reason).toMatch(/^unreadable observation_end/);
  });

  it('holds back requests already waiting after a 429', async () => {
    __testing.reset({ intervalMs: 5, retryMs: 60 });
    // FRED rejects every request for 50ms after the first one.
    let blockedUntil = 0;
    let first = true;
    let rejected = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (first) {
        first = false;
        blockedUntil = Date.now() + 50;
      }
      if (Date.now() < blockedUntil) {
        rejected++;
        return Promise.resolve(json(429, {}));
      }
      return fakeFred(input);
    }));
    const r = await run({ countries: C('US'), indicators: ['CPIAUCSL', 'DFF', 'PPIACO', 'UNEMPLOY'] });
    expect(r.unavailable_series).toEqual([]);
    // Only the request that hit the limit is rejected; the ones queued behind
    // it wait out the backoff instead of firing into it.
    expect(rejected).toBe(1);
  });

  it('reports a missing API key', async () => {
    delete process.env.FRED_API_KEY;
    const r = await run({ countries: C('US') });
    expect(r.unavailable_series).toEqual([{ series_id: '*', reason: 'FRED_API_KEY is not configured' }]);
  });

  it('serves a repeat run from the cache', async () => {
    await run({ countries: C('US'), indicators: ['CPIAUCSL'] });
    const second = await run({ countries: C('US'), indicators: ['CPIAUCSL'] });
    expect(second.api_calls_made).toBe(0);
    expect(second.economic_events).toHaveLength(1);
  });

  it('does not cache a request that threw', async () => {
    failNext.add('CPIAUCSL');
    const first = await run({ countries: C('US'), indicators: ['CPIAUCSL'] });
    expect(first.unavailable_series).toEqual([{ series_id: 'CPIAUCSL', reason: 'request failed' }]);
    const second = await run({ countries: C('US'), indicators: ['CPIAUCSL'] });
    expect(second.unavailable_series).toEqual([]);
    expect(second.economic_events).toHaveLength(1);
  });

  it('emits one event for a series several countries share', async () => {
    const r = await run({ countries: C('US', 'CN'), indicators: ['CPIAUCSL'] });
    expect(r.economic_events).toHaveLength(1);
    expect(r.economic_events[0].affected_country_codes).toEqual(['US', 'CN']);
  });
});
