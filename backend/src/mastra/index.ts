
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { monitoringAgent } from './agents/monitoring-agent.js';
import { eventQaAgent } from './agents/event-qa-agent.js';
import { relevanceScorer, severityAccuracyScorer, deduplicationScorer } from './scorers/monitoring-scorer.js';
import { factualityScorer } from './scorers/factuality-scorer.js';
import { getPostgresStore } from '../monitoring/db-client.js';

// Get storage - may be undefined in serverless environments with cold start issues
const storage = getPostgresStore();
if (!storage) {
  console.warn('[Mastra] Running in stateless mode - storage unavailable');
}

// Build Mastra config with optional storage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mastraConfig: any = {
  agents: { monitoringAgent, eventQaAgent },
  scorers: {
    relevanceScorer,
    severityAccuracyScorer,
    deduplicationScorer,
    factualityScorer
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
    // Agent.__updateModel() debug-logs the resolved model object, which now
    // carries org-scoped apiKeys ({ id, apiKey }). 'info' doesn't reach that
    // line today, but if the level ever drops, keys must not hit the logs.
    // PinoLogger has no `redact` passthrough, so scrub via formatters.log.
    formatters: {
      log(record) {
        const model = record.model as Record<string, unknown> | undefined;
        if (model && typeof model === 'object' && 'apiKey' in model) {
          const rest = { ...model };
          delete rest.apiKey;
          record.model = rest;
        }
        return record;
      },
    },
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
