---
paths:
  - "backend/src/mastra/agents/**/*.ts"
---

# Pericles Agent Standards

## Agent Architecture

Pericles uses five coordinated AI agents:

| Agent | Responsibility |
|-------|---------------|
| **Monitoring Agent** | Scans 10 risk categories, detects events, deduplicates via content hashing |
| **Validation Agent** | Multi-source confirmation, severity scoring, confidence assessment |
| **Impact Assessment Agent** | Calculates financial impact using ERP/SAP data |
| **Controller Agent** | Orchestrates notifications, coordinates agents, handles user interactions |
| **Summarization Agent** | Maintains event summaries and contextual updates |

## Risk Monitoring Categories

The Monitoring Agent covers 10 risk categories with dedicated tools:

| # | Category | Agent Type | Data Sources |
|---|----------|------------|--------------|
| 1 | Political Risk | `POLITICAL_RISK_MONITOR` | GDELT |
| 2 | Weather & Natural Disasters | `WEATHER_DISASTER_MONITOR` | NOAA, USGS, EONET |
| 3 | Economic & Financial | `ECONOMIC_FINANCIAL_MONITOR` | FRED |
| 4 | Maritime & Logistics | `MARITIME_LOGISTICS_MONITOR` | RSS feeds |
| 5 | Labor & Social | `LABOR_SOCIAL_MONITOR` | RSS feeds |
| 6 | Regulatory & Trade Policy | `REGULATORY_TRADE_MONITOR` | FRED |
| 7 | Pandemic & Health | `PANDEMIC_HEALTH_MONITOR` | WHO RSS, CDC RSS |
| 8 | Geopolitical & Conflict | `GEOPOLITICAL_CONFLICT_MONITOR` | GDELT |
| 9 | Cybersecurity | `CYBERSECURITY_MONITOR` | NVD, CISA RSS |
| 10 | News & Social Media | `REALTIME_MONITOR` | TheNewsAPI, X/Twitter |

### Data Source APIs

| Source | API Endpoint | Categories |
|--------|--------------|------------|
| GDELT | `http://data.gdeltproject.org/gdeltv2` | Political, Geopolitical |
| NOAA | `https://www.weather.gov/documentation/services-web-api` | Weather |
| EONET | `https://eonet.gsfc.nasa.gov/docs/v3` | Natural Disasters |
| NVD | `https://services.nvd.nist.gov/rest/json/cves/2.0` | Cybersecurity |
| FRED | `https://fred.stlouisfed.org/docs/api/fred/` | Economic, Regulatory |
| TheNewsAPI | `https://www.thenewsapi.com/documentation` | News |
| X/Twitter | `https://docs.twitterapi.io/introduction` | Social Media |

## Agent Definition Pattern

```typescript
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';

export const monitoringAgent = new Agent({
  name: 'Monitoring Agent',
  instructions: `
    You are a supply chain risk monitoring agent.

    CRITICAL REQUIREMENTS:
    1. Always validate organization_id for tenant isolation
    2. Deduplicate events using content hashing
    3. Score severity (0.0-1.0) and confidence (0.0-1.0)
    4. Filter by geographic proximity to org assets
  `,
  model: openai('gpt-4o'),
  tools: {
    weatherDisasterTool,
    politicalRiskTool,
    erpContextTool,
    incidentLookupTool,
  },
});
```

## Non-Negotiable Requirements

### Tenant Isolation (Critical)
```typescript
// CORRECT - validate tenant scope
if (context.organization_id !== event.organization_id) {
  throw new TenantIsolationError('Cross-tenant access denied');
}

// INCORRECT - missing tenant check
await db.event.findMany(); // No org filter!
```

### Idempotency (Critical)
```typescript
// Content hash for deduplication
const hash = createHash('sha256')
  .update(`${title}|${source}|${type}|${hourBucket}`)
  .digest('hex');

// Check before creating
const existing = await db.eventHash.findUnique({ where: { hash } });
if (existing) {
  return { deduplicated: true, existingEventId: existing.event_id };
}
```

### Audit Logging
```typescript
// Log state transitions with context (never PII)
audit({
  action: 'EVENT_DETECTED',
  tenant_id: ctx.organization_id,
  event_id: event.id,
  agent: 'monitoring',
  timestamp: new Date().toISOString(),
});
```

## Agent State Machine

```
NEW -> DETECTED -> VALIDATING -> VALIDATED -> ASSESSING_IMPACT -> ASSESSED -> NOTIFYING -> CLOSED
                       |                           |
                       v                           v
                   INVALID                    INCONCLUSIVE
```

## Event Processing Pipeline

1. **Retrieve org context** - plants, warehouses, suppliers, shipping lanes
2. **Execute monitoring tools** - enabled data sources only
3. **Deduplicate** - stable content hash (title|source|type|hour)
4. **Filter by proximity** - Haversine distance to org assets
5. **Filter by risk type** - org preferences
6. **Score severity** - 0.0-1.0 scale
7. **Persist validated events** - with hash for future dedup
