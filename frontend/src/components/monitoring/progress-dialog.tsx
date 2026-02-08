'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { getAccessToken } from '@/lib/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4111';

// Tool display names mapping
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'erp-context-tool': 'ERP Context',
  'incident-lookup-tool': 'Incident Lookup',
  'organization-lookup-tool': 'Organization Lookup',
  'weather-disaster-monitor-tool': 'Weather & Disasters',
  'political-risk-monitor-tool': 'Political Risk',
  'cybersecurity-monitor-tool': 'Cybersecurity',
  'economic-financial-monitor-tool': 'Economic & Financial',
  'news-social-media-monitor-tool': 'News & Social Media',
  'maritime-logistics-monitor-tool': 'Maritime & Logistics',
  'labor-social-monitor-tool': 'Labor & Social',
  'regulatory-trade-monitor-tool': 'Regulatory & Trade',
  'pandemic-health-monitor-tool': 'Pandemic & Health',
  'geopolitical-conflict-monitor-tool': 'Geopolitical & Conflict',
};

function formatToolName(toolId: string | undefined): string {
  if (!toolId) return 'Unknown Tool';
  return TOOL_DISPLAY_NAMES[toolId] || toolId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Format elapsed time as "Xm Xs" or "Xs"
function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// Progress update types matching backend
type ProgressPhase = 'starting' | 'loading_context' | 'executing_tools' | 'processing_events' | 'complete' | 'error';

interface ProgressUpdate {
  type: 'connected' | 'progress' | 'complete' | 'error';
  phase?: ProgressPhase;
  message?: string;
  tool?: string;
  toolIndex?: number;
  totalTools?: number;
  eventsDetected?: number;
  eventsPublished?: number;
  timestamp?: string;
  // Tool configuration info
  enabledTools?: string[];
  disabledTools?: string[];
  metrics?: {
    durationMs: number;
    eventsDetected: number;
    eventsPublished: number;
    duplicatesFiltered: number;
    geographyFiltered: number;
    severityFiltered: number;
    toolsExecuted: number;
    toolsSucceeded: number;
    toolsFailed: number;
    errorCount: number;
  };
}

interface MonitoringProgressDialogProps {
  isOpen: boolean;
  organizationId: string;
  onClose: () => void;
  onComplete: (metrics: ProgressUpdate['metrics']) => void;
}

export function MonitoringProgressDialog({
  isOpen,
  organizationId,
  onClose,
  onComplete,
}: MonitoringProgressDialogProps) {
  const [updates, setUpdates] = useState<ProgressUpdate[]>([]);
  const [currentPhase, setCurrentPhase] = useState<ProgressPhase>('starting');
  const [progress, setProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalMetrics, setFinalMetrics] = useState<ProgressUpdate['metrics'] | null>(null);
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [, setDisabledTools] = useState<string[]>([]);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasStartedRef = useRef(false);
  const isRunningRef = useRef(false);

  // Update elapsed time every second while running
  useEffect(() => {
    if (!isRunning || !startTime) return;

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, startTime]);

  // Handle progress update - defined with useCallback for use in startMonitoring
  const handleProgressUpdate = useCallback((update: ProgressUpdate) => {
    setUpdates((prev) => [...prev, update]);

    // Capture tool configuration from the first progress updates
    if (update.enabledTools && update.enabledTools.length > 0) {
      setEnabledTools(update.enabledTools);
    }
    if (update.disabledTools && update.disabledTools.length > 0) {
      setDisabledTools(update.disabledTools);
    }

    if (update.type === 'progress' && update.phase) {
      setCurrentPhase(update.phase);

      // Calculate progress percentage
      if (update.phase === 'starting') {
        setProgress(5);
      } else if (update.phase === 'loading_context') {
        setProgress(10);
      } else if (update.phase === 'executing_tools' && update.toolIndex && update.totalTools) {
        const toolProgress = (update.toolIndex / update.totalTools) * 70;
        setProgress(10 + toolProgress);
      } else if (update.phase === 'processing_events') {
        setProgress(85);
      }
    } else if (update.type === 'complete') {
      setProgress(100);
      setCurrentPhase('complete');
      setFinalMetrics(update.metrics || null);
      if (update.metrics) {
        onComplete(update.metrics);
      }
    } else if (update.type === 'error') {
      setError(update.message || 'An error occurred');
      setCurrentPhase('error');
    }
  }, [onComplete]);

  const startMonitoring = useCallback(() => {
    // Use ref for guard to avoid recreating this callback
    if (isRunningRef.current || !organizationId) return;

    isRunningRef.current = true;
    setIsRunning(true);
    setUpdates([]);
    setProgress(0);
    setCurrentPhase('starting');
    setError(null);
    setFinalMetrics(null);
    setEnabledTools([]);
    setDisabledTools([]);
    setStartTime(Date.now());
    setElapsedTime(0);

    const token = getAccessToken();
    // SECURITY: Token sent only via Authorization header, not in URL query string
    const url = `${API_URL}/api/monitoring/trigger-stream?organizationId=${encodeURIComponent(organizationId)}`;

    // Use fetch with streaming for better auth support
    const abortController = new AbortController();

    fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      signal: abortController.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to start monitoring');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      let receivedCompletion = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as ProgressUpdate;
              handleProgressUpdate(data);
              // Track if we received a terminal state
              if (data.type === 'complete' || data.type === 'error') {
                receivedCompletion = true;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Handle case where stream ended without complete/error event
      if (!receivedCompletion) {
        setError('Connection lost - monitoring cycle may not have completed');
        setCurrentPhase('error');
      }

      isRunningRef.current = false;
      setIsRunning(false);
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Connection failed');
        setCurrentPhase('error');
        isRunningRef.current = false;
        setIsRunning(false);
      }
    });

    // Store abort controller for cleanup
    eventSourceRef.current = { close: () => abortController.abort() } as unknown as EventSource;
  }, [organizationId, handleProgressUpdate]); // Removed isRunning - using ref instead

  // Auto-scroll to bottom of updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [updates]);

  // Start monitoring when dialog opens
  useEffect(() => {
    if (isOpen && !hasStartedRef.current) {
      hasStartedRef.current = true;
      // Defer to next tick to avoid synchronous setState in effect
      const timeoutId = setTimeout(() => {
        startMonitoring();
      }, 0);
      return () => clearTimeout(timeoutId);
    }
    // Reset refs when dialog closes
    if (!isOpen) {
      hasStartedRef.current = false;
      isRunningRef.current = false;
    }
  }, [isOpen, startMonitoring]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const handleClose = () => {
    eventSourceRef.current?.close();
    onClose();
  };

  const getPhaseLabel = (phase: ProgressPhase): string => {
    const labels: Record<ProgressPhase, string> = {
      starting: 'Starting',
      loading_context: 'Loading Context',
      executing_tools: 'Executing Tools',
      processing_events: 'Processing Events',
      complete: 'Complete',
      error: 'Error',
    };
    return labels[phase];
  };

  // Extract a cleaner message for display
  const getCleanMessage = (update: ProgressUpdate): string => {
    if (!update.message) return '';

    // If the message is just "Executing toolName...", return a simpler version
    if (update.message.toLowerCase().startsWith('executing ') && update.tool) {
      return 'Executing...';
    }

    // For tool completion messages, simplify
    if (update.message.includes('completed') || update.message.includes('finished')) {
      const match = update.message.match(/Found (\d+) events?/i);
      if (match) {
        return `Found ${match[1]} events`;
      }
      return 'Completed';
    }

    return update.message;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/50 transition-opacity" />

        {/* Dialog */}
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`size-10 rounded-full flex items-center justify-center ${
                currentPhase === 'error' ? 'bg-red-100 dark:bg-red-900/30' :
                currentPhase === 'complete' ? 'bg-green-100 dark:bg-green-900/30' :
                'bg-blue-100 dark:bg-blue-900/30'
              }`}>
                {currentPhase === 'error' ? (
                  <svg className="size-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                ) : currentPhase === 'complete' ? (
                  <svg className="size-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                ) : (
                  <svg className="size-5 text-blue-600 dark:text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Monitoring Cycle
                </h3>
                <p className={`text-sm ${
                  currentPhase === 'error' ? 'text-red-600 dark:text-red-400' :
                  currentPhase === 'complete' ? 'text-green-600 dark:text-green-400' :
                  'text-gray-500 dark:text-gray-400'
                }`}>
                  {getPhaseLabel(currentPhase)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Elapsed Time */}
              <div className="text-right">
                <span className="text-2xl font-mono font-semibold text-gray-900 dark:text-white">
                  {finalMetrics
                    ? formatElapsedTime(finalMetrics.durationMs)
                    : formatElapsedTime(elapsedTime)
                  }
                </span>
              </div>
              {(currentPhase === 'complete' || currentPhase === 'error') && (
                <button
                  onClick={handleClose}
                  className="p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ease-out ${
                  currentPhase === 'error' ? 'bg-red-500' :
                  currentPhase === 'complete' ? 'bg-green-500' :
                  'bg-blue-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
              <span>{Math.round(progress)}%</span>
              {enabledTools.length > 0 && (
                <span>{enabledTools.length} tools enabled</span>
              )}
            </div>
          </div>

          {/* Tool Configuration Summary - Collapsible */}
          {enabledTools.length > 0 && (
            <details className="mb-4 group">
              <summary className="cursor-pointer text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 select-none flex items-center gap-1">
                <svg className="size-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
                View enabled tools ({enabledTools.length})
              </summary>
              <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="flex flex-wrap gap-1.5">
                  {enabledTools.map((tool) => (
                    <span
                      key={tool}
                      className="px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                    >
                      {formatToolName(tool)}
                    </span>
                  ))}
                </div>
              </div>
            </details>
          )}

          {/* Activity Log */}
          <div
            ref={scrollRef}
            className="h-56 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg p-3 mb-4 font-mono text-xs"
          >
            {updates.filter(u => u.type === 'progress' && u.message).map((update, idx) => {
              const cleanMessage = getCleanMessage(update);
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 py-1 border-b border-gray-100 dark:border-gray-800 last:border-0"
                >
                  <span className="text-gray-400 dark:text-gray-500 w-14 shrink-0 tabular-nums">
                    {new Date(update.timestamp || '').toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false
                    })}
                  </span>
                  {update.tool ? (
                    <>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                        update.phase === 'executing_tools'
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>
                        {formatToolName(update.tool)}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400 truncate">
                        {cleanMessage}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-600 dark:text-gray-300">
                      {update.message}
                    </span>
                  )}
                </div>
              );
            })}
            {error && (
              <div className="flex items-center gap-2 py-1 text-red-600 dark:text-red-400">
                <svg className="size-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Final Results */}
          {finalMetrics && (
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 mb-4">
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-xl font-bold text-green-800 dark:text-green-200">
                    {finalMetrics.eventsDetected}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">Detected</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-green-800 dark:text-green-200">
                    {finalMetrics.eventsPublished}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">Published</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-green-800 dark:text-green-200">
                    {finalMetrics.duplicatesFiltered}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">Duplicates</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-green-800 dark:text-green-200">
                    {finalMetrics.toolsSucceeded}/{finalMetrics.toolsExecuted}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">Tools OK</p>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end">
            {currentPhase === 'complete' || currentPhase === 'error' ? (
              <Button onClick={handleClose}>
                Close
              </Button>
            ) : (
              <Button variant="outline" onClick={handleClose} disabled={isRunning}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
