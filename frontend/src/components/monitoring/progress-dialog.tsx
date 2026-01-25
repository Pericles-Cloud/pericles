'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { getAccessToken } from '@/lib/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4111';

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
  const eventSourceRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasStartedRef = useRef(false);

  // Handle progress update - defined with useCallback for use in startMonitoring
  const handleProgressUpdate = useCallback((update: ProgressUpdate) => {
    setUpdates((prev) => [...prev, update]);

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
    if (isRunning || !organizationId) return;

    setIsRunning(true);
    setUpdates([]);
    setProgress(0);
    setCurrentPhase('starting');
    setError(null);
    setFinalMetrics(null);

    const token = getAccessToken();
    const url = `${API_URL}/api/monitoring/trigger-stream?organizationId=${encodeURIComponent(organizationId)}&token=${encodeURIComponent(token || '')}`;

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
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      setIsRunning(false);
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Connection failed');
        setCurrentPhase('error');
        setIsRunning(false);
      }
    });

    // Store abort controller for cleanup
    eventSourceRef.current = { close: () => abortController.abort() } as unknown as EventSource;
  }, [organizationId, isRunning, handleProgressUpdate]);

  // Auto-scroll to bottom of updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [updates]);

  // Start monitoring when dialog opens
  useEffect(() => {
    if (isOpen && !hasStartedRef.current && currentPhase !== 'complete' && currentPhase !== 'error') {
      hasStartedRef.current = true;
      // Defer to next tick to avoid synchronous setState in effect
      const timeoutId = setTimeout(() => {
        startMonitoring();
      }, 0);
      return () => clearTimeout(timeoutId);
    }
    // Reset when dialog closes
    if (!isOpen) {
      hasStartedRef.current = false;
    }
  }, [isOpen, currentPhase, startMonitoring]);

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/50 transition-opacity" />

        {/* Dialog */}
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
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
              {finalMetrics && <span>{(finalMetrics.durationMs / 1000).toFixed(1)}s</span>}
            </div>
          </div>

          {/* Activity Log */}
          <div
            ref={scrollRef}
            className="h-64 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg p-3 mb-4 space-y-2"
          >
            {updates.filter(u => u.type === 'progress' && u.message).map((update, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 text-sm animate-fade-in"
              >
                <span className="text-gray-400 dark:text-gray-500 text-xs mt-0.5 w-12 shrink-0">
                  {new Date(update.timestamp || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                {update.tool && (
                  <span className={`shrink-0 size-5 rounded flex items-center justify-center ${
                    update.phase === 'executing_tools' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-200 dark:bg-gray-700'
                  }`}>
                    <span className="text-[10px]">
                      {update.toolIndex || '-'}
                    </span>
                  </span>
                )}
                <span className="text-gray-700 dark:text-gray-300 flex-1">
                  {update.message}
                </span>
              </div>
            ))}
            {error && (
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                <svg className="size-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Final Results */}
          {finalMetrics && (
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 mb-4">
              <h4 className="font-medium text-green-800 dark:text-green-200 mb-3">Cycle Complete</h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-green-600 dark:text-green-400 text-xs">Events Detected</p>
                  <p className="text-lg font-semibold text-green-800 dark:text-green-200">
                    {finalMetrics.eventsDetected}
                  </p>
                </div>
                <div>
                  <p className="text-green-600 dark:text-green-400 text-xs">Events Published</p>
                  <p className="text-lg font-semibold text-green-800 dark:text-green-200">
                    {finalMetrics.eventsPublished}
                  </p>
                </div>
                <div>
                  <p className="text-green-600 dark:text-green-400 text-xs">Tools Executed</p>
                  <p className="text-lg font-semibold text-green-800 dark:text-green-200">
                    {finalMetrics.toolsExecuted}
                  </p>
                </div>
              </div>
              {finalMetrics.duplicatesFiltered > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                  {finalMetrics.duplicatesFiltered} duplicates filtered
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
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
