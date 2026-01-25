'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Event, getEvents } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type EventStatus = 'awaiting' | 'ongoing' | 'delayed' | 'resolved';

interface StatusConfig {
  label: string;
  bgColor: string;
  textColor: string;
}

const STATUS_CONFIG: Record<EventStatus, StatusConfig> = {
  awaiting: {
    label: 'Awaiting plan initiation',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    textColor: 'text-yellow-700 dark:text-yellow-400',
  },
  ongoing: {
    label: 'Plan ongoing',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    textColor: 'text-blue-700 dark:text-blue-400',
  },
  delayed: {
    label: 'Plan delayed',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    textColor: 'text-orange-700 dark:text-orange-400',
  },
  resolved: {
    label: 'Resolved',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-400',
  },
};

const SEVERITY_CONFIG: Record<number, { label: string; color: string }> = {
  1: { label: '1', color: 'bg-yellow-500' },
  2: { label: '2', color: 'bg-orange-500' },
  3: { label: '3', color: 'bg-red-500' },
};

const TYPE_ICONS: Record<string, string> = {
  flood: 'M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z',
  strike: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z',
  port_closure: 'M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12',
  earthquake: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  typhoon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  cyber_attack: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  default: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
};

function getEventStatus(event: Event): EventStatus {
  // If validation is rejected or duplicate, treat as resolved
  if (event.validationStatus === 'rejected' || event.validationStatus === 'duplicate') {
    return 'resolved';
  }

  // If no incident, awaiting plan initiation
  if (!event.incident) {
    return 'awaiting';
  }

  // Check incident status
  switch (event.incident.status) {
    case 'resolved':
    case 'closed':
      return 'resolved';
    case 'investigating':
    case 'open':
      return 'ongoing';
    default:
      return 'awaiting';
  }
}

function getSeverityLevel(severity: number): number {
  // Map 0.0-1.0 to 1/2/3
  if (severity < 0.33) return 1;
  if (severity < 0.66) return 2;
  return 3;
}

function formatEventDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} GMT`;
}

function formatTypeLabel(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function EventsPage() {
  const { currentOrganization } = useAuth();

  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    if (!currentOrganization?.id) {
      return;
    }

    let isMounted = true;

    const fetchEvents = async () => {
      setIsLoading(true);
      const response = await getEvents({
        organizationId: currentOrganization.id,
      });

      if (!isMounted) return;

      if (response.success && response.data) {
        setEvents(response.data.events);
        setTotal(response.data.total);
      }
      setIsLoading(false);
    };

    fetchEvents();

    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id]);

  // Get unique event types for filter
  const eventTypes = useMemo(() => {
    const types = new Set(events.map((e) => e.type));
    return Array.from(types).sort();
  }, [events]);

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Search filter
      const matchesSearch =
        event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.locationName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.type.toLowerCase().includes(searchQuery.toLowerCase());

      // Status filter
      const eventStatus = getEventStatus(event);
      const matchesStatus = statusFilter === 'all' || eventStatus === statusFilter;

      // Type filter
      const matchesType = typeFilter === 'all' || event.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [events, searchQuery, statusFilter, typeFilter]);

  const isLoadingOrNoOrg = isLoading || !currentOrganization?.id;

  if (!currentOrganization) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-gray-500">Please select an organization to view events</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoadingOrNoOrg) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Events</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Monitor supply chain events for {currentOrganization.name}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="font-medium">{total}</span> total events
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="all">All Status</option>
            <option value="awaiting">Awaiting plan initiation</option>
            <option value="ongoing">Plan ongoing</option>
            <option value="delayed">Plan delayed</option>
            <option value="resolved">Resolved</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
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
        {/* Event List */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {filteredEvents.length} Event{filteredEvents.length !== 1 ? 's' : ''}
          </h3>
          <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2">
            {filteredEvents.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="mt-4 text-gray-500">No events found</p>
                </CardContent>
              </Card>
            ) : (
              filteredEvents.map((event) => {
                const status = getEventStatus(event);
                const statusConfig = STATUS_CONFIG[status];
                const severityLevel = getSeverityLevel(event.severity);
                const severityConfig = SEVERITY_CONFIG[severityLevel];

                return (
                  <button
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    className={`w-full text-left p-4 rounded-lg border transition-colors ${
                      selectedEvent?.id === event.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <div className="space-y-2">
                      {/* Header: Title + Severity */}
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium text-sm leading-tight line-clamp-2">
                          {event.title}
                        </h4>
                        <div
                          className={`shrink-0 size-6 rounded-full ${severityConfig.color} flex items-center justify-center text-white text-xs font-bold`}
                          title={`Severity ${severityLevel}`}
                        >
                          {severityConfig.label}
                        </div>
                      </div>

                      {/* Location */}
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                        </svg>
                        <span className="truncate">{event.locationName || 'Unknown location'}</span>
                      </div>

                      {/* Date/Time */}
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{formatEventDateTime(event.eventTimestamp)}</span>
                      </div>

                      {/* Status Badge */}
                      <div className="pt-1">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusConfig.bgColor} ${statusConfig.textColor}`}
                        >
                          {statusConfig.label}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Event Details */}
        <div className="lg:col-span-2 space-y-6">
          {selectedEvent ? (
            <>
              <EventDetailCard event={selectedEvent} />
              <EventMetadataCard event={selectedEvent} />
              {selectedEvent.incident && <IncidentCard incident={selectedEvent.incident} />}
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="mt-4 text-gray-500">Select an event to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function EventDetailCard({ event }: { event: Event }) {
  const status = getEventStatus(event);
  const statusConfig = STATUS_CONFIG[status];
  const severityLevel = getSeverityLevel(event.severity);
  const severityConfig = SEVERITY_CONFIG[severityLevel];
  const iconPath = TYPE_ICONS[event.type] || TYPE_ICONS.default;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-full bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shrink-0">
              <svg className="size-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
              </svg>
            </div>
            <div>
              <CardTitle className="leading-tight">{event.title}</CardTitle>
              <CardDescription className="mt-1">
                <span className="inline-flex items-center gap-1">
                  <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  {event.locationName || 'Unknown location'}
                </span>
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`size-8 rounded-full ${severityConfig.color} flex items-center justify-center text-white text-sm font-bold`}
              title={`Severity Level ${severityLevel}`}
            >
              {severityConfig.label}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status and Date/Time Row */}
        <div className="flex flex-wrap items-center gap-4">
          <span
            className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${statusConfig.bgColor} ${statusConfig.textColor}`}
          >
            {statusConfig.label}
          </span>
          <span className="text-sm text-gray-500">
            {formatEventDateTime(event.eventTimestamp)}
          </span>
        </div>

        {/* Summary */}
        <div>
          <Label className="text-gray-500 text-xs uppercase tracking-wide">Summary</Label>
          <p className="mt-1 text-sm leading-relaxed">{event.description}</p>
        </div>

        {/* Risk Factors */}
        {event.riskFactors.length > 0 && (
          <div>
            <Label className="text-gray-500 text-xs uppercase tracking-wide">Risk Factors</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {event.riskFactors.map((factor) => (
                <span
                  key={factor}
                  className="px-2 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-xs"
                >
                  {factor.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Affected Domains */}
        {event.affectedDomains.length > 0 && (
          <div>
            <Label className="text-gray-500 text-xs uppercase tracking-wide">Affected Domains</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {event.affectedDomains.map((domain) => (
                <span
                  key={domain}
                  className="px-2 py-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 rounded text-xs"
                >
                  {domain.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventMetadataCard({ event }: { event: Event }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Event Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label className="text-gray-500 text-xs uppercase tracking-wide">Type</Label>
            <p className="font-medium mt-1">{formatTypeLabel(event.type)}</p>
          </div>
          <div>
            <Label className="text-gray-500 text-xs uppercase tracking-wide">Source</Label>
            <p className="font-medium mt-1">{event.source.replace(/_/g, ' ')}</p>
          </div>
          <div>
            <Label className="text-gray-500 text-xs uppercase tracking-wide">Confidence</Label>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${event.confidence * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium">{Math.round(event.confidence * 100)}%</span>
            </div>
          </div>
          <div>
            <Label className="text-gray-500 text-xs uppercase tracking-wide">Detected At</Label>
            <p className="font-medium mt-1">{formatEventDateTime(event.detectedAt)}</p>
          </div>
          <div>
            <Label className="text-gray-500 text-xs uppercase tracking-wide">Validation Status</Label>
            <p className="font-medium mt-1 capitalize">{event.validationStatus}</p>
          </div>
          {event.validatedAt && (
            <div>
              <Label className="text-gray-500 text-xs uppercase tracking-wide">Validated At</Label>
              <p className="font-medium mt-1">{formatEventDateTime(event.validatedAt)}</p>
            </div>
          )}
          {event.latitude && event.longitude && (
            <div className="sm:col-span-2 lg:col-span-3">
              <Label className="text-gray-500 text-xs uppercase tracking-wide">Coordinates</Label>
              <p className="font-medium font-mono mt-1">
                {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function IncidentCard({ incident }: { incident: NonNullable<Event['incident']> }) {
  const priorityColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };

  const statusColors: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    investigating: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    closed: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
  };

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <svg className="size-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            Incident {incident.incidentNumber}
          </CardTitle>
          <div className="flex gap-2">
            <span className={`px-2 py-1 rounded text-xs font-medium ${priorityColors[incident.priority] || priorityColors.medium}`}>
              {incident.priority.toUpperCase()}
            </span>
            <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[incident.status] || statusColors.open}`}>
              {incident.status.toUpperCase()}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {incident.assignedTo && (
            <div>
              <Label className="text-gray-500 text-xs uppercase tracking-wide">Assigned To</Label>
              <p className="font-medium mt-1">{incident.assignedTo}</p>
            </div>
          )}
          {incident.responsePlanId && (
            <div>
              <Label className="text-gray-500 text-xs uppercase tracking-wide">Response Plan</Label>
              <p className="font-medium font-mono mt-1 text-sm">{incident.responsePlanId}</p>
            </div>
          )}
          {incident.resolvedAt && (
            <div>
              <Label className="text-gray-500 text-xs uppercase tracking-wide">Resolved At</Label>
              <p className="font-medium mt-1">{formatEventDateTime(incident.resolvedAt)}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
