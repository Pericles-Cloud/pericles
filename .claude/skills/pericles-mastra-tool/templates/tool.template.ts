// templates/tool.template.ts
// Pericles Mastra tool scaffold — matches the live pattern in
// backend/src/mastra/tools/*. See pericles-mastra-tool and .claude/rules/04-tools.md.

import { createTool } from '@mastra/core/tools'; // NOTE: the /tools subpath
import { z } from 'zod';
import { limitEvents, getFilterSummary } from './output-limiter.js';
import { toolLoggers } from './tool-logger.js';

const logger = toolLoggers.example; // use the matching per-tool logger

export const exampleMonitorTool = createTool({
  id: 'example-monitor',
  description: 'One precise sentence other Skills and the registry read.',
  inputSchema: z.object({
    // organization_id is a REQUIRED input field (this is the codebase convention).
    organization_id: z.string().uuid().describe('Required for tenant isolation'),
    // ...domain inputs, e.g.:
    // locations: z.array(z.object({ latitude: z.number(), longitude: z.number(), name: z.string() })),
    // severity_threshold: z.number().min(0).max(1).default(0.5),
    // lookback_hours: z.number().int().positive().default(24),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    events: z.array(z.object({ event_id: z.string(), /* ... */ })),
  }),
  execute: async ({ context }) => {
    // Inputs validated against inputSchema arrive on `context`.
    const { organization_id /*, locations, ... */ } = context;

    // Tenant isolation: validate first, fail closed.
    if (!organization_id) throw new Error('organization_id is required');

    // External calls: 10s timeout + standard UA.
    // const res = await fetch(url, {
    //   headers: { 'User-Agent': 'Pericles-SupplyChainMonitor/1.0 (contact@pericles.cloud)' },
    //   signal: AbortSignal.timeout(10000),
    // });

    // Every prisma query is scoped by organization_id.
    // const rows = await prisma.event.findMany({ where: { organization_id } });

    // Cap output with the shared limiter before returning.
    // const events = limitEvents(rawEvents);
    return { success: true, events: [] };
  },
});
