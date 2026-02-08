
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { monitoringAgent } from './agents/monitoring-agent.js';
import { relevanceScorer, severityAccuracyScorer, deduplicationScorer } from './scorers/monitoring-scorer.js';
import { getPostgresStore } from '../monitoring/db-client.js';

export const mastra = new Mastra({
  agents: { monitoringAgent },
  scorers: {
    relevanceScorer,
    severityAccuracyScorer,
    deduplicationScorer
  },
  storage: getPostgresStore(),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    enabled: false,
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: { enabled: true },
  },
});
