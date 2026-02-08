/**
 * Tool Logger - Structured logging for monitoring tools
 *
 * Provides consistent, structured logging for all monitoring tools using Pino.
 * Each tool should create a logger instance with its tool ID.
 *
 * Usage:
 *   import { createToolLogger } from './tool-logger';
 *   const logger = createToolLogger('weather-disaster-monitor');
 *   logger.info({ events: 5 }, 'Fetched weather events');
 */

import pino from 'pino';

// Shared Pino instance for tools
const baseLogger = pino({
  name: 'monitoring-tools',
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Tool-specific logger type
 */
export type ToolLogger = pino.Logger;

/**
 * Create a child logger for a specific tool
 *
 * @param toolId - The tool identifier (e.g., 'weather-disaster-monitor')
 * @returns A Pino child logger with tool context
 */
export function createToolLogger(toolId: string): ToolLogger {
  return baseLogger.child({ tool: toolId });
}

/**
 * Pre-created loggers for each monitoring tool
 * Import these directly for convenience
 */
export const toolLoggers = {
  weatherDisaster: createToolLogger('weather-disaster-monitor'),
  politicalRisk: createToolLogger('political-risk-monitor'),
  cybersecurity: createToolLogger('cybersecurity-monitor'),
  economicFinancial: createToolLogger('economic-financial-monitor'),
  newsSocialMedia: createToolLogger('news-social-media-monitor'),
  maritimeLogistics: createToolLogger('maritime-logistics-monitor'),
  laborSocial: createToolLogger('labor-social-monitor'),
  regulatoryTrade: createToolLogger('regulatory-trade-monitor'),
  pandemicHealth: createToolLogger('pandemic-health-monitor'),
  geopoliticalConflict: createToolLogger('geopolitical-conflict-monitor'),
  erpContext: createToolLogger('erp-context'),
  incidentLookup: createToolLogger('incident-lookup'),
  organizationLookup: createToolLogger('organization-lookup'),
  sapErpData: createToolLogger('sap-erp-data'),
} as const;
