# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pericles is a supply chain risk management platform built on an intelligent AI agent architecture using Mastra. The platform monitors real-time data sources to detect, validate, and assess supply chain disruption events.

## Build & Development Commands

All backend commands run from `backend/` directory:

```bash
# Docker services (PostgreSQL + pgAdmin only)
docker-compose up -d             # Start PostgreSQL, pgAdmin
docker-compose down              # Stop all services
docker-compose logs -f postgres  # Watch PostgreSQL logs

# Development (Mastra + auth server run on the host, not in Docker)
npm run dev:all                  # Start Mastra (4111) + auth server (4112) together
npm run dev                      # Start Mastra dev server only (port 4111)
npm run dev:auth                 # Start auth server only (port 4112)
npm run build                    # Build Mastra agents
npm run start                    # Start Mastra production server

# Database
npm run prisma:generate          # Generate Prisma client
npm run prisma:migrate:dev       # Run migrations (development)
npm run prisma:seed              # Seed database with test data
npm run prisma:studio            # Open Prisma Studio GUI

# Code quality (MANDATORY after changes)
npm run lint                     # ESLint check
npm run lint:fix                 # ESLint auto-fix
npm run type-check               # TypeScript type checking

# Mock data utilities
npm run mock:create              # Create mock shipment/supplier data
npm run mock:reset               # Reset mock data
```

## Local Development Setup

1. Copy environment file: `cp .env.example .env.local` (in project root)
2. Add required API keys to `.env.local` (OPENAI_API_KEY required)
3. Start Docker (PostgreSQL + pgAdmin only): `docker-compose up -d`
4. Run migrations: `cd backend && npm run prisma:migrate:dev`
5. Seed data: `npm run prisma:seed`
6. Start the backend (Mastra + auth server): `npm run dev:all`
7. Access Mastra Studio: http://localhost:4111 (auth/API server: http://localhost:4112)

### Service Ports
- PostgreSQL: 5432 (user: `pericles_user`, pass: `pericles_dev_password`, db: `pericles`) — Docker
- pgAdmin: 5050 (admin@pericles.dev / admin) — Docker
- Mastra Dev: 4111 — host (`npm run dev:all` / `npm run dev`)
- Auth/API server: 4112 — host (`npm run dev:all` / `npm run dev:auth`)
- Mastra Server: 3001 (production mode, host-only via `npm run start`; not in docker-compose)

## Architecture Overview

### Agent Architecture (Mastra-based)

The platform uses a multi-agent architecture orchestrated by Mastra:

```
backend/src/mastra/
├── index.ts              # Mastra instance configuration
├── agents/
│   └── monitoring-agent.ts   # Main agent: scans 10 risk categories
├── tools/                # 13 specialized monitoring tools
│   ├── erp-context-tool.ts          # Retrieves org supply chain context
│   ├── incident-lookup-tool.ts      # Deduplication via content hashing
│   ├── organization-lookup-tool.ts  # Org lookup by ID
│   ├── weather-disaster-monitor-tool.ts   # NOAA, NASA EONET
│   ├── political-risk-monitor-tool.ts     # GDELT, news APIs
│   ├── cybersecurity-monitor-tool.ts      # NVD, security feeds
│   ├── economic-financial-monitor-tool.ts # Market data
│   ├── news-social-media-monitor-tool.ts  # TheNewsAPI, Twitter
│   ├── maritime-logistics-monitor-tool.ts # Port closures
│   ├── labor-social-monitor-tool.ts       # Strikes, protests
│   ├── regulatory-trade-monitor-tool.ts   # Tariffs, sanctions
│   ├── pandemic-health-monitor-tool.ts    # WHO, CDC
│   └── geopolitical-conflict-monitor-tool.ts
└── scorers/
    └── monitoring-scorer.ts  # Agent evaluation scorers
```

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

### Event Processing Pipeline

1. Retrieve org context via `erpContextTool` (plants, warehouses, suppliers, lanes)
2. Execute monitoring tools for enabled data sources
3. Deduplicate using stable content hash: `normalize(title)|source|type|truncate_to_hour(timestamp)`
4. Filter by geographic proximity using Haversine distance
5. Filter by org's `monitored_risk_types` preferences
6. Score severity (0.0-1.0) and confidence (0.0-1.0)
7. Persist validated events to database

### Database Schema (Key Models)

```
Organization          # Multi-tenant root entity
├── OrganizationContext  # ERP data: plants, warehouses, suppliers, lanes
├── Event             # Raw detected events before validation
├── Incident          # Validated events promoted to incidents (INC-2025-0001)
├── RiskAssessment    # Agent-generated risk analysis
├── EventHash         # Deduplication tracking with TTL
├── Supplier          # Supply chain entities from BOL data
├── Shipment          # Bill of Lading data
└── Carrier           # Shipping carriers (SCAC codes)
```

### Multi-Tenancy Pattern

All data is strictly isolated by `organization_id`:
- Every database query MUST filter by `organization_id`
- Every tool MUST validate `organization_id` before execution
- Root organization (`is_root: true`, `@pericles.cloud` domain) has global access

## Key Implementation Details

### Mastra Configuration

```typescript
// backend/src/mastra/index.ts
export const mastra = new Mastra({
  agents: { monitoringAgent },
  scorers: { relevanceScorer, severityAccuracyScorer, deduplicationScorer },
  storage: getPostgresStore(),
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
  observability: { default: { enabled: true } },
});
```

### External API Integration Pattern

```typescript
const response = await fetch(apiUrl, {
  headers: { 'User-Agent': 'Pericles-SupplyChainMonitor/1.0 (contact@pericles.cloud)' },
  signal: AbortSignal.timeout(10000)  // REQUIRED: timeout for all external calls
});
```

### Geographic Distance (Haversine)

Used for filtering events by proximity to supply chain locations:
```typescript
// backend/src/mastra/tools/weather-disaster-monitor-tool.ts:402
export function calculateDistance(lat1, lon1, lat2, lon2): number // Returns km
```

## Environment Variables

All environment variables are defined in a single `.env.local` file in the project root. Both backend and frontend load from this file.

Required in `.env.local` (project root):

```bash
# Database
DATABASE_URL="postgresql://pericles_user:pericles_dev_password@localhost:5432/pericles"
MASTRA_DATABASE_URL="postgresql://pericles_user:pericles_dev_password@localhost:5432/mastra"

# AI Provider (required)
OPENAI_API_KEY=your-key

# Data Source APIs (optional, for monitoring tools)
THENEWSAPI_API_KEY=
TWITTERAPIIO_API_KEY=
OPENWEATHER_API_KEY=
MARINETRAFFIC_API_KEY=

# Frontend (required)
NEXT_PUBLIC_API_URL=http://localhost:4112
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

# Infrastructure (PostgreSQL-based queue/KV store - no Redis required)
MONITORING_DEFAULT_INTERVAL_MS=15000
```

See `.env.example` for the complete list of available variables.

## Code Quality Requirements (MANDATORY)

**After every code change, run:**

```bash
cd backend
npm run lint          # Fix: npm run lint:fix
npm run type-check
```

Do not consider a task complete until both checks pass.

## Git Conventions

```
feat(agent): add typhoon detection tool [TICKET-123]
fix(tools): handle API timeout in weather monitor
```

## Cursor Rules Reference

The `.cursor/rules/` directory contains detailed standards:
- `001-application/001-agents/`: Agent implementation rules
- `700-ai/701-mastra-agent-core-standards-auto.mdc`: Mastra-specific patterns
- `500-architecture/506-postgresql-core-standards-auto.mdc`: Database patterns
- `300-languages/307-typescript-core-standards-auto.mdc`: TypeScript standards