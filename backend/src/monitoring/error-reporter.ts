import { logger } from './logger.js';

/**
 * Error Reporter and Classifier
 *
 * Classifies errors as:
 * - Recoverable: Retry with backoff (network errors, rate limits)
 * - Fatal: Stop monitoring immediately (config errors, auth failures)
 * - Transient: Continue monitoring but log error (single tool failure)
 */

export enum ErrorSeverity {
  RECOVERABLE = 'recoverable',
  FATAL = 'fatal',
  TRANSIENT = 'transient',
}

export interface ClassifiedError {
  severity: ErrorSeverity;
  shouldRetry: boolean;
  backoffMs?: number;
  error: Error;
}

/**
 * Classify error and determine handling strategy
 */
export function classifyError(error: Error, _context?: string): ClassifiedError {
  const errorMessage = error.message.toLowerCase();

  // Fatal errors - stop monitoring
  if (
    errorMessage.includes('organization_id is required') ||
    errorMessage.includes('invalid organization_id') ||
    errorMessage.includes('authentication failed') ||
    errorMessage.includes('unauthorized')
  ) {
    return {
      severity: ErrorSeverity.FATAL,
      shouldRetry: false,
      error,
    };
  }

  // Recoverable errors - retry with backoff
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests')
  ) {
    const backoffMs = errorMessage.includes('rate limit') ? 60000 : 5000;
    return {
      severity: ErrorSeverity.RECOVERABLE,
      shouldRetry: true,
      backoffMs,
      error,
    };
  }

  // Database errors - retry with short backoff
  if (
    errorMessage.includes('database') ||
    errorMessage.includes('prisma') ||
    errorMessage.includes('connection')
  ) {
    return {
      severity: ErrorSeverity.RECOVERABLE,
      shouldRetry: true,
      backoffMs: 2000,
      error,
    };
  }

  // Transient errors - continue but log
  return {
    severity: ErrorSeverity.TRANSIENT,
    shouldRetry: false,
    error,
  };
}

/**
 * Report error with appropriate logging and metrics
 */
export function reportError(
  classifiedError: ClassifiedError,
  context: string,
  organizationId?: string
): void {
  const logContext = {
    severity: classifiedError.severity,
    context,
    organizationId,
    shouldRetry: classifiedError.shouldRetry,
    backoffMs: classifiedError.backoffMs,
  };

  switch (classifiedError.severity) {
    case ErrorSeverity.FATAL:
      logger.fatal(logContext, `Fatal error: ${classifiedError.error.message}`);
      break;
    case ErrorSeverity.RECOVERABLE:
      logger.warn(logContext, `Recoverable error: ${classifiedError.error.message}`);
      break;
    case ErrorSeverity.TRANSIENT:
      logger.info(logContext, `Transient error: ${classifiedError.error.message}`);
      break;
  }
}

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoff(
  attemptNumber: number,
  baseDelayMs = 1000,
  maxDelayMs = 60000
): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attemptNumber), maxDelayMs);
  // Add jitter (±20%)
  const jitter = delay * 0.2 * (Math.random() - 0.5);
  return Math.floor(delay + jitter);
}
