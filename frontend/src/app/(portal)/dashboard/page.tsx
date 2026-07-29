'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getEvents, getSuppliers, getShipments, Event, Supplier, Shipment } from '@/lib/api-client';
import Link from 'next/link';
import { Fillet } from '@/components/ui/fillet';
import { RiskBadge } from '@/components/ui/risk-badge';

/**
 * Severity chip. Delegates to the shared RiskBadge so the icon comes along —
 * severity must never be carried by colour alone, and the four-step scale used
 * here ("High"/"Medium" both sit in the Elevated family) would otherwise be
 * indistinguishable to a colourblind user.
 */
function SeverityBadge({ severity }: { severity: number }) {
  if (severity >= 0.8) return <RiskBadge level="critical" />;
  if (severity >= 0.6) return <RiskBadge level="elevated" label="High" />;
  if (severity >= 0.4) return <RiskBadge level="elevated" label="Medium" />;
  return <RiskBadge level="low" />;
}

// Event type icon mapping
function EventTypeIcon({ type }: { type: string }) {
  const iconClass = "h-4 w-4";

  switch (type.toLowerCase()) {
    case 'weather':
    case 'flood':
    case 'storm':
    case 'hurricane':
    case 'typhoon':
      return (
        <svg className={`${iconClass} text-primary`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
        </svg>
      );
    case 'earthquake':
    case 'volcano':
      return (
        <svg className={`${iconClass} text-risk-elevated-text`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      );
    case 'political':
    case 'geopolitical':
    case 'conflict':
      return (
        <svg className={`${iconClass} text-risk-critical-text`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
        </svg>
      );
    case 'cyber':
    case 'cybersecurity':
      return (
        <svg className={`${iconClass} text-primary`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
        </svg>
      );
    case 'maritime':
    case 'port':
    case 'shipping':
      return (
        <svg className={`${iconClass} text-primary`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
        </svg>
      );
    default:
      return (
        <svg className={`${iconClass} text-muted-foreground`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      );
  }
}

// Calculate overall risk level from events
function calculateRiskLevel(events: Event[]): { level: string; color: string; score: number } {
  if (events.length === 0) {
    return { level: 'Low', color: 'text-risk-low-text', score: 0 };
  }

  // Calculate weighted average severity
  const avgSeverity = events.reduce((sum, e) => sum + e.severity, 0) / events.length;
  const maxSeverity = Math.max(...events.map(e => e.severity));

  // Weight: 60% max severity, 40% average severity
  const riskScore = (maxSeverity * 0.6) + (avgSeverity * 0.4);

  if (riskScore >= 0.7) {
    return { level: 'Critical', color: 'text-risk-critical-text', score: riskScore };
  } else if (riskScore >= 0.5) {
    return { level: 'High', color: 'text-risk-elevated-text', score: riskScore };
  } else if (riskScore >= 0.3) {
    return { level: 'Medium', color: 'text-risk-elevated-text', score: riskScore };
  }
  return { level: 'Low', color: 'text-risk-low-text', score: riskScore };
}

// Format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

interface DashboardData {
  events: Event[];
  suppliers: Supplier[];
  shipments: Shipment[];
  totalEvents: number;
}

export default function DashboardPage() {
  const { user, currentOrganization } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    if (!currentOrganization?.id) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch events, suppliers, and shipments in parallel
      const [eventsRes, suppliersRes, shipmentsRes] = await Promise.all([
        // Roll up subsidiaries, matching Atlas and Intelligence — otherwise a
        // parent org's dashboard tiles disagree with the pages beside them.
        getEvents({ organizationId: currentOrganization.id, limit: 10, includeSubsidiaries: true }),
        getSuppliers({ organizationId: currentOrganization.id, includeSubsidiaries: true }),
        getShipments(currentOrganization.id, { includeSubsidiaries: true }),
      ]);

      setData({
        events: eventsRes.success && eventsRes.data ? eventsRes.data.events : [],
        suppliers: suppliersRes.success && suppliersRes.data ? suppliersRes.data : [],
        shipments: shipmentsRes.success && shipmentsRes.data ? shipmentsRes.data : [],
        totalEvents: eventsRes.success && eventsRes.data ? eventsRes.data.total : 0,
      });
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Filter active events (pending or validated, not rejected/duplicate)
  const activeEvents = data?.events.filter(
    e => e.validationStatus === 'pending' || e.validationStatus === 'validated'
  ) || [];

  // Filter suppliers for current org
  const orgSuppliers = data?.suppliers.filter(
    s => s.organizationId === currentOrganization?.id
  ) || [];

  // Calculate risk level
  const riskLevel = calculateRiskLevel(activeEvents);

  // Get recent events sorted by detection time
  const recentEvents = [...activeEvents]
    .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="font-display text-3xl font-semibold text-foreground">
            Welcome back, {user?.name || user?.email?.split('@')[0] || 'User'}
          </h2>
          <Fillet className="my-2" />
          <p className="text-muted-foreground">
            Here&apos;s an overview of your supply chain risk status
          </p>
        </div>
        <button
          onClick={fetchDashboardData}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-card border rounded-lg hover:bg-accent disabled:opacity-50"
        >
          <svg
            className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-risk-critical border border-risk-critical-accent/40 rounded-lg p-4">
          <p className="text-sm text-risk-critical-fg">{error}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Events</CardTitle>
            <svg
              className="h-4 w-4 text-risk-critical-text"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : activeEvents.length}
            </div>
            <p className="text-xs text-muted-foreground">
              {activeEvents.length === 0 ? 'No active events' : `${data?.totalEvents || 0} total detected`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suppliers Monitored</CardTitle>
            <svg
              className="h-4 w-4 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z"
              />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : orgSuppliers.length}
            </div>
            <p className="text-xs text-muted-foreground">Across all regions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Risk Score</CardTitle>
            <svg
              className={`h-4 w-4 ${riskLevel.color}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
              />
            </svg>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${riskLevel.color}`}>
              {loading ? '...' : riskLevel.level}
            </div>
            <p className="text-xs text-muted-foreground">
              {riskLevel.score > 0 ? `Score: ${(riskLevel.score * 100).toFixed(0)}%` : 'Overall risk level'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Shipments</CardTitle>
            <svg
              className="h-4 w-4 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"
              />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : (data?.shipments.length || 0)}
            </div>
            <p className="text-xs text-muted-foreground">In transit</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Recent Events</CardTitle>
                <CardDescription>
                  Latest supply chain events affecting your operations
                </CardDescription>
              </div>
              {recentEvents.length > 0 && (
                <Link
                  href="/intelligence"
                  className="text-sm text-primary hover:text-primary/80"
                >
                  View all →
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse flex items-start gap-3 p-3 rounded-lg bg-muted">
                    <div className="w-8 h-8 bg-muted-foreground/20 rounded" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted-foreground/20 rounded w-3/4" />
                      <div className="h-3 bg-muted-foreground/20 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentEvents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <svg
                  className="mx-auto h-12 w-12 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="mt-2">No active events</p>
                <p className="text-sm">Your supply chain is operating normally</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentEvents.map(event => (
                  <Link
                    key={event.id}
                    href={`/intelligence?event=${event.id}`}
                    // hover:bg-muted, NOT hover:bg-accent: the sub-label below
                    // keeps its own `text-muted-foreground`, and in dark mode
                    // that is purple-300 on --accent's purple-500 — 2.7:1, under
                    // AA. --muted (purple-700) keeps it at 4.9:1.
                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted transition-colors border border-transparent hover:border-border"
                  >
                    <div className="mt-0.5">
                      <EventTypeIcon type={event.type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{event.title}</span>
                        <SeverityBadge severity={event.severity} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {event.locationName || event.type} • {formatRelativeTime(event.detectedAt)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Common tasks and shortcuts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              href="/intelligence"
              // Same reason as the events list above: these rows carry their own
              // `text-muted-foreground` descriptions, which fail AA on --accent
              // in dark mode.
              className="w-full text-left p-3 rounded-lg border hover:bg-muted transition-colors flex items-center gap-3"
            >
              <svg className="h-5 w-5 text-risk-critical-text" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <div>
                {/* Events + Insights are one destination now (GH #12). */}
                <div className="font-medium">View Intelligence</div>
                <div className="text-sm text-muted-foreground">
                  Monitor detected events and risk analytics
                </div>
              </div>
            </Link>
            <Link
              href="/manage/suppliers"
              className="w-full text-left p-3 rounded-lg border hover:bg-muted transition-colors flex items-center gap-3"
            >
              <svg className="h-5 w-5 text-risk-low-text" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
              </svg>
              <div>
                <div className="font-medium">Manage Suppliers</div>
                <div className="text-sm text-muted-foreground">View and update supplier data</div>
              </div>
            </Link>
            <Link
              href="/plans"
              className="w-full text-left p-3 rounded-lg border hover:bg-muted transition-colors flex items-center gap-3"
            >
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              <div>
                <div className="font-medium">Response Plans</div>
                <div className="text-sm text-muted-foreground">Create and manage contingency workflows</div>
              </div>
            </Link>
          </CardContent>
        </Card>
      </div>

      {currentOrganization && (
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
            <CardDescription>Your current organization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-risk-monitoring flex items-center justify-center">
                <span className="text-xl font-bold text-risk-monitoring-fg">
                  {currentOrganization.name[0].toUpperCase()}
                </span>
              </div>
              <div>
                <div className="font-medium">{currentOrganization.name}</div>
                <div className="text-sm text-muted-foreground">Role: {currentOrganization.role}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
