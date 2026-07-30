'use client';

import { X, CheckCircle, XCircle, Clock, AlertCircle, Zap } from 'lucide-react';
import type { WorkflowExecutionResult, ExecutionLog, NodeExecutionStatus } from '@/lib/api-client';

interface ExecutionResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: WorkflowExecutionResult | null;
}

/**
 * Get status icon and color for a node execution status
 */
function getStatusDisplay(status: NodeExecutionStatus): { icon: React.ReactNode; color: string; bgColor: string } {
  switch (status) {
    case 'completed':
      return {
        icon: <CheckCircle className="h-4 w-4" />,
        color: 'text-risk-low-fg',
        bgColor: 'bg-risk-low',
      };
    case 'failed':
      return {
        icon: <XCircle className="h-4 w-4" />,
        color: 'text-risk-critical-fg',
        bgColor: 'bg-risk-critical',
      };
    case 'running':
      return {
        icon: <Clock className="h-4 w-4 animate-spin" />,
        color: 'text-primary',
        bgColor: 'bg-primary/10',
      };
    case 'skipped':
      return {
        icon: <AlertCircle className="h-4 w-4" />,
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
      };
    case 'pending':
    default:
      return {
        icon: <Clock className="h-4 w-4" />,
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
      };
  }
}

/**
 * Format duration in human readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * Node execution log item
 */
function ExecutionLogItem({ log }: { log: ExecutionLog }) {
  const { icon, color, bgColor } = getStatusDisplay(log.status);

  return (
    <div className={`rounded-lg border p-3 ${bgColor}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={color}>{icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{log.nodeLabel}</span>
              {/* bg-muted-foreground/20, not bg-muted: for skipped/pending rows the
                  wrapper is already bg-muted, so this chip would have no edge. */}
              <span className="rounded bg-muted-foreground/20 px-1.5 py-0.5 text-xs text-muted-foreground">
                {log.nodeType}
              </span>
              {log.simulated && (
                <span className="rounded bg-risk-elevated px-1.5 py-0.5 text-xs text-risk-elevated-fg">
                  Simulated
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{log.nodeClientId}</span>
          </div>
        </div>
        {log.durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">{formatDuration(log.durationMs)}</span>
        )}
      </div>

      {log.error && (
        <div className="mt-2 rounded bg-risk-critical p-2 text-sm text-risk-critical-fg">
          {log.error}
        </div>
      )}

      {log.skippedReason && (
        <div className="mt-2 rounded bg-muted-foreground/15 p-2 text-sm text-muted-foreground">
          {log.skippedReason}
        </div>
      )}

      {log.result !== undefined && log.result !== null && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            View result
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted-foreground/15 p-2 text-xs text-muted-foreground">
            {JSON.stringify(log.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * Modal to display workflow execution results
 */
export function ExecutionResultsModal({ isOpen, onClose, result }: ExecutionResultsModalProps) {
  if (!isOpen || !result) return null;

  const isSuccess = result.status === 'COMPLETED';
  const isTrial = result.mode === 'trial';

  // Calculate statistics
  const completedCount = result.executionLog.filter((l) => l.status === 'completed').length;
  const failedCount = result.executionLog.filter((l) => l.status === 'failed').length;
  const skippedCount = result.executionLog.filter((l) => l.status === 'skipped').length;
  const simulatedCount = result.executionLog.filter((l) => l.simulated).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 mx-4 max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                isSuccess ? 'bg-risk-low' : 'bg-risk-critical'
              }`}
            >
              {isSuccess ? (
                <CheckCircle className="h-6 w-6 text-risk-low-fg" />
              ) : (
                <XCircle className="h-6 w-6 text-risk-critical-fg" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Execution {isSuccess ? 'Completed' : 'Failed'}
              </h2>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    isTrial
                      ? 'bg-risk-elevated text-risk-elevated-fg'
                      : 'bg-risk-monitoring text-risk-monitoring-fg'
                  }`}
                >
                  {isTrial ? 'Trial Run' : 'Live Run'}
                </span>
                {isTrial && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Zap className="h-3 w-3" />
                    No side effects
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary */}
        <div className="border-b bg-muted px-6 py-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Duration:</span>
              <span className="font-medium">{formatDuration(result.durationMs)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Nodes:</span>
              <span className="font-medium">{result.executionLog.length}</span>
            </div>
            {completedCount > 0 && (
              <div className="flex items-center gap-1 text-risk-low-text">
                <CheckCircle className="h-4 w-4" />
                <span>{completedCount} completed</span>
              </div>
            )}
            {failedCount > 0 && (
              <div className="flex items-center gap-1 text-risk-critical-text">
                <XCircle className="h-4 w-4" />
                <span>{failedCount} failed</span>
              </div>
            )}
            {skippedCount > 0 && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <span>{skippedCount} skipped</span>
              </div>
            )}
            {simulatedCount > 0 && (
              <div className="flex items-center gap-1 text-risk-elevated-text">
                <Zap className="h-4 w-4" />
                <span>{simulatedCount} simulated</span>
              </div>
            )}
          </div>
        </div>

        {/* Error message if any */}
        {result.error && (
          <div className="border-b bg-risk-critical px-6 py-3">
            <p className="text-sm text-risk-critical-fg">{result.error}</p>
          </div>
        )}

        {/* Execution log */}
        <div className="max-h-[50vh] overflow-y-auto px-6 py-4">
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Execution Log</h3>
          <div className="space-y-2">
            {result.executionLog.map((log, index) => (
              <ExecutionLogItem key={`${log.nodeId}-${index}`} log={log} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
