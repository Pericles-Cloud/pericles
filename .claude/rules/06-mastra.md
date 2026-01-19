---
paths:
  - "backend/src/mastra/**/*.ts"
---

# Mastra Framework Standards

## Mastra Configuration

```typescript
// backend/src/mastra/index.ts
import { Mastra, PinoLogger } from '@mastra/core';
import { PostgresStore } from '@mastra/pg-store';

export const mastra = new Mastra({
  agents: {
    monitoringAgent,
    validationAgent,
    impactAssessmentAgent,
    controllerAgent,
    summarizationAgent,
  },
  scorers: {
    relevanceScorer,
    severityAccuracyScorer,
    deduplicationScorer,
  },
  storage: new PostgresStore({
    connectionString: process.env.MASTRA_DATABASE_URL,
  }),
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
  observability: { default: { enabled: true } },
});
```

## Agent Definition

```typescript
import { Agent } from '@mastra/core/agent';

export const monitoringAgent = new Agent({
  name: 'monitoring-agent',

  // Instructions can be string, array of strings, or system messages
  instructions: [
    'You are a supply chain risk monitoring agent for Pericles.',
    'CRITICAL: Always validate organization_id for tenant isolation.',
    'Monitor enabled risk categories and detect potential disruptions.',
    'Deduplicate events using content hashing.',
    'Score severity (0.0-1.0) and confidence (0.0-1.0).',
  ],

  // Model routing - auto-detects env vars
  model: 'openai/gpt-4o',  // or openai('gpt-4o') from @ai-sdk/openai

  tools: {
    weatherDisasterTool,
    politicalRiskTool,
    cybersecurityTool,
    erpContextTool,
    incidentLookupTool,
  },

  // Limit sequential LLM calls (prevent infinite loops)
  maxSteps: 5,

  // Monitor completion
  onFinish: (result) => {
    console.log('Steps:', result.steps.length);
    console.log('Tokens:', result.usage);
  },
});
```

## Memory Management

Mastra implements three memory categories:

| Type | Purpose | Scope |
|------|---------|-------|
| **Working Memory** | Persistent user-specific data (preferences, goals) | Resource-scoped |
| **Conversation History** | Recent messages from current conversation | Thread-scoped |
| **Semantic Recall** | Vector-based retrieval of older messages | Resource-scoped |

```typescript
import { Memory } from '@mastra/core';

const memory = new Memory({
  provider: 'postgres',  // or libsql, mongodb, upstash
  connectionString: process.env.DATABASE_URL,
});

const agent = new Agent({
  name: 'memory-agent',
  instructions: 'Remember user preferences across sessions.',
  memory: memory,
});
```

## Execution Methods

### Generate (Full Output)
```typescript
// String prompt
const response = await agent.generate('What risks are in Southeast Asia?');

// With structured output
const response = await agent.generate(prompt, {
  schema: z.object({
    events: z.array(z.object({
      title: z.string(),
      severity: z.number(),
      location: z.string(),
    })),
  }),
});
console.log(response.object); // Typed result
```

### Stream (Real-time Tokens)
```typescript
const stream = await agent.stream('Analyze supply chain risks...');

for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

### Runtime Context
```typescript
const response = await agent.generate(prompt, {
  runtimeContext: {
    organizationId: ctx.organization_id,
    isPremiumUser: user.tier === 'premium',
  },
});
```

## MCP Integration (Model Context Protocol)

### MCPClient - Connect to External Servers
```typescript
import { MCPClient } from '@mastra/core';

// Static (single user)
const mcpClient = new MCPClient({
  servers: {
    weather: { url: new URL('http://localhost:8080/mcp') },
  },
});

// Dynamic (multi-tenant with per-user auth)
const userMcp = new MCPClient({
  servers: {
    weather: {
      url: new URL('http://localhost:8080/mcp'),
      requestInit: {
        headers: { Authorization: `Bearer ${userApiKey}` },
      },
    },
  },
});
```

### Dynamic Tools for Multi-Tenant
```typescript
// Per-request tool injection
const response = await agent.generate(userPrompt, {
  toolsets: await userMcp.getToolsets(),
});
```

## Model Selection

| Use Case | Model | Reasoning |
|----------|-------|-----------|
| Complex reasoning | `openai/gpt-4o` | Agent instructions, impact assessment |
| Simple tasks | `openai/gpt-4o-mini` | Summarization, classification |
| Anthropic | `anthropic/claude-3-5-sonnet-latest` | Alternative provider |
| Google | `google/gemini-1.5-pro` | Alternative provider |
| Embeddings | `text-embedding-3-small` | Semantic search |

## Scorer Implementation

```typescript
import { Scorer } from '@mastra/core';

export const relevanceScorer = new Scorer({
  name: 'relevance',
  description: 'Scores event relevance to organization supply chain',
  score: async ({ input, output, context }) => {
    return {
      score: calculatedScore, // 0.0 to 1.0
      reason: 'Event affects supplier in monitored region',
    };
  },
});
```

## Best Practices

### Agent Design
- **Single Responsibility**: Each agent has a clear, focused purpose
- **Clear Instructions**: Specific, actionable instruction arrays
- **Appropriate Model**: Use mini models for simple tasks
- **Tool Selection**: Only include relevant tools

### Error Handling
- Set reasonable `maxSteps` limits (default: 5)
- Implement proper error handling in tools
- Provide fallback behaviors
- Log failures for debugging

### Multi-Tenant
- Use dynamic tool configuration per user
- Implement authorization checks
- Isolate user data (separate memory instances)
- Use resource-scoped memory when appropriate

### Security
- Never commit API keys (use env vars)
- Validate all user inputs
- Implement proper auth for MCP endpoints
- Audit tool access and permissions

## Development Workflow

```bash
# Start Mastra dev server (port 4111)
npm run dev

# Access Mastra Studio for testing
open http://localhost:4111

# Build for production
npm run build

# Start production server (port 3001)
npm run start
```
