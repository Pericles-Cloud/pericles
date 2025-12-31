# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pericles is a supply chain risk management platform built on an intelligent AI agent architecture using Mastra. The platform monitors real-time data sources to detect, validate, and assess supply chain disruption events.

### Core Agents (Mastra-based)
- **Monitoring Agent**: Real-time data source monitoring across 10 risk categories
- **Validation Agent**: Multi-source event confirmation (planned)
- **Controller Agent**: Coordinates notifications and agent orchestration (planned)
- **Impact Assessment Agent**: Calculates financial impact from ERP data (planned)
- **Summarization Agent**: Maintains event summaries (planned)

### Product Modules (Planned)
- **Atlas**: Interactive global map showing shipments, suppliers, and incidents
- **Events**: Incident ingestion, lifecycle management, and response coordination
- **Insights**: Country and sector risk analytics with trend dashboards
- **Plans**: Incident response planning, playbooks, and compliance workflows

## Tech Stack

- **Framework**: Mastra AI Agent Framework (`@mastra/core`)
- **Language**: TypeScript 5.9 (strict mode), ES Modules
- **Database**: PostgreSQL 16 (Docker local), Neon serverless (production)
- **ORM**: Prisma 6.12
- **Build System**: Nx monorepo
- **AI Provider**: OpenAI GPT-4o (via Mastra model routing)
- **Logging**: Pino with pino-pretty

## Repository Structure

```
pericles/
├── backend/                    # Nx project: Mastra agents and API
│   ├── src/
│   │   ├── mastra/
│   │   │   ├── agents/         # AI agent definitions
│   │   │   ├── tools/          # 12+ monitoring tools
│   │   │   └── scorers/        # Agent evaluation scorers
│   │   ├── integrations/
│   │   │   └── sap/            # SAP S/4HANA integration
│   │   └── monitoring/         # Monitoring infrastructure
│   ├── api/                    # HTTP API endpoints
│   └── prisma/                 # Database schema and migrations
├── docker-compose.yml          # Local development services
└── .cursor/rules/              # Development standards (90+ rule files)
```

## Build & Development Commands

```bash
# Docker services (PostgreSQL 16, pgAdmin, Redis, Mastra)
docker-compose up -d             # Start all services
docker-compose down              # Stop all services
docker-compose logs -f mastra    # Watch Mastra logs

# Backend development (run from backend/)
cd backend
npm install                      # Install dependencies
npm run dev                      # Start Mastra dev server (port 4111)
npm run build                    # Build Mastra agents
npm run start                    # Start Mastra production server

# Database (Prisma)
npm run prisma:generate          # Generate Prisma client
npm run prisma:migrate:dev       # Run migrations (development)
npm run prisma:migrate:deploy    # Deploy migrations (production)
npm run prisma:seed              # Seed database with test data
npm run prisma:studio            # Open Prisma Studio GUI

# Code quality
npm run lint                     # ESLint check
npm run lint:fix                 # ESLint auto-fix
npm run format                   # Prettier format
npm run type-check               # TypeScript type checking

# Nx commands (from root)
npx nx run backend:build         # Build backend project
npx nx run-many -t lint          # Lint all projects
```

## Local Development Setup

1. Copy environment file: `cp backend/.env.example backend/.env`
2. Start Docker services: `docker-compose up -d`
3. Wait for PostgreSQL health check to pass
4. Run migrations: `cd backend && npm run prisma:migrate:dev`
5. Start Mastra dev server: `npm run dev`
6. Access Mastra Studio: http://localhost:4111

### Service Ports
- PostgreSQL: 5432
- pgAdmin: 5050 (admin@pericles.dev / admin)
- Redis: 6379
- Mastra Dev: 4111
- Mastra Server: 3001 (production mode)

## Monitoring Agent Architecture

The Monitoring Agent scans 10 risk categories using dedicated tools:

1. **Weather & Natural Disasters** - NOAA, OpenWeather
2. **Political Risk** - GDELT, news APIs
3. **Cybersecurity** - NVD, security feeds
4. **Economic & Financial** - Market data, currency risks
5. **News & Social Media** - TheNewsAPI, Twitter
6. **Maritime & Logistics** - Port closures, shipping delays
7. **Labor & Social** - Strikes, protests
8. **Regulatory & Trade** - Tariffs, sanctions
9. **Pandemic & Health** - WHO, CDC alerts
10. **Geopolitical & Conflict** - Armed conflicts, terrorism

### Critical Infrastructure Tools
- `erpContextTool`: Retrieves organization supply chain context
- `incidentLookupTool`: Deduplication via content hashing

### Event Processing Pipeline
1. Retrieve org context (plants, warehouses, suppliers, lanes)
2. Execute monitoring tools for enabled data sources
3. Deduplicate using stable content hash (title|source|type|hour)
4. Filter by geographic proximity (Haversine distance)
5. Filter by risk type preferences
6. Score severity (0.0-1.0) and confidence (0.0-1.0)
7. Persist validated events to database

## Database Schema (Key Models)

- `Organization`: Multi-tenant root entity with supply chain context
- `Event`: Raw detected events before validation
- `Incident`: Validated events promoted to trackable incidents
- `RiskAssessment`: Agent-generated risk analysis
- `EventHash`: Deduplication tracking with TTL
- `Supplier`, `Shipment`, `Carrier`: Supply chain entities

## Key Architecture Patterns

### Multi-Tenancy
- All data strictly isolated by `organization_id`
- Agent operations MUST validate org context before execution
- Root organization (`@pericles.cloud` domain) has global access

### Tool Design
- All tools use Zod schemas for input validation
- Tools return structured JSON matching expected schemas
- Timeouts and error handling required for external API calls

### Mastra Configuration
```typescript
// backend/src/mastra/index.ts
export const mastra = new Mastra({
  agents: { monitoringAgent },
  scorers: { relevanceScorer, severityAccuracyScorer, deduplicationScorer },
  storage: new PostgresStore({ connectionString: process.env.MASTRA_DATABASE_URL }),
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
  observability: { default: { enabled: true } },
});
```

## Git Conventions

Use conventional commit format:
```
feat(agent): add typhoon detection tool [TICKET-123]
fix(tools): handle API timeout in weather monitor [TICKET-124]
```

Branch naming:
```
feature/TICKET-123-description
fix/TICKET-124-description
```

## Security Requirements

- All agent operations enforce tenant isolation via organization_id
- API keys stored in environment variables only
- No sensitive data in logs (PII redaction required)
- External API calls must have timeouts and abort controllers

## Code Quality Requirements (MANDATORY)

**After every code change or generation, you MUST run these checks:**

```bash
cd backend
npm run lint          # Check for ESLint errors
npm run type-check    # Check for TypeScript errors
```

- **Do not consider a task complete until both checks pass**
- Fix any lint errors before moving on (use `npm run lint:fix` for auto-fixable issues)
- Fix any TypeScript errors before moving on
- If errors cannot be auto-fixed, resolve them manually before proceeding

## Cursor Rules

The `.cursor/rules/` directory contains 90+ rule files organized by category:
- `000-core/`: Core project standards and AI assistant behavior
- `001-application/`: Pericles-specific rules (agents, modules)
- `200-quality/`: ESLint, Prettier, Git workflow
- `300-languages/`: TypeScript standards
- `400-frameworks/`: React, Tailwind (for future frontend)
- `500-architecture/`: PostgreSQL, Docker, Neon, Vercel
- `600-tooling/`: Development tools and libraries
- `700-ai/`: Mastra agent standards


<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors

<!-- nx configuration end-->