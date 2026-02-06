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
        color: 'text-green-600',
        bgColor: 'bg-green-50',
      };
    case 'failed':
      return {
        icon: <XCircle className="h-4 w-4" />,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
      };
    case 'running':
      return {
        icon: <Clock className="h-4 w-4 animate-spin" />,
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
      };
    case 'skipped':
      return {
        icon: <AlertCircle className="h-4 w-4" />,
        color: 'text-gray-500',
        bgColor: 'bg-gray-50',
      };
    case 'pending':
    default:
      return {
        icon: <Clock className="h-4 w-4" />,
        color: 'text-gray-400',
        bgColor: 'bg-gray-50',
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
              <span className="font-medium text-gray-900">{log.nodeLabel}</span>
              <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                {log.nodeType}
              </span>
              {log.simulated && (
                <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-700">
                  Simulated
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500">{log.nodeClientId}</span>
          </div>
        </div>
        {log.durationMs !== undefined && (
          <span className="text-xs text-gray-500">{formatDuration(log.durationMs)}</span>
        )}
      </div>

      {log.error && (
        <div className="mt-2 rounded bg-red-100 p-2 text-sm text-red-700">
          {log.error}
        </div>
      )}

      {log.skippedReason && (
        <div className="mt-2 rounded bg-gray-100 p-2 text-sm text-gray-600">
          {log.skippedReason}
        </div>
      )}

      {log.result !== undefined && log.result !== null && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
            View result
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-white p-2 text-xs text-gray-700">
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
      <div className="relative z-10 mx-4 max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                isSuccess ? 'bg-green-100' : 'bg-red-100'
              }`}
            >
              {isSuccess ? (
                <CheckCircle className="h-6 w-6 text-green-600" />
              ) : (
                <XCircle className="h-6 w-6 text-red-600" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Execution {isSuccess ? 'Completed' : 'Failed'}
              </h2>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    isTrial
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {isTrial ? 'Trial Run' : 'Live Run'}
                </span>
                {isTrial && (
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Zap className="h-3 w-3" />
                    No side effects
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary */}
        <div className="border-b bg-gray-50 px-6 py-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <span className="text-gray-500">Duration:</span>
              <span className="font-medium">{formatDuration(result.durationMs)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-500">Nodes:</span>
              <span className="font-medium">{result.executionLog.length}</span>
            </div>
            {completedCount > 0 && (
              <div className="flex items-center gap-1 text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span>{completedCount} completed</span>
              </div>
            )}
            {failedCount > 0 && (
              <div className="flex items-center gap-1 text-red-600">
                <XCircle className="h-4 w-4" />
                <span>{failedCount} failed</span>
              </div>
            )}
            {skippedCount > 0 && (
              <div className="flex items-center gap-1 text-gray-500">
                <AlertCircle className="h-4 w-4" />
                <span>{skippedCount} skipped</span>
              </div>
            )}
            {simulatedCount > 0 && (
              <div className="flex items-center gap-1 text-yellow-600">
                <Zap className="h-4 w-4" />
                <span>{simulatedCount} simulated</span>
              </div>
            )}
          </div>
        </div>

        {/* Error message if any */}
        {result.error && (
          <div className="border-b bg-red-50 px-6 py-3">
            <p className="text-sm text-red-700">{result.error}</p>
          </div>
        )}

        {/* Execution log */}
        <div className="max-h-[50vh] overflow-y-auto px-6 py-4">
          <h3 className="mb-3 text-sm font-medium text-gray-700">Execution Log</h3>
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
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
