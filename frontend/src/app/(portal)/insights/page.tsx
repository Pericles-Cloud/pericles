'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/providers/auth-provider';
import {
  Event,
  Supplier,
  Shipment,
  getEvents,
  getSuppliers,
  getShipments,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type TabType = 'timeline' | 'analysis' | 'impact' | 'notes';

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

export default function InsightsPage() {
  const { currentOrganization } = useAuth();

  const [events, setEvents] = useState<Event[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('analysis');
  const [generatePrompt, setGeneratePrompt] = useState('');

  // Fetch data
  useEffect(() => {
    if (!currentOrganization?.id) {
      return;
    }

    let isMounted = true;

    const fetchData = async () => {
      setIsLoading(true);

      const [eventsRes, suppliersRes, shipmentsRes] = await Promise.all([
        getEvents({ organizationId: currentOrganization.id, limit: 100 }),
        getSuppliers(),
        getShipments(currentOrganization.id),
      ]);

      if (!isMounted) return;

      if (eventsRes.success && eventsRes.data) {
        setEvents(eventsRes.data.events);
        if (eventsRes.data.events.length > 0) {
          setSelectedEvent(eventsRes.data.events[0]);
        }
      }
      if (suppliersRes.success && suppliersRes.data) {
        setSuppliers(suppliersRes.data.filter((s) => s.organizationId === currentOrganization.id));
      }
      if (shipmentsRes.success && shipmentsRes.data) {
        setShipments(shipmentsRes.data);
      }

      setIsLoading(false);
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id]);

  // Calculate country risk scores
  const countryRisks = useMemo((): CountryRisk[] => {
    const countryMap = new Map<string, CountryRisk>();

    // Count events by location/country
    events.forEach((event) => {
      if (event.locationName) {
        // Extract country from location (last part after comma or the whole string)
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
          if (!existing.riskFactors.includes(rf)) {
            existing.riskFactors.push(rf);
          }
        });
        countryMap.set(country, existing);
      }
    });

    // Add supplier countries
    suppliers.forEach((supplier) => {
      if (supplier.country) {
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
        if (supplier.countryCode) {
          existing.countryCode = supplier.countryCode;
        }
        countryMap.set(supplier.country, existing);
      }
    });

    // Count shipments by origin country (from supplier)
    shipments.forEach((shipment) => {
      const supplier = suppliers.find((s) => s.id === shipment.supplierId);
      if (supplier?.country) {
        const existing = countryMap.get(supplier.country);
        if (existing) {
          existing.shipmentCount++;
        }
      }
    });

    // Normalize risk scores
    const results = Array.from(countryMap.values()).map((c) => ({
      ...c,
      riskScore: c.eventCount > 0 ? Math.min(c.riskScore / c.eventCount, 1) : 0.1,
    }));

    return results.sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);
  }, [events, suppliers, shipments]);

  // Calculate sector/type risk scores
  const sectorRisks = useMemo((): SectorRisk[] => {
    const sectorMap = new Map<string, { total: number; count: number; recentCount: number }>();

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    events.forEach((event) => {
      const existing = sectorMap.get(event.type) || { total: 0, count: 0, recentCount: 0 };
      existing.total += event.severity;
      existing.count++;

      if (new Date(event.eventTimestamp) > oneWeekAgo) {
        existing.recentCount++;
      }

      sectorMap.set(event.type, existing);
    });

    return Array.from(sectorMap.entries())
      .map(([sector, data]) => ({
        sector: formatSectorLabel(sector),
        riskScore: data.count > 0 ? data.total / data.count : 0,
        eventCount: data.count,
        trend: data.recentCount > data.count / 2 ? 'up' : data.recentCount < data.count / 4 ? 'down' : 'stable',
      }))
      .sort((a, b) => b.riskScore - a.riskScore) as SectorRisk[];
  }, [events]);

  // Calculate risk trends (last 30 days)
  const riskTrends = useMemo((): RiskTrend[] => {
    const trends: RiskTrend[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayEvents = events.filter((e) => {
        const eventDate = new Date(e.eventTimestamp).toISOString().split('T')[0];
        return eventDate === dateStr;
      });

      const avgScore = dayEvents.length > 0
        ? dayEvents.reduce((sum, e) => sum + e.severity, 0) / dayEvents.length
        : 0;

      trends.push({
        date: dateStr,
        score: avgScore,
        eventCount: dayEvents.length,
      });
    }

    return trends;
  }, [events]);

  // Overall risk score
  const overallRiskScore = useMemo(() => {
    if (events.length === 0) return 0;
    return events.reduce((sum, e) => sum + e.severity, 0) / events.length;
  }, [events]);

  const handleGenerate = () => {
    // Placeholder for AI generation feature
    console.log('Generate insight for:', generatePrompt);
    setGeneratePrompt('');
  };

  if (!currentOrganization) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-gray-500">Please select an organization to view insights</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-500">Loading insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex gap-4">
      {/* Events Sidebar */}
      <div className="w-64 shrink-0 flex flex-col">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="border-b shrink-0 py-3">
            <CardTitle className="text-base">Events</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0">
            {events.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No events found
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {events.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    className={`w-full text-left p-3 transition-colors ${
                      selectedEvent?.id === event.id
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 border-blue-500'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border-l-2 border-transparent'
                    }`}
                  >
                    <h4 className="font-medium text-sm leading-tight line-clamp-2">
                      {event.title}
                    </h4>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {event.description}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 gap-4">
        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2">
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            Create Memo
          </Button>
          <Button variant="outline" className="gap-2">
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
            </svg>
            Create Report
          </Button>
          <Button variant="outline" className="gap-2">
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
            </svg>
            Create Dashboard
          </Button>
        </div>

        {/* Analytics Dashboard */}
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="border-b shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Risk Analytics Dashboard</CardTitle>
                <CardDescription>
                  Country and sector risk analysis for {currentOrganization.name}
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Overall Risk Score</div>
                  <div className={`text-2xl font-bold ${getRiskColor(overallRiskScore)}`}>
                    {(overallRiskScore * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Country Risk Chart */}
              <div>
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <svg className="size-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                  </svg>
                  Country Risk Scores
                </h3>
                <div className="space-y-2">
                  {countryRisks.length === 0 ? (
                    <p className="text-sm text-gray-500">No country data available</p>
                  ) : (
                    countryRisks.map((country) => (
                      <CountryRiskBar key={country.country} country={country} />
                    ))
                  )}
                </div>
              </div>

              {/* Sector Risk Chart */}
              <div>
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <svg className="size-5 text-purple-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                  Sector Risk Analysis
                </h3>
                <div className="space-y-2">
                  {sectorRisks.length === 0 ? (
                    <p className="text-sm text-gray-500">No sector data available</p>
                  ) : (
                    sectorRisks.map((sector) => (
                      <SectorRiskBar key={sector.sector} sector={sector} />
                    ))
                  )}
                </div>
              </div>

              {/* Risk Trend Chart */}
              <div className="lg:col-span-2">
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <svg className="size-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                  </svg>
                  30-Day Risk Trend
                </h3>
                <RiskTrendChart trends={riskTrends} />
              </div>
            </div>
          </CardContent>

          {/* Generate Input */}
          <div className="border-t p-4 shrink-0">
            <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-800 rounded-lg p-2">
              <div className="size-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center shrink-0">
                <svg className="size-4 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <input
                type="text"
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder="Ask for insights or analysis..."
                className="flex-1 bg-transparent border-none outline-none text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={!generatePrompt.trim()}
                className="gap-1"
              >
                <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                </svg>
                Generate
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Analysis Panel */}
      <div className="w-80 shrink-0">
        <Card className="h-full flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b shrink-0">
            {(['timeline', 'analysis', 'impact', 'notes'] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-900/20'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <CardContent className="flex-1 overflow-y-auto p-4">
            {selectedEvent ? (
              <AnalysisContent event={selectedEvent} activeTab={activeTab} />
            ) : (
              <div className="text-center text-gray-500">
                <p>Select an event to view analysis</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
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

  const getTrendIcon = () => {
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
          {getTrendIcon()}
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
      <div className="text-xs text-gray-500 mt-1">
        {sector.eventCount} events
      </div>
    </div>
  );
}

function RiskTrendChart({ trends }: { trends: RiskTrend[] }) {
  const maxScore = Math.max(...trends.map((t) => t.score), 0.1);

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
      <div className="flex items-end gap-1 h-32">
        {trends.map((trend, index) => {
          const scoreHeight = (trend.score / maxScore) * 100;

          return (
            <div
              key={trend.date}
              className="flex-1 flex flex-col items-center gap-1 group relative"
            >
              {/* Score bar */}
              <div className="w-full flex flex-col justify-end h-full">
                <div
                  className={`w-full rounded-t ${getRiskBgColor(trend.score)} opacity-70 transition-all group-hover:opacity-100`}
                  style={{ height: `${scoreHeight}%`, minHeight: trend.score > 0 ? '2px' : '0' }}
                />
              </div>

              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                  <div>{new Date(trend.date).toLocaleDateString()}</div>
                  <div>Risk: {(trend.score * 100).toFixed(0)}%</div>
                  <div>{trend.eventCount} events</div>
                </div>
              </div>

              {/* X-axis label (show every 5th) */}
              {index % 7 === 0 && (
                <div className="text-[9px] text-gray-400 mt-1">
                  {new Date(trend.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnalysisContent({ event, activeTab }: { event: Event; activeTab: TabType }) {
  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  switch (activeTab) {
    case 'timeline':
      return (
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">Timeline</h3>
          <div className="space-y-3">
            <TimelineItem
              label="Detected"
              time={formatDateTime(event.detectedAt)}
              description="Event first detected by monitoring system"
            />
            <TimelineItem
              label="Event Time"
              time={formatDateTime(event.eventTimestamp)}
              description="When the event actually occurred"
            />
            {event.validatedAt && (
              <TimelineItem
                label="Validated"
                time={formatDateTime(event.validatedAt)}
                description={`Status: ${event.validationStatus}`}
              />
            )}
            {event.incident && (
              <TimelineItem
                label="Incident Created"
                time={event.incident.incidentNumber}
                description={`Priority: ${event.incident.priority}, Status: ${event.incident.status}`}
              />
            )}
          </div>
        </div>
      );

    case 'analysis':
      return (
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">Analysis</h3>
          <div className="prose prose-sm dark:prose-invert">
            <p>{event.description}</p>
            <h4 className="text-sm font-medium mt-4">Risk Assessment</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500">Severity:</span>
                <span className={`ml-1 font-medium ${getRiskColor(event.severity)}`}>
                  {(event.severity * 100).toFixed(0)}%
                </span>
              </div>
              <div>
                <span className="text-gray-500">Confidence:</span>
                <span className="ml-1 font-medium">{(event.confidence * 100).toFixed(0)}%</span>
              </div>
            </div>
            {event.riskFactors.length > 0 && (
              <>
                <h4 className="text-sm font-medium mt-4">Risk Factors</h4>
                <ul className="text-sm space-y-1">
                  {event.riskFactors.map((factor) => (
                    <li key={factor} className="text-gray-600 dark:text-gray-400">
                      {factor.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      );

    case 'impact':
      return (
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">Impact</h3>
          <div className="prose prose-sm dark:prose-invert">
            {event.affectedDomains.length > 0 ? (
              <>
                <h4 className="text-sm font-medium">Affected Domains</h4>
                <div className="flex flex-wrap gap-2">
                  {event.affectedDomains.map((domain) => (
                    <span
                      key={domain}
                      className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs"
                    >
                      {domain.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-gray-500">No impact data available for this event.</p>
            )}
            {event.locationName && (
              <>
                <h4 className="text-sm font-medium mt-4">Geographic Impact</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">{event.locationName}</p>
              </>
            )}
            {event.incident && (
              <>
                <h4 className="text-sm font-medium mt-4">Incident Status</h4>
                <p className="text-sm">
                  {event.incident.incidentNumber} - {event.incident.status}
                </p>
              </>
            )}
          </div>
        </div>
      );

    case 'notes':
      return (
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">Notes</h3>
          <div className="prose prose-sm dark:prose-invert">
            <p className="text-gray-500">No notes have been added for this event yet.</p>
            <div className="mt-4">
              <textarea
                placeholder="Add a note..."
                className="w-full h-24 p-2 text-sm border rounded-md resize-none"
              />
              <Button size="sm" className="mt-2">
                Save Note
              </Button>
            </div>
          </div>
        </div>
      );
  }
}

function TimelineItem({ label, time, description }: { label: string; time: string; description: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="size-2 rounded-full bg-blue-500" />
        <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="pb-4">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-gray-500">{time}</div>
        <div className="text-xs text-gray-400 mt-1">{description}</div>
      </div>
    </div>
  );
}

// Utility functions
function formatSectorLabel(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getRiskColor(score: number): string {
  if (score >= 0.66) return 'text-red-600 dark:text-red-400';
  if (score >= 0.33) return 'text-orange-600 dark:text-orange-400';
  return 'text-yellow-600 dark:text-yellow-400';
}

function getRiskBgColor(score: number): string {
  if (score >= 0.66) return 'bg-red-500';
  if (score >= 0.33) return 'bg-orange-500';
  return 'bg-yellow-500';
}
