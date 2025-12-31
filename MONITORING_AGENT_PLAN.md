# Monitoring Agent Implementation Plan

## Overview
Create a Mastra-based Monitoring Agent for real-time supply chain risk event detection following the patterns established in `backend/src/mastra/agents/weather-agent.ts` and adhering to `.cursor/rules/001-application/001-agents/001-monitoring-agent-core-standards-auto.mdc`.

## Architecture Summary

**Execution Mode**: Continuous background process with 15-second polling intervals
**Database**: Prisma + PostgreSQL for event persistence and deduplication
**Data Sources**: Placeholder tools (News, Weather, Port, Social Media APIs)
**Event Flow**: Detection → Deduplication → Geographic Filter → Risk Analysis → Store → Validate → Queue → Log

## Key Requirements (from monitoring-agent-core-standards)
- ✅ **Organization-first**: Explicit organization_id validation before all operations
- ✅ **Customer Contextualization**: Use ERP + business documents to tailor monitoring
- ✅ **Configuration Precedence**: Runtime > Database > Defaults (organization_id immutable)
- ✅ **Deduplication**: Stable content hash with 7-day lookback window
- ✅ **Error Handling**: Continuous loop with exponential backoff (max 60s)
- ✅ **Modular Monitoring**: Independent tools per data source, config-toggleable
- ✅ **Geographic Filtering**: Proximity-based with configurable radius (default: 100km)
- ✅ **Risk Analysis**: Severity (0.0-1.0), Confidence (0.0-1.0), risk factors
- ✅ **ISO Timestamps**: All temporal data in ISO 8601 format

---

## Implementation Files

### Phase 1: Database Foundation (Priority: Critical)

**1. Create Prisma Schema** → `backend/prisma/schema.prisma`
```prisma
- Organization (multi-tenancy root)
- OrganizationContext (ERP data + risk preferences)
- Event (raw detected events)
- Incident (validated events)
- RiskAssessment (agent-generated analysis)
- EventHash (deduplication tracking with TTL)
- MonitoringAuditLog (observability)
```

**Key Indexes**:
- `Event`: `(organization_id, event_hash)` unique, `(organization_id, validation_status)`, `(event_hash)`
- `EventHash`: `(organization_id, hash)` unique, `(organization_id, expires_at)`
- All models: `organization_id` index for organization isolation

**Migration Commands**:
```bash
cd backend
npx prisma migrate dev --name init_monitoring_schema
npx prisma generate
```

---

### Phase 2: Tools (Data Source Interfaces)

**2. Create Tool Scaffolding** → `backend/src/mastra/tools/`

All tools follow this pattern:
- Zod schemas for input/output validation
- Organization_id required in all inputs
- Empty/placeholder execute functions initially
- Proper error handling with timeouts

**Tools to Create**:
1. **`news-monitoring-tool.ts`** - Monitor news APIs for disruptions (placeholder)
2. **`weather-monitoring-tool.ts`** - Track extreme weather events (placeholder)
3. **`port-status-tool.ts`** - Monitor port closures/congestion (placeholder)
4. **`social-media-tool.ts`** - Early warning signals from Twitter/Reddit (placeholder)
5. **`erp-context-tool.ts`** - Query OrganizationContext for supply chain footprint ⚠️ **CRITICAL**
6. **`incident-lookup-tool.ts`** - Deduplication via event hash lookup ⚠️ **CRITICAL**

**Critical Implementation Details**:

**`erp-context-tool.ts`**:
```typescript
// Returns organization's supply chain footprint
outputSchema: {
  plants: [...],
  warehouses: [...],
  suppliers: [...],
  shipping_lanes: [...],
  risk_preferences: {
    monitored_risk_types: string[],
    geographic_radius_km: number,
    severity_threshold: number
  }
}
```

**`incident-lookup-tool.ts`**:
```typescript
// Stable hash generation for deduplication
function generateEventHash(title, source, type, timestamp):
  - Normalize: lowercase + trim
  - Truncate timestamp to hour (bucketing)
  - Hash: SHA-256(title|source|type|hour_bucket)
  - Query EventHash table by organization_id + hash
  - Return: { event_hash, is_duplicate, last_seen_at }
```

**7. Create Tool Index** → `backend/src/mastra/tools/index.ts`
```typescript
export { newsMonitoringTool, weatherMonitoringTool, ... };
```

---

### Phase 3: Monitoring Agent

**8. Create Monitoring Agent** → `backend/src/mastra/agents/monitoring-agent.ts`

**Pattern**: Follow `weather-agent.ts` structure

**Configuration**:
```typescript
new Agent({
  name: 'Monitoring Agent',
  instructions: `
    - Monitor data sources for supply chain risk events
    - CRITICAL: Validate organization_id before all operations
    - Use erpContextTool to understand customer footprint
    - Apply deduplication via incidentLookupTool
    - Filter by geographic proximity and risk preferences
    - Compute severity (0.0-1.0) and confidence (0.0-1.0)
    - Return structured incident records
  `,
  model: 'anthropic/claude-sonnet-4-5-20250929',
  tools: {
    newsMonitoringTool,
    weatherMonitoringTool,
    portStatusTool,
    socialMediaTool,
    erpContextTool,
    incidentLookupTool
  },
  scorers: {
    relevanceScore: { scorer: relevanceScorer, sampling: { rate: 1 } },
    severityAccuracy: { scorer: severityAccuracyScorer, sampling: { rate: 1 } },
    deduplicationEffectiveness: { scorer: deduplicationScorer, sampling: { rate: 0.1 } }
  },
  memory: new Memory({
    storage: new LibSQLStore({ url: 'file:../mastra-monitoring.db' })
  }),
  maxSteps: 10,
  onStepFinish: (step) => { /* Log tool calls */ },
  onFinish: (result) => { /* Log cycle metrics */ }
})
```

**9. Create Monitoring Scorers** → `backend/src/mastra/scorers/monitoring-scorer.ts`
- `relevanceScorer` - Geographic + risk type relevance
- `severityAccuracyScorer` - Severity calibration
- `deduplicationScorer` - Duplicate detection effectiveness

**10. Register Agent** → Modify `backend/src/mastra/index.ts`
```typescript
import { monitoringAgent } from './agents/monitoring-agent';
import { relevanceScorer, severityAccuracyScorer, deduplicationScorer } from './scorers/monitoring-scorer';

export const mastra = new Mastra({
  agents: {
    weatherAgent,
    monitoringAgent // ADD
  },
  scorers: {
    ...weatherScorers,
    relevanceScorer, severityAccuracyScorer, deduplicationScorer // ADD
  },
  // ... rest of config
});
```

---

### Phase 4: Monitoring Loop (Continuous Polling)

**11. Create Core Monitoring Logic** → `backend/src/monitoring/index.ts`

**Key Functions**:

```typescript
// Main entry point - continuous loop
export async function startMonitoring(config: MonitoringConfig): Promise<void> {
  while (isRunning) {
    try {
      await runMonitoringCycle(config);
      await sleep(config.pollingIntervalMs); // 15 seconds
    } catch (error) {
      // Exponential backoff: 1s → 2s → 4s → ... → max 60s
      await sleep(calculateBackoff(error));
    }
  }
}

// Single monitoring cycle
async function runMonitoringCycle(config: MonitoringConfig): Promise<void> {
  // 1. Get monitoring agent from Mastra
  const agent = mastra.getAgent('monitoringAgent');

  // 2. Execute agent with organization context
  const response = await agent.generate(monitoringPrompt, {
    schema: z.object({
      detected_events: z.array(/* event schema */)
    }),
    runtimeContext: { organizationId: config.organizationId }
  });

  // 3. Process each detected event
  for (const eventData of response.object.detected_events) {
    if (eventData.is_duplicate) continue;

    const storedEvent = await storeEvent(config.organizationId, eventData);
    await emitToQueue(storedEvent);
    await passToValidationAgent(storedEvent);
  }
}

// Store event in database (atomic transaction)
async function storeEvent(organizationId: string, eventData: any): Promise<Event> {
  return await prisma.$transaction(async (tx) => {
    const event = await tx.event.create({ /* ... */ });
    await tx.eventHash.upsert({ /* dedup tracking */ });
    await tx.riskAssessment.create({ /* risk scores */ });
    return event;
  });
}
```

**12. Create Configuration Management** → `backend/src/monitoring/config.ts`
```typescript
// Zod schema for configuration validation
export const MonitoringConfigSchema = z.object({
  organizationId: z.string(), // IMMUTABLE
  pollingIntervalMs: z.number().default(15000),
  enabledSources: { news, weather, ports, socialMedia },
  geographicFilter: { radiusKm: 100, strictMode: false },
  riskFilter: { severityThreshold: 0.3 },
  deduplication: { lookbackWindowHours: 168 },
  errorHandling: { maxBackoffMs: 60000 }
});

// Load with precedence: runtime > database > defaults
export async function loadMonitoringConfig(
  organizationId: string,
  runtimeOverrides?: Partial<MonitoringConfig>
): Promise<MonitoringConfig>;
```

**13. Create Supporting Modules**:
- `backend/src/monitoring/logger.ts` - Structured logging with Pino
- `backend/src/monitoring/metrics.ts` - Cycle metrics tracking
- `backend/src/monitoring/error-reporter.ts` - Error classification
- `backend/src/monitoring/db-client.ts` - Prisma singleton + transactions
- `backend/src/monitoring/validation-client.ts` - Validation Agent interface
- `backend/src/monitoring/queue-client.ts` - Message queue (Redis/SQS placeholder)

**14. Create Entry Points**:
- `backend/src/monitoring/start.ts` - Standalone Node process
  ```bash
  node dist/monitoring/start.js --organization-id=<organization-id>
  ```
- `backend/api/monitoring/trigger.ts` - Vercel API endpoint (alternative)

---

### Phase 5: API Endpoint (Optional - for Vercel Cron)

**15. Create Vercel API Endpoint** → `backend/api/monitoring/trigger.ts`
```typescript
// POST /api/monitoring/trigger
// Body: { organization_id: string }
// Auth: Bearer token required
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Validate auth
  // Extract organization_id
  // Run single monitoring cycle
  // Return success/failure
}
```

**16. Configure Vercel Cron** → `backend/vercel.json`
```json
{
  "crons": [{
    "path": "/api/monitoring/trigger",
    "schedule": "*/1 * * * *"  // 1-minute minimum
  }]
}
```

⚠️ **Note**: Vercel Cron has 1-minute minimum. For 15-second polling, use standalone Node process.

---

## Configuration Files

**17. Update Environment Variables** → `backend/.env.example`
```bash
# Database
DATABASE_URL="postgresql://..."

# AI Provider
ANTHROPIC_API_KEY=your-key

# Data Source APIs (for future tool implementation)
NEWS_API_KEY=
OPENWEATHER_API_KEY=
TWITTER_API_KEY=
REDDIT_CLIENT_ID=
MARINETRAFFIC_API_KEY=

# Message Queue
REDIS_URL=redis://localhost:6379

# Monitoring Config
MONITORING_DEFAULT_INTERVAL_MS=15000
LOG_LEVEL=info
```

**18. Update Dependencies** → `backend/package.json`
```json
{
  "dependencies": {
    "@mastra/core": "^0.24.8",
    "@prisma/client": "^6.12.0",
    "zod": "^4.1.13",
    "pino": "^9.0.0"
  },
  "devDependencies": {
    "prisma": "^6.12.0"
  },
  "scripts": {
    "monitoring:start": "node dist/monitoring/start.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate:dev": "prisma migrate dev"
  }
}
```

---

## Event Processing Pipeline

```
┌─────────────────────────────────────────┐
│      MONITORING AGENT                    │
│   (Polls every 15 seconds)              │
└────────────┬────────────────────────────┘
             │
             ▼
    ┌────────────────┐
    │ Tool Execution │
    │ (News, Weather,│
    │  Port, Social) │
    └────────┬───────┘
             │
             ▼
    ┌────────────────────┐
    │ DEDUPLICATION      │
    │ - Generate hash    │
    │ - Query EventHash  │
    │ - 7-day lookback   │
    └────────┬───────────┘
             │
      Duplicate? ──Yes──> Skip
             │
            No
             │
             ▼
    ┌────────────────────┐
    │ GEOGRAPHIC FILTER  │
    │ - Get ERP context  │
    │ - Check proximity  │
    │ - Apply radius     │
    └────────┬───────────┘
             │
             ▼
    ┌────────────────────┐
    │ RISK ANALYSIS      │
    │ - Classify type    │
    │ - Compute severity │
    │ - Compute confidence│
    └────────┬───────────┘
             │
             ▼
    ┌────────────────────┐
    │ STORE IN DATABASE  │
    │ - Event            │
    │ - EventHash        │
    │ - RiskAssessment   │
    └────────┬───────────┘
             │
     ┌───────┴────────┐
     │                │
     ▼                ▼
┌──────────┐    ┌──────────┐
│Validation│    │ Message  │
│ Agent    │    │  Queue   │
└──────────┘    └──────────┘
```

---

## Critical Implementation Notes

### 1. Organization Isolation (Non-Negotiable)
- **EVERY** database query must filter by `organization_id`
- **EVERY** tool must validate `organization_id` is present
- Use Prisma's where clauses: `where: { organization_id: organizationId }`
- Never allow `organization_id` to be overridden once set

### 2. Deduplication Hash Formula
```typescript
function generateEventHash(title, source, type, timestamp) {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedSource = source.trim().toLowerCase();
  const normalizedType = type.trim().toLowerCase();

  // Truncate to hour for bucketing
  const hourBucket = new Date(timestamp).setMinutes(0, 0, 0);

  const hashInput = `${normalizedTitle}|${normalizedSource}|${normalizedType}|${hourBucket}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}
```

### 3. Error Handling Strategy
- **Network Errors**: Recoverable → Retry with exponential backoff
- **Config Errors**: Fatal → Stop immediately, log error
- **Database Errors**: Recoverable → Retry up to 3 times
- **Rate Limits**: Recoverable → Backoff proportional to limit window

### 4. Geographic Distance Calculation
```typescript
// Haversine formula for distance in km
function calculateDistance(lat1, lon1, lat2, lon2): number {
  const R = 6371; // Earth radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
```

### 5. Graceful Shutdown
```typescript
process.on('SIGINT', () => {
  stopMonitoring();
  prisma.$disconnect();
  process.exit(0);
});
```

---

## Testing Strategy

### Unit Tests
- [ ] Configuration precedence (runtime > database > defaults)
- [ ] Event hash consistency across multiple runs
- [ ] Geographic distance calculations
- [ ] Severity/confidence normalization

### Integration Tests
- [ ] Full monitoring cycle with mock tools
- [ ] Database transaction atomicity (rollback on failure)
- [ ] Error recovery and exponential backoff
- [ ] Deduplication with EventHash queries

### End-to-End Tests
- [ ] Deploy monitoring agent for test organization
- [ ] Verify events stored in database
- [ ] Check EventHash prevents duplicates
- [ ] Validate Validation Agent receives events
- [ ] Confirm metrics incremented correctly

---

## Deployment Options

### Option A: Standalone Node Process (Recommended)
**Pros**: 15-second polling, full control, simple architecture
**Cons**: Requires dedicated server/container

```bash
# Production deployment
cd backend
npm run build
node dist/monitoring/start.js --organization-id=<organization-id>
```

**Process Management**: Use PM2 or systemd
```bash
pm2 start dist/monitoring/start.js --name monitoring-agent -- --organization-id=<organization-id>
pm2 save
pm2 startup
```

### Option B: Vercel Serverless + Cron
**Pros**: No infrastructure management, auto-scaling
**Cons**: 1-minute minimum interval (not 15 seconds)

```json
// vercel.json
{
  "crons": [{
    "path": "/api/monitoring/trigger",
    "schedule": "*/1 * * * *"
  }]
}
```

---

## Implementation Order

1. ✅ **Phase 1**: Database (Prisma schema, migrations)
2. ✅ **Phase 2**: Tools (scaffolding, critical tools first: ERP + Incident Lookup)
3. ✅ **Phase 3**: Agent (monitoring agent, scorers, registration)
4. ✅ **Phase 4**: Monitoring Loop (core logic, config, supporting modules)
5. ✅ **Phase 5**: API Endpoint (Vercel handler, optional)
6. ⏳ **Phase 6**: Testing (unit, integration, e2e)
7. ⏳ **Phase 7**: Deployment (production database, environment, process)
8. ⏳ **Phase 8**: Tool Implementation (integrate real APIs - post-MVP)

---

## File Summary

**New Files** (20):
- `backend/prisma/schema.prisma`
- `backend/src/mastra/agents/monitoring-agent.ts`
- `backend/src/mastra/tools/` (6 tools + index.ts)
- `backend/src/mastra/scorers/monitoring-scorer.ts`
- `backend/src/monitoring/` (7 files: index, start, config, db-client, validation-client, queue-client, logger, metrics, error-reporter)
- `backend/api/monitoring/trigger.ts`
- `backend/vercel.json`

**Modified Files** (3):
- `backend/src/mastra/index.ts` (register agent)
- `backend/package.json` (add dependencies)
- `backend/.env.example` (add env vars)

---

## Success Criteria

✅ Monitoring agent runs continuously with 15-second intervals
✅ Events detected from tools are stored in database
✅ Deduplication prevents duplicate event publication
✅ Geographic filtering applies organization-specific radius
✅ Risk analysis computes severity and confidence scores
✅ Organization isolation enforced at database and agent level
✅ Error handling recovers from transient failures
✅ Structured logs provide observability
✅ Validation Agent receives events for confirmation
✅ Configuration supports runtime overrides

---

## Next Steps After Implementation

1. **Integrate Real Data Sources**: Implement execute functions for News, Weather, Port, Social tools
2. **Create Validation Agent**: Multi-source event confirmation
3. **Build Impact Assessment Agent**: Calculate financial impact from ERP
4. **Implement Controller Agent**: Orchestrate notifications and workflow
5. **Create Summarization Agent**: Maintain event summaries
6. **Add UI Dashboard**: Display detected events, incidents, risk scores

---

## References

- **Mastra Rules**: `.cursor/rules/700-ai/701-mastra-agent-core-standards-auto.mdc`
- **Agent Standards**: `.cursor/rules/700-ai/720-mastra-agent-standards-auto.mdc`
- **Monitoring Agent Rules**: `.cursor/rules/001-application/001-agents/001-monitoring-agent-core-standards-auto.mdc`
- **Project Architecture**: `CLAUDE.md`
- **Reference Implementation**: `backend/src/mastra/agents/weather-agent.ts`
- **Mastra Docs**: https://mastra.ai/docs
