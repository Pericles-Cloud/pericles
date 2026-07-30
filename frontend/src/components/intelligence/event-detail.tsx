'use client';

import type { Event } from '@/lib/api-client';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  SEVERITY_CONFIG,
  STATUS_CONFIG,
  TYPE_ICONS,
  formatEventDateTime,
  formatTypeLabel,
  getEventStatus,
  getSeverityLevel,
} from '@/lib/intelligence-utils';

export function EventDetailCard({ event }: { event: Event }) {
  const statusConfig = STATUS_CONFIG[getEventStatus(event)];
  const severityLevel = getSeverityLevel(event.severity);
  const severityConfig = SEVERITY_CONFIG[severityLevel];
  const iconPath = TYPE_ICONS[event.type] || TYPE_ICONS.default;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-full bg-primary flex items-center justify-center shrink-0">
              <svg className="size-6 text-primary-foreground" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
              </svg>
            </div>
            <div>
              <CardTitle className="leading-tight">{event.title}</CardTitle>
              <CardDescription className="mt-1">
                <span className="inline-flex items-center gap-1">
                  <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                    />
                  </svg>
                  {event.locationName || 'Unknown location'}
                </span>
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`size-8 rounded-full ${severityConfig.color} flex items-center justify-center text-sm font-bold`}
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
          <span className="text-sm text-muted-foreground">{formatEventDateTime(event.eventTimestamp)}</span>
        </div>

        {/* Summary */}
        <div>
          <Label className="text-muted-foreground text-xs uppercase tracking-wide">Summary</Label>
          <p className="mt-1 text-sm leading-relaxed">{event.description}</p>
        </div>

        {/* Risk Factors */}
        {event.riskFactors.length > 0 && (
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Risk Factors</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {event.riskFactors.map((factor) => (
                <span
                  key={factor}
                  className="px-2 py-1 bg-risk-critical text-risk-critical-fg rounded text-xs"
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
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Affected Domains</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {event.affectedDomains.map((domain) => (
                <span
                  key={domain}
                  className="px-2 py-1 bg-primary/10 text-primary rounded text-xs"
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

export function EventMetadataCard({ event }: { event: Event }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Event Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Type</Label>
            <p className="font-medium mt-1">{formatTypeLabel(event.type)}</p>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Source</Label>
            <p className="font-medium mt-1">{event.source.replace(/_/g, ' ')}</p>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Confidence</Label>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-2 bg-muted-foreground/25 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${event.confidence * 100}%` }} />
              </div>
              <span className="text-sm font-medium">{Math.round(event.confidence * 100)}%</span>
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Detected At</Label>
            <p className="font-medium mt-1">{formatEventDateTime(event.detectedAt)}</p>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Validation Status</Label>
            <p className="font-medium mt-1 capitalize">{event.validationStatus}</p>
          </div>
          {event.validatedAt && (
            <div>
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Validated At</Label>
              <p className="font-medium mt-1">{formatEventDateTime(event.validatedAt)}</p>
            </div>
          )}
          {event.latitude && event.longitude && (
            <div className="sm:col-span-2 lg:col-span-3">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Coordinates</Label>
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

export function IncidentCard({ incident }: { incident: NonNullable<Event['incident']> }) {
  // `high` and `medium` deliberately share the Elevated family: the backend's
  // 4-value priority collapses onto the platform's 3 risk families, and the
  // chip's own label carries the distinction. Identical values here are
  // intentional, not a copy-paste — severity is never colour-only anyway.
  const priorityColors: Record<string, string> = {
    critical: 'bg-risk-critical text-risk-critical-fg',
    high: 'bg-risk-elevated text-risk-elevated-fg',
    medium: 'bg-risk-elevated text-risk-elevated-fg',
    low: 'bg-risk-low text-risk-low-fg',
  };

  const statusColors: Record<string, string> = {
    open: 'bg-risk-monitoring text-risk-monitoring-fg',
    investigating: 'bg-primary/10 text-primary',
    resolved: 'bg-risk-low text-risk-low-fg',
    closed: 'bg-muted text-muted-foreground',
  };

  return (
    <Card className="border-risk-monitoring-accent/40">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <svg className="size-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            Incident {incident.incidentNumber}
          </CardTitle>
          <div className="flex gap-2">
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${priorityColors[incident.priority] || priorityColors.medium}`}
            >
              {incident.priority.toUpperCase()}
            </span>
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${statusColors[incident.status] || statusColors.open}`}
            >
              {incident.status.toUpperCase()}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {incident.assignedTo && (
            <div>
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Assigned To</Label>
              <p className="font-medium mt-1">{incident.assignedTo}</p>
            </div>
          )}
          {incident.responsePlanId && (
            <div>
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Response Plan</Label>
              <p className="font-medium font-mono mt-1 text-sm">{incident.responsePlanId}</p>
            </div>
          )}
          {incident.resolvedAt && (
            <div>
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Resolved At</Label>
              <p className="font-medium mt-1">{formatEventDateTime(incident.resolvedAt)}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
