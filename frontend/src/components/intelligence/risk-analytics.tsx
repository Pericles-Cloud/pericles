'use client';

import { useMemo } from 'react';
import type { Event, Shipment, Supplier } from '@/lib/api-client';
import { formatTypeLabel, getRiskBgColor, getRiskColor } from '@/lib/intelligence-utils';

interface CountryRisk {
  country: string;
  countryCode: string;
  riskScore: number;
  eventCount: number;
  supplierCount: number;
  shipmentCount: number;
  riskFactors: string[];
}

interface SectorRisk {
  sector: string;
  riskScore: number;
  eventCount: number;
  trend: 'up' | 'down' | 'stable';
}

interface RiskTrend {
  date: string;
  score: number;
  eventCount: number;
}

interface RiskAnalyticsProps {
  events: Event[];
  suppliers: Supplier[];
  shipments: Shipment[];
}

/**
 * Country / sector / trend risk analytics (formerly the /insights dashboard).
 * Pure presentation over already-tenant-scoped data — the page fetches, this
 * component only aggregates what it is handed.
 */
export function RiskAnalytics({ events, suppliers, shipments }: RiskAnalyticsProps) {
  const countryRisks = useMemo((): CountryRisk[] => {
    const countryMap = new Map<string, CountryRisk>();

    // Count events by location/country.
    events.forEach((event) => {
      if (!event.locationName) return;
      // Country is the last comma-separated part, or the whole string.
      const parts = event.locationName.split(',').map((p) => p.trim());
      const country = parts[parts.length - 1] || event.locationName;
      const existing = countryMap.get(country) || {
        country,
        countryCode: '',
        riskScore: 0,
        eventCount: 0,
        supplierCount: 0,
        shipmentCount: 0,
        riskFactors: [],
      };

      existing.eventCount++;
      existing.riskScore += event.severity;
      event.riskFactors.forEach((rf) => {
        if (!existing.riskFactors.includes(rf)) existing.riskFactors.push(rf);
      });
      countryMap.set(country, existing);
    });

    // Add supplier countries.
    suppliers.forEach((supplier) => {
      if (!supplier.country) return;
      const existing = countryMap.get(supplier.country) || {
        country: supplier.country,
        countryCode: supplier.countryCode || '',
        riskScore: 0,
        eventCount: 0,
        supplierCount: 0,
        shipmentCount: 0,
        riskFactors: [],
      };

      existing.supplierCount++;
      if (supplier.countryCode) existing.countryCode = supplier.countryCode;
      countryMap.set(supplier.country, existing);
    });

    // Count shipments by origin country (via their supplier).
    shipments.forEach((shipment) => {
      const supplier = suppliers.find((s) => s.id === shipment.supplierId);
      if (!supplier?.country) return;
      const existing = countryMap.get(supplier.country);
      if (existing) existing.shipmentCount++;
    });

    return Array.from(countryMap.values())
      .map((c) => ({
        ...c,
        riskScore: c.eventCount > 0 ? Math.min(c.riskScore / c.eventCount, 1) : 0.1,
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);
  }, [events, suppliers, shipments]);

  const sectorRisks = useMemo((): SectorRisk[] => {
    const sectorMap = new Map<string, { total: number; count: number; recentCount: number }>();

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    events.forEach((event) => {
      const existing = sectorMap.get(event.type) || { total: 0, count: 0, recentCount: 0 };
      existing.total += event.severity;
      existing.count++;
      if (new Date(event.eventTimestamp) > oneWeekAgo) existing.recentCount++;
      sectorMap.set(event.type, existing);
    });

    return Array.from(sectorMap.entries())
      .map(([sector, data]) => ({
        sector: formatTypeLabel(sector),
        riskScore: data.count > 0 ? data.total / data.count : 0,
        eventCount: data.count,
        trend:
          data.recentCount > data.count / 2 ? 'up' : data.recentCount < data.count / 4 ? 'down' : 'stable',
      }))
      .sort((a, b) => b.riskScore - a.riskScore) as SectorRisk[];
  }, [events]);

  const riskTrends = useMemo((): RiskTrend[] => {
    const trends: RiskTrend[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayEvents = events.filter(
        (e) => new Date(e.eventTimestamp).toISOString().split('T')[0] === dateStr,
      );

      trends.push({
        date: dateStr,
        score:
          dayEvents.length > 0
            ? dayEvents.reduce((sum, e) => sum + e.severity, 0) / dayEvents.length
            : 0,
        eventCount: dayEvents.length,
      });
    }

    return trends;
  }, [events]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Country Risk */}
      <div>
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <svg className="size-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
            />
          </svg>
          Country Risk Scores
        </h3>
        <div className="space-y-2">
          {countryRisks.length === 0 ? (
            <p className="text-sm text-gray-500">No country data available</p>
          ) : (
            countryRisks.map((country) => <CountryRiskBar key={country.country} country={country} />)
          )}
        </div>
      </div>

      {/* Sector Risk */}
      <div>
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <svg className="size-5 text-purple-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
            />
          </svg>
          Sector Risk Analysis
        </h3>
        <div className="space-y-2">
          {sectorRisks.length === 0 ? (
            <p className="text-sm text-gray-500">No sector data available</p>
          ) : (
            sectorRisks.map((sector) => <SectorRiskBar key={sector.sector} sector={sector} />)
          )}
        </div>
      </div>

      {/* 30-Day Trend */}
      <div className="lg:col-span-2">
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <svg className="size-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"
            />
          </svg>
          30-Day Risk Trend
        </h3>
        <RiskTrendChart trends={riskTrends} />
      </div>
    </div>
  );
}

/** Mean severity across all loaded events — the headline number. */
export function overallRiskScore(events: Event[]): number {
  if (events.length === 0) return 0;
  return events.reduce((sum, e) => sum + e.severity, 0) / events.length;
}

function CountryRiskBar({ country }: { country: CountryRisk }) {
  const percentage = country.riskScore * 100;

  return (
    <div className="group">
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-medium truncate flex-1">{country.country}</span>
        <span className={`text-xs font-medium ml-2 ${getRiskColor(country.riskScore)}`}>
          {percentage.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${getRiskBgColor(country.riskScore)}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
        <span>{country.eventCount} events</span>
        <span>{country.supplierCount} suppliers</span>
        <span>{country.shipmentCount} shipments</span>
      </div>
    </div>
  );
}

function SectorRiskBar({ sector }: { sector: SectorRisk }) {
  const percentage = sector.riskScore * 100;

  const trendIcon = () => {
    switch (sector.trend) {
      case 'up':
        return (
          <svg className="size-3 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
          </svg>
        );
      case 'down':
        return (
          <svg className="size-3 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5l15 15m0 0V8.25m0 11.25H8.25" />
          </svg>
        );
      default:
        return (
          <svg className="size-3 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
          </svg>
        );
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-medium truncate flex-1 flex items-center gap-1">
          {sector.sector}
          {trendIcon()}
        </span>
        <span className={`text-xs font-medium ml-2 ${getRiskColor(sector.riskScore)}`}>
          {percentage.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${getRiskBgColor(sector.riskScore)}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="text-xs text-gray-500 mt-1">{sector.eventCount} events</div>
    </div>
  );
}

function RiskTrendChart({ trends }: { trends: RiskTrend[] }) {
  const maxScore = Math.max(...trends.map((t) => t.score), 0.1);

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
      <div className="flex items-end gap-1 h-32">
        {trends.map((trend, index) => (
          <div key={trend.date} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="w-full flex flex-col justify-end h-full">
              <div
                className={`w-full rounded-t ${getRiskBgColor(trend.score)} opacity-70 transition-all group-hover:opacity-100`}
                style={{
                  height: `${(trend.score / maxScore) * 100}%`,
                  minHeight: trend.score > 0 ? '2px' : '0',
                }}
              />
            </div>

            <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
              <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                <div>{new Date(trend.date).toLocaleDateString()}</div>
                <div>Risk: {(trend.score * 100).toFixed(0)}%</div>
                <div>{trend.eventCount} events</div>
              </div>
            </div>

            {/* X-axis label every 7th day. */}
            {index % 7 === 0 && (
              <div className="text-[9px] text-gray-400 mt-1">
                {new Date(trend.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
