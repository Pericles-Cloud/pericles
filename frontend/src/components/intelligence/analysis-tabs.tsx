'use client';

import { useState } from 'react';
import { askEventQuestion, type Event } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getRiskColor } from '@/lib/intelligence-utils';

export type AnalysisTab = 'timeline' | 'analysis' | 'impact' | 'notes';

const TABS: AnalysisTab[] = ['timeline', 'analysis', 'impact', 'notes'];

/**
 * Per-event analysis panel (formerly the right-hand column of /insights).
 * Owns its own tab state — the selected event is the only thing the page
 * needs to hand it.
 */
export function AnalysisTabs({ event }: { event: Event | null }) {
  const [activeTab, setActiveTab] = useState<AnalysisTab>('analysis');

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex border-b shrink-0" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-primary text-primary bg-primary/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
        {event ? (
          <AnalysisContent event={event} activeTab={activeTab} />
        ) : (
          <div className="text-center text-muted-foreground">
            <p>Select an event to view analysis</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisContent({ event, activeTab }: { event: Event; activeTab: AnalysisTab }) {
  const formatDateTime = (dateStr: string) => new Date(dateStr).toLocaleString();

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
                <span className="text-muted-foreground">Severity:</span>
                <span className={`ml-1 font-medium ${getRiskColor(event.severity)}`}>
                  {(event.severity * 100).toFixed(0)}%
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Confidence:</span>
                <span className="ml-1 font-medium">{(event.confidence * 100).toFixed(0)}%</span>
              </div>
            </div>
            {event.riskFactors.length > 0 && (
              <>
                <h4 className="text-sm font-medium mt-4">Risk Factors</h4>
                <ul className="text-sm space-y-1">
                  {event.riskFactors.map((factor) => (
                    <li key={factor} className="text-muted-foreground">
                      {factor.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <EventQaBox eventId={event.id} />
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
                      className="px-2 py-1 bg-primary/10 text-primary rounded text-xs"
                    >
                      {domain.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No impact data available for this event.</p>
            )}
            {event.locationName && (
              <>
                <h4 className="text-sm font-medium mt-4">Geographic Impact</h4>
                <p className="text-sm text-muted-foreground">{event.locationName}</p>
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
            <p className="text-muted-foreground">No notes have been added for this event yet.</p>
            <div className="mt-4">
              <textarea
                placeholder="Add a note..."
                aria-label="Add a note"
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

interface QaTurn {
  question: string;
  answer: string | null;
  error: string | null;
}

/**
 * Per-event Q&A box (#23) — scoped to the one event whose Analysis tab it's
 * rendered under, not the full cross-event Insights chat described in the
 * Intelligence PRD. Turns live in component state only; nothing is
 * persisted, matching the ticket's ask for a lightweight per-event box
 * rather than a session-backed research surface.
 */
function EventQaBox({ eventId }: { eventId: string }) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<QaTurn[]>([]);
  const [isAsking, setIsAsking] = useState(false);

  const handleAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed || isAsking) return;

    setIsAsking(true);
    setQuestion('');
    const turnIndex = turns.length;
    setTurns((prev) => [...prev, { question: trimmed, answer: null, error: null }]);

    try {
      const response = await askEventQuestion(eventId, trimmed);
      setTurns((prev) =>
        prev.map((t, i) =>
          i === turnIndex
            ? {
                ...t,
                answer: response.success ? response.data?.answer ?? null : null,
                error: response.success ? null : response.error?.message || 'Failed to get an answer',
              }
            : t
        )
      );
    } catch {
      setTurns((prev) =>
        prev.map((t, i) => (i === turnIndex ? { ...t, error: 'Failed to get an answer' } : t))
      );
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h4 className="text-sm font-medium mb-2">Ask about this event</h4>
      {turns.length > 0 && (
        <div className="space-y-3 mb-3 max-h-64 overflow-y-auto">
          {turns.map((turn, i) => (
            <div key={i} className="text-sm">
              <div className="font-medium text-foreground">{turn.question}</div>
              {turn.answer && <div className="text-muted-foreground mt-1">{turn.answer}</div>}
              {turn.error && <div className="text-risk-critical-text mt-1">{turn.error}</div>}
              {!turn.answer && !turn.error && (
                <div className="text-muted-foreground mt-1 italic">Thinking…</div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleAsk();
            }
          }}
          placeholder="Ask a question about this event…"
          aria-label="Ask a question about this event"
          disabled={isAsking}
          className="text-sm"
        />
        <Button size="sm" onClick={() => void handleAsk()} disabled={isAsking || !question.trim()}>
          {isAsking ? 'Asking…' : 'Ask'}
        </Button>
      </div>
    </div>
  );
}

function TimelineItem({ label, time, description }: { label: string; time: string; description: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="size-2 rounded-full bg-primary" />
        <div className="w-px flex-1 bg-muted-foreground/25" />
      </div>
      <div className="pb-4">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{time}</div>
        <div className="text-xs text-muted-foreground mt-1">{description}</div>
      </div>
    </div>
  );
}
