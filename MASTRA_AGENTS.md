# Mastra Agent Development Guide

## Overview

Mastra agents are autonomous systems that use Large Language Models (LLMs) and tools to solve open-ended tasks. Agents reason about goals, decide which tools to use, and iterate internally until reaching a final answer or meeting a stopping condition.

### Key Capabilities

- **Autonomous Decision-Making**: Leverage language models with tool integration for complex, unstructured problems
- **Context Management**: Operate with conversation history, external data retrieval, and semantic memory
- **Human-in-the-Loop**: Suspend execution for user input/approval, then resume from checkpoints
- **Production Ready**: Built-in observability, scorers, and monitoring for reliability
- **Flexible Deployment**: Embed in React/Next.js/Node.js apps or deploy as standalone endpoints

---

## Installation & Setup

### Prerequisites

- **Node.js 20+**
- **API key** from a model provider (OpenAI, Google Gemini, Anthropic, etc.)

### Quick Start

```bash
# Option 1: CLI Setup (recommended)
npm create mastra@latest

# Option 2: Manual Setup
npm install @mastra/core zod
npm install -D typescript @types/node mastra
```

### Environment Configuration

Create `.env` file with your API keys:

```env
# Choose your provider
OPENAI_API_KEY=<your-key>
GOOGLE_GENERATIVE_AI_API_KEY=<your-key>
ANTHROPIC_API_KEY=<your-key>
```

---

## Agent Configuration

### Basic Agent Definition

```typescript
import { Agent } from "@mastra/core/agent";

export const myAgent = new Agent({
  name: "my-agent",
  instructions: "You are a helpful assistant specialized in...",
  model: "openai/gpt-4o-mini",
});
```

### Agent Configuration Options

#### Name & Instructions

```typescript
const agent = new Agent({
  name: "support-agent",

  // Option 1: Simple string
  instructions: "You are a customer support agent.",

  // Option 2: Array of context pieces
  instructions: [
    "You are a customer support agent.",
    "Always be polite and professional.",
    "Escalate to human if unable to resolve."
  ],

  // Option 3: Array of system messages
  instructions: [
    { role: "system", content: "You are a customer support agent." }
  ],
});
```

#### Model Selection

Mastra's model router auto-detects environment variables and supports 600+ models:

```typescript
// Option 1: String format
model: "openai/gpt-4o-mini"

// Option 2: Vercel AI SDK
import { openai } from "@ai-sdk/openai";
model: openai("gpt-4o-mini")

// Other providers
model: "anthropic/claude-3-5-sonnet-latest"
model: "google/gemini-1.5-pro"
```

#### Provider-Specific Options

Configure caching, reasoning, and other provider features:

```typescript
instructions: [
  {
    role: "system",
    content: "You are an expert analyst.",
    providerOptions: {
      openai: {
        reasoning: { type: "extended" }
      },
      anthropic: {
        cacheControl: { type: "ephemeral" }
      }
    }
  }
]
```

#### Tool Integration

```typescript
import { myTool, anotherTool } from "./tools";

const agent = new Agent({
  name: "tool-agent",
  instructions: "Use tools to complete tasks.",
  tools: { myTool, anotherTool }
});
```

#### Advanced Options

```typescript
const agent = new Agent({
  name: "advanced-agent",
  instructions: "...",
  model: "openai/gpt-4o-mini",

  // Limit sequential LLM calls (prevent infinite loops)
  maxSteps: 5,

  // Callback after completion
  onFinish: (result) => {
    console.log("Steps taken:", result.steps);
    console.log("Token usage:", result.usage);
    console.log("Finish reason:", result.finishReason);
  },

  // Monitor multi-step progress
  onStepFinish: (step) => {
    console.log("Step completed:", step);
  }
});
```

---

## Tool Creation & Integration

### Static vs Dynamic Tools

**Static Tools** - Single-user apps with fixed credentials:
```typescript
const agent = new Agent({
  tools: await mcpClient.getTools()
});
```

**Dynamic Tools** - Multi-tenant systems with per-user credentials:
```typescript
const response = await agent.generate(userPrompt, {
  toolsets: await userMcp.getToolsets()
});
```

### Tool Sources via MCP

Mastra integrates with multiple MCP registries:

- **Klavis AI**: Enterprise-authenticated hosted servers
- **mcp.run**: Pre-authenticated managed profiles
- **Composio.dev**: SSE-based tool registry
- **Smithery.ai**: CLI-accessible server registry
- **Ampersand**: 150+ SaaS integrations

---

## Memory Management

### Memory Types

Mastra implements three memory categories:

1. **Working Memory**: Persistent user-specific data (preferences, names, goals)
   - Stored as Markdown or Zod schema
   - Agents can update over time

2. **Conversation History**: Recent messages from current conversations
   - Maintains dialogue continuity

3. **Semantic Recall**: Vector-based retrieval of older messages
   - Searches past conversations with surrounding context

### Memory Scoping

- **Thread-scoped** (default): Memory applies to single conversation
- **Resource-scoped**: Working memory and semantic recall persist across all threads for same user/entity

### Storage Adapters

Requires persistent storage provider:
- LibSQL (default, file-based or in-memory)
- MongoDB
- PostgreSQL
- Upstash

### Agent Memory Setup

```typescript
import { Memory } from "@mastra/core";

const memory = new Memory({
  provider: "libsql", // or mongodb, postgres, upstash
  // ... provider-specific config
});

const agent = new Agent({
  name: "memory-agent",
  instructions: "Remember user preferences.",
  memory: memory
});
```

### Context Token Management

When total messages exceed model token limit, use memory processors to trim or filter:

```typescript
// Memory automatically manages context window
// Processors can filter messages before sending to model
```

### Observability

When tracing is enabled, agents display all retrieved messages including conversation history and semantically recalled content for debugging.

---

## MCP Integration (Model Context Protocol)

### Overview

MCP serves as a universal plugin system, enabling agents to call tools regardless of language or hosting environment.

### MCPClient - Connect to External Servers

```typescript
import { MCPClient } from "@mastra/core";

// Static configuration (single user)
const mcpClient = new MCPClient({
  servers: {
    weather: {
      url: new URL("http://localhost:8080/mcp")
    }
  }
});

// Dynamic configuration (multi-tenant)
const userMcp = new MCPClient({
  servers: {
    weather: {
      url: new URL("http://localhost:8080/mcp"),
      requestInit: {
        headers: {
          Authorization: `Bearer ${userApiKey}`
        }
      }
    }
  }
});
```

### MCPServer - Expose Mastra Resources

```typescript
import { MCPServer } from "@mastra/core";

const mcpServer = new MCPServer({
  agents: { myAgent },
  tools: { myTool },
  workflows: { myWorkflow }
});

// Expose via HTTP endpoint
mcpServer.listen(8080);
```

### Authentication Patterns

1. **Static**: API keys configured once at initialization
2. **Dynamic**: Per-request credentials (varies by user)
3. **Environment Variables**: Secure storage, referenced at runtime

---

## Mastra Instance & Registration

### Creating the Mastra Instance

```typescript
import { Mastra } from "@mastra/core";

export const mastra = new Mastra({
  agents: {
    myAgent,
    supportAgent,
    analysisAgent
  },
  // Optional: shared resources
  // memory, logging, observability
});
```

### Benefits of Registration

- Application-wide access to agents
- Shared resources (memory, logging, observability)
- Centralized configuration

### Project Structure

```
src/
├── mastra/
│   ├── index.ts              # Mastra instance & registration
│   ├── agents/
│   │   ├── support-agent.ts
│   │   ├── analysis-agent.ts
│   │   └── validation-agent.ts
│   └── tools/
│       ├── weather-tool.ts
│       └── database-tool.ts
├── .env                      # API keys & secrets
└── package.json
```

---

## Agent Execution

### Generate (Full Output)

```typescript
// String prompt
const response = await agent.generate("What is the weather?");

// Array of messages
const response = await agent.generate([
  { role: "user", content: "What is the weather?" }
]);

// With structured output
const response = await agent.generate(prompt, {
  schema: z.object({
    temperature: z.number(),
    conditions: z.string()
  })
});

// Access structured result
console.log(response.object);
```

### Stream (Real-time Tokens)

```typescript
const stream = await agent.stream("Analyze this data...");

for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

### Image Analysis

```typescript
const response = await agent.generate([
  {
    role: "user",
    content: [
      { type: "text", text: "What's in this image?" },
      { type: "image", image: imageUrl }
    ]
  }
]);
```

### Runtime Context

Conditionally adjust model selection based on request-specific values:

```typescript
const response = await agent.generate(prompt, {
  runtimeContext: {
    useAdvancedModel: isPremiumUser
  }
});
```

---

## Development Workflow

### Running Development Server

```bash
npm run dev
```

Access Mastra Studio at `http://localhost:4111`

### Studio Features

- Test agents with different messages
- Inspect tool execution
- Debug behavior
- Monitor token usage
- View conversation history

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "mastra dev",
    "build": "mastra build"
  }
}
```

---

## Best Practices

### 1. Agent Design

- **Single Responsibility**: Each agent should have a clear, focused purpose
- **Clear Instructions**: Provide specific, actionable instructions
- **Appropriate Model**: Balance cost/speed (use mini models for simple tasks)
- **Tool Selection**: Only include relevant tools to reduce confusion

### 2. Context Management

- Monitor token usage with `onFinish()` callback
- Implement memory processors for long conversations
- Use semantic recall for retrieving relevant past context
- Consider token limits when designing system prompts

### 3. Error Handling

- Set reasonable `maxSteps` limits (default: 5)
- Implement proper error handling in tools
- Log failures for debugging
- Provide fallback behaviors

### 4. Multi-Tenant Applications

- Use dynamic tool configuration per user
- Implement proper authorization checks
- Isolate user data (separate memory instances)
- Use resource-scoped memory when appropriate

### 5. Production Deployment

- Enable observability and monitoring
- Use scorers to measure performance
- Implement rate limiting
- Cache frequently used data
- Configure proper timeout values

### 6. Security

- Never commit API keys (use environment variables)
- Validate all user inputs
- Implement proper authentication for MCP endpoints
- Use HTTPS for all external communications
- Audit tool access and permissions

### 7. Testing

- Test agents in Studio before deployment
- Create test cases for common scenarios
- Verify tool execution correctness
- Monitor token costs during testing
- Test edge cases and error conditions

---

## Integration with Pericles Platform

### Agent Architecture Alignment

The Pericles platform currently implements:

- **Monitoring Agent**: Real-time data source monitoring
- **Validation Agent**: Multi-source event confirmation
- **Controller Agent**: Notification coordination and orchestration
- **Impact Assessment Agent**: Financial impact calculation from ERP data
- **Summarization Agent**: Event summary maintenance

### Migration Strategy

When building new Mastra agents for Pericles:

1. **Define Clear Responsibilities**: Map existing agent functions to Mastra agents
2. **Tool Integration**: Connect to existing APIs, databases, and external services
3. **Memory Configuration**: Configure appropriate memory scopes for each agent
4. **Observability**: Integrate with existing monitoring and logging
5. **API Endpoints**: Expose agents via Vercel serverless functions
6. **Testing**: Use Studio for development, Playwright for E2E tests

### Example Agent Structure

```typescript
// src/mastra/agents/monitoring-agent.ts
import { Agent } from "@mastra/core/agent";
import { newsApiTool, weatherApiTool } from "../tools";

export const monitoringAgent = new Agent({
  name: "monitoring-agent",
  instructions: [
    "You are the Pericles monitoring agent.",
    "Monitor data sources for supply chain risk events.",
    "Focus on: natural disasters, political instability, port disruptions.",
    "Alert on high-severity events immediately."
  ],
  model: "openai/gpt-4o-mini",
  tools: {
    newsApiTool,
    weatherApiTool
  },
  maxSteps: 3,
  onFinish: (result) => {
    // Log to audit system
    console.log("Monitoring check completed:", result);
  }
});
```

### Vercel API Integration

```typescript
// api/agents/monitoring.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { mastra } from '../../src/mastra';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, userId } = req.body;

    // Get agent from registered Mastra instance
    const agent = mastra.agents.monitoringAgent;

    // Generate response
    const response = await agent.generate(prompt, {
      runtimeContext: { userId }
    });

    return res.status(200).json({
      response: response.text
    });
  } catch (error) {
    console.error('Agent error:', error);
    return res.status(500).json({
      error: 'Agent execution failed'
    });
  }
}
```

---

## Troubleshooting

### Common Issues

**Agent not responding**
- Check API key is set in environment
- Verify model name format is correct
- Check token limits haven't been exceeded
- Review `maxSteps` configuration

**Tools not executing**
- Ensure tools are properly registered
- Check tool schemas are valid
- Verify authentication for external services
- Review tool error logs

**Memory not persisting**
- Confirm storage adapter is configured
- Check database connection
- Verify thread/resource scoping
- Review memory processor configuration

**Token limit exceeded**
- Implement memory processors
- Reduce system prompt length
- Use conversation summarization
- Consider switching to larger context model

---

## Resources

- **Documentation**: https://mastra.ai/docs/
- **Model Support**: 600+ models across multiple providers
- **Community**: Discord support channel
- **Templates**: Available via `npm create mastra@latest`

---

## Quick Reference

### Agent Creation

```typescript
new Agent({ name, instructions, model, tools, maxSteps })
```

### Execution Methods

```typescript
await agent.generate(prompt)      // Full output
await agent.stream(prompt)        // Streaming tokens
```

### Memory Types

- Working Memory (persistent user data)
- Conversation History (recent messages)
- Semantic Recall (vector search past conversations)

### MCP Classes

- `MCPClient` - Connect to external servers
- `MCPServer` - Expose Mastra resources

### Storage Adapters

- LibSQL (default)
- MongoDB
- PostgreSQL
- Upstash
