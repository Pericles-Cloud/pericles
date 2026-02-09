
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { monitoringAgent } from './agents/monitoring-agent.js';
import { relevanceScorer, severityAccuracyScorer, deduplicationScorer } from './scorers/monitoring-scorer.js';
import { getPostgresStore } from '../monitoring/db-client.js';

// Get storage - may be undefined in serverless environments with cold start issues
const storage = getPostgresStore();
if (!storage) {
  console.warn('[Mastra] Running in stateless mode - storage unavailable');
}

// Build Mastra config with optional storage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mastraConfig: any = {
  agents: { monitoringAgent },
  scorers: {
    relevanceScorer,
    severityAccuracyScorer,
    deduplicationScorer
  },
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
};

// Add storage only if available
if (storage) {
  mastraConfig.storage = storage;
}

export const mastra = new Mastra(mastraConfig);
