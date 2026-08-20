'use client';

/**
 * Intelligence — the merged Events + Insights module (GH #12).
 *
 * One event stream, two views over it:
 *   • Feed      — the monitored event list, its filters, and full event detail
 *                 (formerly /events) plus the per-event analysis tabs.
 *   • Analytics — country/sector/trend risk analysis (formerly /insights).
 *
 * Selection is shared: picking an event in the feed keeps it selected when you
 * switch views. /events and /insights redirect here (see next.config.ts).
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import {
  CountryRiskAggregate,
  Event,
  getCountryRisk,
  getEvents,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { EventList } from '@/components/intelligence/event-list';
import { AnalysisTabs } from '@/components/intelligence/analysis-tabs';
import { RiskAnalytics, overallRiskScore } from '@/components/intelligence/risk-analytics';
import {
  EventDetailCard,
  EventMetadataCard,
  IncidentCard,
} from '@/components/intelligence/event-detail';
import { formatTypeLabel, getEventStatus, getRiskColor } from '@/lib/intelligence-utils';
import { Fillet } from '@/components/ui/fillet';

type IntelligenceView = 'feed' | 'analytics';

export default function IntelligencePage() {
  // useSearchParams needs a Suspense boundary to keep the route prerenderable.
  return (
    <Suspense fallback={<LoadingState />}>
      <IntelligenceContent />
    </Suspense>
  );
}

function IntelligenceContent() {
  const { currentOrganization } = useAuth();
  const searchParams = useSearchParams();
  // Atlas and the dashboard deep-link here as /intelligence?event=<id>.
  // `selected` is the pre-merge spelling from /events — the redirect in
  // next.config.ts carries the old query string through unchanged, so honour it
  // rather than silently dropping a bookmarked link's selection.
  const deepLinkedEventId = searchParams.get('event') ?? searchParams.get('selected');

  const [events, setEvents] = useState<Event[]>([]);
  // Pre-aggregated analytics data (GH #13): fetched lazily the first time the
  // Analytics view opens, never on mount — the Feed must not pay for it.
  const [countryRisk, setCountryRisk] = useState<CountryRiskAggregate[]>([]);
  const [total, setTotal] = useState(0);
  // Only the user's explicit pick is state; the deep link and the
  // newest-event default are derived below.
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Flipped once, when the Analytics view is first opened. Keying the analytics
  // effect on this rather than on `view` means switching back to the Feed and
  // returning does not refetch — the data is cached for the session.
  const [analyticsRequested, setAnalyticsRequested] = useState(false);

  const [view, setView] = useState<IntelligenceView>('feed');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [generatePrompt, setGeneratePrompt] = useState('');

  // Events are the Feed; the Analytics data is deferred (GH #13).
  useEffect(() => {
    if (!currentOrganization?.id) return;
    let isMounted = true;

    const fetchEvents = async () => {
      setIsLoadingEvents(true);
      setLoadError(null);
      // Drop the outgoing organization's events before the new request resolves.
      // Without this, a failed fetch after an org switch leaves the previous
      // tenant's events on screen under the incoming tenant's name.
      setEvents([]);
      setTotal(0);
      setUserSelectedId(null);

      // Tenant-scoped server-side by organizationId — never filtered client-side.
      const eventsRes = await getEvents({
        organizationId: currentOrganization.id,
        limit: 100,
        includeSubsidiaries: true,
      });

      if (!isMounted) return;

      if (eventsRes.success && eventsRes.data) {
        setEvents(eventsRes.data.events);
        setTotal(eventsRes.data.total);
      } else {
        setLoadError(
          `Could not load events for ${currentOrganization.name}. ` +
            'What is shown may be incomplete — reload to try again.',
        );
      }

      setIsLoadingEvents(false);
    };

    fetchEvents();
    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id, currentOrganization?.name]);

  // Supplier/shipment aggregates feed the Analytics view. Fetched on first use
  // only (GH #13): the Feed renders as soon as events land, and this issues no
  // request until the Analytics view has been opened at least once. The count
  // aggregation happens in Postgres, so the client no longer downloads full
  // Supplier/Shipment rows to reduce them to per-country counters.
  useEffect(() => {
    if (!analyticsRequested || !currentOrganization?.id) return;
    let isMounted = true;

    const fetchAnalytics = async () => {
      setIsLoadingAnalytics(true);
      setCountryRisk([]);

      const res = await getCountryRisk(currentOrganization.id, { includeSubsidiaries: true });

      if (!isMounted) return;

      if (res.success && res.data) {
        setCountryRisk(res.data);
      } else {
        setLoadError(
          `Could not load risk analytics for ${currentOrganization.name}. ` +
            'Country/supplier/shipment counts may be incomplete.',
        );
      }

      setIsLoadingAnalytics(false);
    };

    fetchAnalytics();
    return () => {
      isMounted = false;
    };
  }, [analyticsRequested, currentOrganization?.id, currentOrganization?.name]);

  // Resolve the deep link against whatever is loaded.
  const deepLinkedEvent = useMemo(
    () => (deepLinkedEventId ? (events.find((e) => e.id === deepLinkedEventId) ?? null) : null),
    [deepLinkedEventId, events],
  );

  // A deep link that isn't in the fetched window is surfaced rather than
  // silently falling back to the newest event — otherwise the user reads a
  // different event from the one they clicked and has no way to tell.
  const deepLinkMissed =
    deepLinkedEventId !== null && events.length > 0 && deepLinkedEvent === null;

  // The user's pick wins; then the deep link; then the newest event.
  const selectedEventId = useMemo(() => {
    if (userSelectedId) return userSelectedId;
    if (deepLinkedEventId) return deepLinkedEvent?.id ?? null;
    return events[0]?.id ?? null;
  }, [userSelectedId, deepLinkedEventId, deepLinkedEvent, events]);

  const eventTypes = useMemo(
    () => Array.from(new Set(events.map((e) => e.type))).sort(),
    [events],
  );

  const filteredEvents = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return events.filter((event) => {
      const matchesSearch =
        event.title.toLowerCase().includes(query) ||
        event.description.toLowerCase().includes(query) ||
        event.locationName?.toLowerCase().includes(query) ||
        event.type.toLowerCase().includes(query);

      const matchesStatus = statusFilter === 'all' || getEventStatus(event) === statusFilter;
      const matchesType = typeFilter === 'all' || event.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [events, searchQuery, statusFilter, typeFilter]);

  // Derive the selected event so a filtered-out selection can't go stale.
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  const handleSelect = useCallback((event: Event) => setUserSelectedId(event.id), []);

  // Generation and the Create Memo/Report/Dashboard actions all route through
  // the Co-Pilot path (pericles-copilot-ui), which is not built yet. The
  // controls stay visible so the shape of the module is legible, but they are
  // disabled — a button that clears its input and does nothing else reads as
  // success.
  const COPILOT_UNAVAILABLE = 'Not available yet — Co-Pilot generation is not wired up';

  if (!currentOrganization) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Please select an organization to view intelligence</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoadingEvents) return <LoadingState />;

  return (
    <div className="space-y-6">
      {/* Header + view switcher */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-3xl font-semibold text-foreground">Intelligence</h2>
          <Fillet className="my-2" />
          <p className="text-muted-foreground">
            Monitor supply chain events and risk analysis for {currentOrganization.name}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">{total}</span> total events
          </div>
          <div className="flex items-center rounded-md border overflow-hidden" role="tablist">
            {(['feed', 'analytics'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => {
                  setView(v);
                  // First visit to Analytics triggers the deferred fetch (GH #13);
                  // subsequent visits reuse the cached result.
                  if (v === 'analytics') setAnalyticsRequested(true);
                }}
                className={cn(
                  'px-4 py-1.5 text-sm transition-colors',
                  view === v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {v === 'feed' ? 'Feed' : 'Analytics'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="rounded-md border border-risk-critical-accent/40 bg-risk-critical px-4 py-3 text-sm text-risk-critical-fg"
        >
          {loadError}
        </div>
      )}

      {deepLinkMissed && (
        <div
          role="status"
          className="rounded-md border border-risk-elevated-accent/40 bg-risk-elevated px-4 py-3 text-sm text-risk-elevated-fg"
        >
          That event is not in the current window of monitored events. Pick one from the feed.
        </div>
      )}

      {view === 'feed' ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search events..."
                aria-label="Search events"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="all">All Status</option>
                <option value="awaiting">Awaiting plan initiation</option>
                <option value="ongoing">Plan ongoing</option>
                {/* No "Plan delayed" option: getEventStatus cannot return
                    'delayed' yet (no incident status maps to it), so offering it
                    would only ever filter down to nothing. */}
                <option value="resolved">Resolved</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by type"
                className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="all">All Types</option>
                {eventTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatTypeLabel(type)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Event list */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {filteredEvents.length} Event{filteredEvents.length !== 1 ? 's' : ''}
              </h3>
              <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2">
                <EventList
                  events={filteredEvents}
                  selectedEventId={selectedEventId}
                  onSelect={handleSelect}
                />
              </div>
            </div>

            {/* Detail + analysis */}
            <div className="lg:col-span-2 space-y-6">
              {selectedEvent ? (
                <>
                  <EventDetailCard event={selectedEvent} />
                  <EventMetadataCard event={selectedEvent} />
                  {selectedEvent.incident && <IncidentCard incident={selectedEvent.incident} />}
                  <Card className="overflow-hidden">
                    <AnalysisTabs event={selectedEvent} />
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
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
                        d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                      />
                    </svg>
                    <p className="mt-4 text-muted-foreground">Select an event to view details</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {/* Report actions */}
          <div className="flex gap-3 flex-wrap">
            <Button variant="outline" className="gap-2" disabled title={COPILOT_UNAVAILABLE}>
              <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
              Create Memo
            </Button>
            <Button variant="outline" className="gap-2" disabled title={COPILOT_UNAVAILABLE}>
              <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"
                />
              </svg>
              Create Report
            </Button>
            <Button variant="outline" className="gap-2" disabled title={COPILOT_UNAVAILABLE}>
              <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z"
                />
              </svg>
              Create Dashboard
            </Button>
          </div>

          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>Risk Analytics Dashboard</CardTitle>
                  <CardDescription>
                    Country and sector risk analysis for {currentOrganization.name}
                  </CardDescription>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">
                    Overall Risk Score
                  </div>
                  <div className={`text-2xl font-bold ${getRiskColor(overallRiskScore(events))}`}>
                    {(overallRiskScore(events) * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {isLoadingAnalytics ? (
                <div className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
                    <p className="mt-4 text-muted-foreground">Loading analytics...</p>
                  </div>
                </div>
              ) : (
                <RiskAnalytics events={events} countryRiskData={countryRisk} />
              )}
            </CardContent>

            {/* Co-Pilot prompt bar */}
            <div className="border-t p-4">
              <div className="flex items-center gap-3 bg-muted rounded-lg p-2">
                <div className="size-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <svg
                    className="size-4 text-primary-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                    />
                  </svg>
                </div>
                <input
                  type="text"
                  value={generatePrompt}
                  onChange={(e) => setGeneratePrompt(e.target.value)}
                  placeholder="Ask for insights or analysis (coming soon)"
                  aria-label="Ask for insights or analysis"
                  disabled
                  title={COPILOT_UNAVAILABLE}
                  className="flex-1 bg-transparent border-none outline-none text-sm disabled:cursor-not-allowed"
                />
                <Button size="sm" disabled title={COPILOT_UNAVAILABLE} className="gap-1">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
                    />
                  </svg>
                  Generate
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
        <p className="mt-4 text-muted-foreground">Loading intelligence...</p>
      </div>
    </div>
  );
}
