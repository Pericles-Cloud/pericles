'use client';

import type { Event } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import {
  SEVERITY_CONFIG,
  STATUS_CONFIG,
  formatEventDateTime,
  getEventStatus,
  getSeverityLevel,
} from '@/lib/intelligence-utils';

interface EventListProps {
  events: Event[];
  selectedEventId: string | null;
  onSelect: (event: Event) => void;
}

/**
 * The Intelligence feed: a selectable list of monitored events. Shared by the
 * Feed and Analytics views so selection carries across both.
 */
export function EventList({ events, selectedEventId, onSelect }: EventListProps) {
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-300"
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
          <p className="mt-4 text-gray-500">No events found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {events.map((event) => {
        const statusConfig = STATUS_CONFIG[getEventStatus(event)];
        const severityConfig = SEVERITY_CONFIG[getSeverityLevel(event.severity)];

        return (
          <button
            key={event.id}
            onClick={() => onSelect(event)}
            aria-current={selectedEventId === event.id}
            className={`w-full text-left p-4 rounded-lg border transition-colors ${
              selectedEventId === event.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <div className="space-y-2">
              {/* Header: Title + Severity */}
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium text-sm leading-tight line-clamp-2">{event.title}</h4>
                <div
                  className={`shrink-0 size-6 rounded-full ${severityConfig.color} flex items-center justify-center text-white text-xs font-bold`}
                  title={`Severity ${severityConfig.label}`}
                >
                  {severityConfig.label}
                </div>
              </div>

              {/* Location */}
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                  />
                </svg>
                <span className="truncate">{event.locationName || 'Unknown location'}</span>
              </div>

              {/* Date/Time */}
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
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
      })}
    </>
  );
}
