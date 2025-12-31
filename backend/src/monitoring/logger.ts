import pino from 'pino';

/**
 * Structured Logger using Pino
 *
 * Provides fast, structured logging for monitoring operations.
 * Log levels: debug, info, warn, error
 */

export const logger = pino({
  name: 'monitoring-agent',
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create child logger with context
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Pino accepts any type for metadata
export function createLogger(context: Record<string, any>) {
  return logger.child(context);
}
