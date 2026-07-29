# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pericles is a supply chain risk management platform built on an intelligent AI agent architecture using Mastra. The platform monitors real-time data sources to detect, validate, and assess supply chain disruption events.

## Build & Development Commands

All backend commands run from `backend/`; see `backend/package.json` for the script
list and the `pericles-dev-environment` build skill for setup, docker-compose
services and the pre-commit gate.

## Service Ports
- PostgreSQL: 5432 (user: `pericles_user`, pass: `pericles_dev_password`, db: `pericles`) — Docker
- pgAdmin: 5050 (admin@pericles.dev / admin) — Docker
- Mastra Dev: 4111 — host (`npm run dev:all` / `npm run dev`)
- Auth/API server: 4112 — host (`npm run dev:all` / `npm run dev:auth`)
- Mastra Server: 3001 — host-only via `npm run start`; local tool, not a deployment target

## Deployment

Two deploys, two providers — do not conflate them:

| Component | Host |
|---|---|
| `frontend/` — Next.js/React | **Vercel** |
| `backend/` — Express API + socket.io (port 4112) | **Coolify** (long-running Docker container) |

The backend is **not serverless**: it holds WebSocket connections
(`/ws/workflow`) and an in-process position-feed singleton. The Mastra server is
a local development tool, not the deployed backend — the deployed API is
`backend/src/server/auth-server.ts`.

Runbook: `DEPLOYMENT.md`. Standards: `.claude/rules/13-infrastructure.md`. To
drive Coolify (deploy, watch a build, sync env vars), use the `coolify-deploy`
skill.

## Architecture Overview

### Tool Pattern

All tools follow this pattern using `@mastra/core/tools`:

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const myTool = createTool({
  id: 'tool-id',
  description: 'What this tool does',
  inputSchema: z.object({
    organization_id: z.string().uuid().describe('Required for tenant isolation'),
    // other params...
  }),
  outputSchema: z.object({ /* structured output */ }),
  execute: async ({ context }) => {
    // CRITICAL: Always validate organization_id
    if (!context.organization_id) throw new Error('organization_id required');
    // Implementation with AbortSignal.timeout() for external APIs
    return { /* matches outputSchema */ };
  }
});
```

### Multi-Tenancy Pattern

All data is strictly isolated by `organization_id`:
- Every database query MUST filter by `organization_id`
- Every tool MUST validate `organization_id` before execution
- Root organization (`is_root: true`, `@pericles.cloud` domain) has global access

## Key Implementation Details

### External API Integration Pattern

```typescript
const response = await fetch(apiUrl, {
  headers: { 'User-Agent': 'Pericles-SupplyChainMonitor/1.0 (contact@pericles.cloud)' },
  signal: AbortSignal.timeout(10000)  // REQUIRED: timeout for all external calls
});
```

## Environment Variables

All environment variables live in a single `.env.local` at the **project root** —
both backend and frontend load from it. See `.env.example` for the full list.

## Code Quality Requirements (MANDATORY)

**After every code change, run:**

```bash
cd backend
npm run lint          # Fix: npm run lint:fix
npm run type-check
```

Do not consider a task complete until both checks pass.

## Cursor Rules Reference

The `.cursor/rules/` directory contains detailed standards:
- `001-application/001-agents/`: Agent implementation rules
- `700-ai/701-mastra-agent-core-standards-auto.mdc`: Mastra-specific patterns
- `500-architecture/506-postgresql-core-standards-auto.mdc`: Database patterns
- `300-languages/307-typescript-core-standards-auto.mdc`: TypeScript standards