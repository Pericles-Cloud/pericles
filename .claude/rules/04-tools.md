---
paths:
  - "backend/src/mastra/tools/**/*.ts"
---

# Mastra Tool Standards

## Tool Creation Pattern

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const weatherDisasterTool = createTool({
  id: 'weather-disaster-monitor',
  description: 'Monitors weather events and natural disasters that may impact supply chain',

  inputSchema: z.object({
    organization_id: z.string().uuid().describe('Required for tenant isolation'),
    location: z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    }).optional(),
    radius_km: z.number().positive().default(500),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    events: z.array(z.object({
      id: z.string(),
      title: z.string(),
      severity: z.number().min(0).max(1),
      location: z.object({ lat: z.number(), lon: z.number() }),
      source: z.string(),
    })),
    metadata: z.object({
      fetched_at: z.string().datetime(),
      source_count: z.number(),
    }),
  }),

  execute: async ({ context }) => {
    // 1. Validate tenant context
    if (!context.organization_id) {
      throw new Error('organization_id required for tenant isolation');
    }

    // 2. Execute with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(API_URL, {
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${process.env.WEATHER_API_KEY}` },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // 3. Return structured output
      return {
        success: true,
        events: transformEvents(data),
        metadata: {
          fetched_at: new Date().toISOString(),
          source_count: data.sources?.length ?? 1,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});
```

## Required Tool Behaviors

1. **Tenant Isolation** - Always require and validate `organization_id`
2. **Input Validation** - Zod schemas with `.describe()` for documentation
3. **Timeouts** - All external API calls with abort controllers (default 30s)
4. **Structured Output** - Return objects matching `outputSchema` exactly
5. **Error Handling** - Catch and handle API failures gracefully

## Monitoring Tool Categories

| Category | Tool | Data Sources |
|----------|------|--------------|
| Weather & Natural Disasters | `weatherDisasterTool` | NOAA, EONET |
| Political Risk | `politicalRiskTool` | GDELT |
| Cybersecurity | `cybersecurityTool` | NVD, CISA RSS |
| Economic & Financial | `economicFinancialTool` | FRED |
| News & Social Media | `newsSocialMediaTool` | TheNewsAPI, X/Twitter |
| Maritime & Logistics | `maritimeLogisticsTool` | RSS feeds |
| Labor & Social | `laborSocialTool` | RSS feeds |
| Regulatory & Trade | `regulatoryTradeTool` | FRED |
| Pandemic & Health | `pandemicHealthTool` | WHO RSS, CDC RSS |
| Geopolitical & Conflict | `geopoliticalConflictTool` | GDELT |

## Data Source API Reference

| Source | API Documentation | Used By |
|--------|-------------------|---------|
| **GDELT** | `http://data.gdeltproject.org/gdeltv2` | Political, Geopolitical |
| **NOAA** | `https://www.weather.gov/documentation/services-web-api` | Weather |
| **EONET** | `https://eonet.gsfc.nasa.gov/docs/v3` | Natural Disasters |
| **NVD** | `https://services.nvd.nist.gov/rest/json/cves/2.0` | Cybersecurity |
| **FRED** | `https://fred.stlouisfed.org/docs/api/fred/` | Economic, Regulatory |
| **TheNewsAPI** | `https://www.thenewsapi.com/documentation` | News |
| **X/Twitter** | `https://docs.twitterapi.io/introduction` | Social Media |

## Tool Development Guidelines

When creating tools for the Monitoring Agent:

1. **Read API documentation** for each data source
2. **Create reusable API clients** to reduce code redundancy
3. **Store credentials securely** in database (env file for development)
4. **Document the tool's purpose** in the tool name and code
5. **Ensure testability** with proper setup and validation

## Infrastructure Tools

| Tool | Purpose |
|------|---------|
| `erpContextTool` | Retrieves organization supply chain context (plants, warehouses, suppliers, lanes) |
| `incidentLookupTool` | Deduplication via content hashing |
| `sapErpDataTool` | SAP S/4HANA integration for ERP data |
