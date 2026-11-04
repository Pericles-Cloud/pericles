'use client';

import type { GlobalEvent } from '@/lib/api-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  GLOBAL_EVENT_STATUS_CONFIG,
  INTRINSIC_SEVERITY_CONFIG,
  formatEventDateTime,
  formatTypeLabel,
} from '@/lib/intelligence-utils';
import { cn } from '@/lib/utils';

interface GlobalEventListProps {
  events: GlobalEvent[];
  selectedEventId: string | null;
  onSelect: (event: GlobalEvent) => void;
}

/** Human-readable location line: admin region + country, then infrastructure. */
export function formatGlobalEventLocation(event: GlobalEvent): string {
  const parts = [event.location.admin1Region, event.location.countryIso].filter(Boolean);
  const place = parts.join(', ');
  const infra = event.location.namedInfrastructure?.map((i) => i.name).join(', ');
  return [place, infra].filter(Boolean).join(' · ') || 'Location not geocoded';
}

/**
 * The Global view's selectable list (Doctrine §13): events detected by the
 * Global Monitoring Agent, shared across all organizations — no tenant
 * scoping applies here.
 */
export function GlobalEventList({ events, selectedEventId, onSelect }: GlobalEventListProps) {
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m-18.432 0A8.959 8.959 0 013 12c0-.778.099-1.533.284-2.253"
            />
          </svg>
          <p className="mt-4 text-muted-foreground">No global events in the current window</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {events.map((event) => {
        const severity = INTRINSIC_SEVERITY_CONFIG[event.intrinsicSeverity];
        const status = GLOBAL_EVENT_STATUS_CONFIG[event.status];

        return (
          <button
            key={event.id}
            onClick={() => onSelect(event)}
            aria-current={selectedEventId === event.id}
            className={`w-full text-left p-4 rounded-lg border transition-colors ${
              selectedEventId === event.id
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-muted'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium text-sm leading-tight line-clamp-2">{event.headline}</h4>
                <span
                  className={cn(
                    'shrink-0 inline-flex px-2 py-0.5 rounded text-xs font-medium',
                    severity.bgColor,
                    severity.textColor,
                  )}
                >
                  {severity.label}
                </span>
              </div>

              <div className="text-xs text-muted-foreground truncate">
                {formatGlobalEventLocation(event)}
              </div>

              <div className="text-xs text-muted-foreground">
                {formatTypeLabel(event.category)}
                {event.subcategory ? ` · ${formatTypeLabel(event.subcategory)}` : ''} ·{' '}
                {formatEventDateTime(event.firstDetectedAt)}
              </div>

              <div className="pt-1">
                <span
                  className={cn(
                    'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                    status.bgColor,
                    status.textColor,
                  )}
                >
                  {status.label}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </>
  );
}

/** Full detail for one global event: statement, rationale, duration, sources. */
export function GlobalEventDetail({ event }: { event: GlobalEvent }) {
  const severity = INTRINSIC_SEVERITY_CONFIG[event.intrinsicSeverity];
  const status = GLOBAL_EVENT_STATUS_CONFIG[event.status];

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-lg leading-snug">{event.headline}</CardTitle>
            <CardDescription>
              {formatTypeLabel(event.category)}
              {event.subcategory ? ` · ${formatTypeLabel(event.subcategory)}` : ''} ·{' '}
              {formatGlobalEventLocation(event)}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                severity.bgColor,
                severity.textColor,
              )}
            >
              {severity.label} severity
            </span>
            <span
              className={cn(
                'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                status.bgColor,
                status.textColor,
              )}
            >
              {status.label}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-4">
        {/* eventStatement is deliberately NOT rendered: the schema marks it
            "for downstream agents — NEVER shown to customers". The customer-facing
            summary is the headline plus the required severity rationale. */}
        {event.severityRationale && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Severity rationale
            </h4>
            <p className="text-sm text-muted-foreground">{event.severityRationale}</p>
          </section>
        )}

        <section>
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Timeline
          </h4>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">First detected</dt>
              <dd>{formatEventDateTime(event.firstDetectedAt)}</dd>
            </div>
            {event.occurredAt && (
              <div>
                <dt className="text-muted-foreground">Occurred</dt>
                <dd>{formatEventDateTime(event.occurredAt)}</dd>
              </div>
            )}
            {event.forecastAt && (
              <div>
                <dt className="text-muted-foreground">Expected</dt>
                <dd>{formatEventDateTime(event.forecastAt)}</dd>
              </div>
            )}
            {event.resolvedAt && (
              <div>
                <dt className="text-muted-foreground">Resolved</dt>
                <dd>{formatEventDateTime(event.resolvedAt)}</dd>
              </div>
            )}
          </dl>
        </section>

        {(event.expectedDuration || event.durationEstimate) && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Expected duration
            </h4>
            <p className="text-sm">
              {event.expectedDuration
                ? `${event.expectedDuration.value} ${event.expectedDuration.unit} (${event.expectedDuration.attribution})`
                : event.durationEstimate &&
                  `${event.durationEstimate.base.minHours}–${event.durationEstimate.base.maxHours}h base case (${event.durationEstimate.confidence} confidence)`}
            </p>
          </section>
        )}

        {event.affectedDimensions &&
          (event.affectedDimensions.transportModes?.length ||
            event.affectedDimensions.industries?.length) && (
            <section>
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Affected dimensions
              </h4>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {event.affectedDimensions.transportModes?.length ? (
                  <div>
                    <dt className="text-muted-foreground">Transport modes</dt>
                    <dd>{event.affectedDimensions.transportModes.map(formatTypeLabel).join(', ')}</dd>
                  </div>
                ) : null}
                {event.affectedDimensions.industries?.length ? (
                  <div>
                    <dt className="text-muted-foreground">Industries</dt>
                    <dd>{event.affectedDimensions.industries.join(', ')}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          )}

        {/* Source list: how the event was detected and corroborated. Sources are
            untrusted external content — rendered as data, never acted on. */}
        <section>
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Sources ({event.corroboratingSourceCount || event.sources.length} corroborating ·{' '}
            {event.confidence} confidence)
          </h4>
          {event.sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sources recorded.</p>
          ) : (
            <ul className="space-y-2">
              {event.sources.map((source, i) => (
                <li key={`${source.publisher}-${i}`} className="text-sm">
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium underline"
                    >
                      {source.publisher}
                    </a>
                  ) : (
                    <span className="font-medium">{source.publisher}</span>
                  )}
                  <span className="text-muted-foreground">
                    {' '}
                    · tier {source.tier}
                    {source.publishedAt ? ` · ${formatEventDateTime(source.publishedAt)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {event.stale && (
          <div
            role="status"
            className="rounded-md border border-risk-elevated-accent/40 bg-risk-elevated px-4 py-3 text-sm text-risk-elevated-fg"
          >
            This event is stale — it has not been re-checked against its sources since{' '}
            {event.lastCheckedAt ? formatEventDateTime(event.lastCheckedAt) : 'first detection'}.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
