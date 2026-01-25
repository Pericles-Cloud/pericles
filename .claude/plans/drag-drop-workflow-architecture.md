# Drag-and-Drop Workflow Canvas Architecture

A comprehensive, stack-agnostic guide for building interactive node-based workflow editors with persistent state management.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Layers](#architecture-layers)
3. [Frontend Implementation](#frontend-implementation)
4. [Backend Implementation](#backend-implementation)
5. [Data Models](#data-models)
6. [Real-Time Synchronization](#real-time-synchronization)
7. [API Design](#api-design)
8. [Multi-Tenancy](#multi-tenancy)
9. [Technology Recommendations](#technology-recommendations)

---

## Overview

This architecture supports:
- **Interactive node-based workflow editing** with drag-and-drop
- **Real-time state persistence** via WebSocket
- **Multi-user collaboration** with optimistic updates
- **Multi-tenancy** for SaaS applications
- **Execution graph building** from visual workflows

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Node** | A visual element representing a workflow step (e.g., agent, condition, loop) |
| **Edge** | A connection between two nodes representing flow direction |
| **Viewport** | The canvas view state (pan position and zoom level) |
| **Handle** | Connection points on nodes (source/target anchors) |

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                           │
│  Canvas Library (ReactFlow, Vue Flow, etc.)                     │
│  - Renders nodes, edges, handles                                │
│  - Captures drag events, connections, selections                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    STATE MANAGEMENT LAYER                       │
│  Client Store (Zustand, Pinia, Redux, etc.)                     │
│  - Manages local state (nodes, edges, viewport)                 │
│  - Applies optimistic updates immediately                       │
│  - Handles undo/redo stack                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    SYNC LAYER                                   │
│  WebSocket Client (Socket.io, Phoenix Channels, etc.)           │
│  - Pushes changes to server                                     │
│  - Receives authoritative state updates                         │
│  - Handles reconnection and conflict resolution                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    API LAYER (Server)                           │
│  WebSocket Handlers + REST Endpoints                            │
│  - Validates and processes changes                              │
│  - Broadcasts state to connected clients                        │
│  - Provides REST fallback for initial load                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    BUSINESS LOGIC LAYER                         │
│  Workflow Service / Context Module                              │
│  - CRUD operations for workflows, nodes, edges                  │
│  - Format conversion (UI ↔ Database)                            │
│  - Graph building for execution                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    PERSISTENCE LAYER                            │
│  Database (PostgreSQL, MongoDB, etc.)                           │
│  - Stores workflows, nodes, edges                               │
│  - Maintains referential integrity                              │
│  - Supports efficient queries with indexes                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Frontend Implementation

### 1. Canvas Library Selection

**Recommended: ReactFlow** (or Vue Flow for Vue.js)

Features to leverage:
- Node rendering with custom components
- Edge rendering with connection validation
- Built-in viewport controls (pan, zoom, minimap)
- Event callbacks for all interactions

### 2. Required Event Handlers

```typescript
// Pseudo-code - adapt to your framework

interface CanvasEventHandlers {
  // Node position changes (drag)
  onNodesChange: (changes: NodeChange[]) => void;

  // Edge changes (add/remove connections)
  onEdgesChange: (changes: EdgeChange[]) => void;

  // New connection created
  onConnect: (connection: Connection) => void;

  // Node selection
  onNodeClick: (nodeId: string) => void;

  // Viewport pan/zoom
  onViewportChange: (viewport: Viewport) => void;

  // Node deletion
  onNodesDelete: (nodes: Node[]) => void;

  // Edge deletion
  onEdgesDelete: (edges: Edge[]) => void;
}
```

### 3. Client State Store Structure

```typescript
interface WorkflowState {
  // === Graph State ===
  nodes: Node[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number };

  // === Selection State ===
  selectedNodeId: string | null;
  selectedEdgeIds: string[];

  // === Workflow Metadata ===
  workflow: {
    id: string | number | null;
    name: string;
    description?: string;
    status: 'draft' | 'published' | 'archived';
    version: number;
  };

  // === Sync State ===
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  pendingChanges: Change[];  // For offline support

  // === Actions ===
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  addNode: (node: Node) => void;
  updateNode: (id: string, data: Partial<Node>) => void;
  deleteNodes: (ids: string[]) => void;
  connect: (connection: Connection) => void;
  deleteEdge: (id: string) => void;
  setViewport: (viewport: Viewport) => void;

  // === Sync Actions ===
  syncToServer: (change: Change) => void;
  applyServerState: (state: ServerState) => void;
}
```

### 4. Optimistic Update Pattern

```typescript
// Example: Adding a node

function addNode(node: Node) {
  // 1. Generate temporary client ID
  const clientId = `temp_${Date.now()}`;
  const nodeWithId = { ...node, id: clientId };

  // 2. Apply optimistically to local state
  store.setState(state => ({
    nodes: [...state.nodes, nodeWithId]
  }));

  // 3. Send to server
  websocket.send('add_node', { node: nodeWithId });

  // 4. Server responds with authoritative state
  // (handled in state sync listener)
}
```

### 5. Debounced Position Updates

Position changes happen frequently during drag. Debounce to reduce server load:

```typescript
const debouncedPositionSync = debounce((changes: PositionChange[]) => {
  websocket.send('nodes_change', { changes });
}, 100); // 100ms debounce

function onNodesChange(changes: NodeChange[]) {
  // Apply locally immediately
  applyNodeChanges(changes);

  // Filter position changes and debounce sync
  const positionChanges = changes.filter(c => c.type === 'position');
  if (positionChanges.length > 0) {
    debouncedPositionSync(positionChanges);
  }
}
```

---

## Backend Implementation

### 1. Service Layer Interface

```typescript
// TypeScript/Node.js example

interface WorkflowService {
  // === CRUD Operations ===
  createWorkflow(data: CreateWorkflowDTO): Promise<Workflow>;
  getWorkflow(id: string): Promise<Workflow | null>;
  getWorkflowWithGraph(id: string): Promise<WorkflowWithGraph>;
  updateWorkflow(id: string, data: UpdateWorkflowDTO): Promise<Workflow>;
  deleteWorkflow(id: string): Promise<void>;
  listWorkflows(filters: WorkflowFilters): Promise<Workflow[]>;

  // === Node Operations ===
  createNode(workflowId: string, node: CreateNodeDTO): Promise<WorkflowNode>;
  updateNode(workflowId: string, nodeId: string, data: UpdateNodeDTO): Promise<WorkflowNode>;
  updateNodePosition(workflowId: string, nodeId: string, position: Position): Promise<void>;
  deleteNode(workflowId: string, nodeId: string): Promise<void>;

  // === Edge Operations ===
  createEdge(workflowId: string, edge: CreateEdgeDTO): Promise<WorkflowEdge>;
  deleteEdge(workflowId: string, edgeId: string): Promise<void>;

  // === Batch Operations ===
  applyChanges(workflowId: string, changes: BatchChanges): Promise<WorkflowWithGraph>;

  // === Format Conversion ===
  toClientFormat(workflow: WorkflowWithGraph): ClientWorkflowState;
  fromClientFormat(workflowId: string, state: ClientWorkflowState): BatchChanges;

  // === Execution ===
  buildExecutionGraph(workflowId: string): Promise<ExecutionGraph>;
}
```

### 2. Format Conversion Functions

The server stores data in normalized database format. Convert to/from UI format:

```typescript
// Database Node → UI Node
function nodeToClientFormat(dbNode: DBWorkflowNode): UINode {
  return {
    id: dbNode.clientId,           // Use client-facing ID
    type: dbNode.type,
    position: {
      x: dbNode.positionX,
      y: dbNode.positionY,
    },
    data: dbNode.data,             // Node-specific configuration
  };
}

// UI Node → Database Node
function nodeFromClientFormat(workflowId: string, uiNode: UINode): DBNodeInsert {
  return {
    workflowId: workflowId,
    clientId: uiNode.id,
    type: uiNode.type,
    positionX: uiNode.position.x,
    positionY: uiNode.position.y,
    data: uiNode.data || {},
  };
}

// Database Edge → UI Edge
function edgeToClientFormat(dbEdge: DBWorkflowEdge): UIEdge {
  return {
    id: dbEdge.clientId,
    source: dbEdge.sourceNode.clientId,  // Map DB FK to client ID
    target: dbEdge.targetNode.clientId,  // Map DB FK to client ID
    sourceHandle: dbEdge.sourceHandle,
    targetHandle: dbEdge.targetHandle,
    label: dbEdge.label,
    data: dbEdge.data,
  };
}

// UI Edge → Database Edge (requires node ID mapping)
function edgeFromClientFormat(
  workflowId: string,
  uiEdge: UIEdge,
  nodeIdMap: Map<string, string>  // clientId → dbId
): DBEdgeInsert {
  return {
    workflowId: workflowId,
    clientId: uiEdge.id,
    sourceNodeId: nodeIdMap.get(uiEdge.source),
    targetNodeId: nodeIdMap.get(uiEdge.target),
    sourceHandle: uiEdge.sourceHandle,
    targetHandle: uiEdge.targetHandle,
    label: uiEdge.label,
    data: uiEdge.data || {},
  };
}
```

### 3. Batch Change Processing

Handle multiple changes atomically in a transaction:

```typescript
async function applyChanges(
  workflowId: string,
  changes: BatchChanges
): Promise<WorkflowWithGraph> {
  return await db.transaction(async (tx) => {
    // Process node changes
    for (const change of changes.nodes || []) {
      switch (change.type) {
        case 'add':
          await createNode(tx, workflowId, change.node);
          break;
        case 'position':
          await updateNodePosition(tx, workflowId, change.id, change.position);
          break;
        case 'update':
          await updateNode(tx, workflowId, change.id, change.data);
          break;
        case 'remove':
          await deleteNode(tx, workflowId, change.id);
          break;
      }
    }

    // Process edge changes
    for (const change of changes.edges || []) {
      switch (change.type) {
        case 'add':
          await createEdge(tx, workflowId, change.edge);
          break;
        case 'remove':
          await deleteEdge(tx, workflowId, change.id);
          break;
      }
    }

    // Update viewport if provided
    if (changes.viewport) {
      await updateViewport(tx, workflowId, changes.viewport);
    }

    // Return complete updated state
    return await getWorkflowWithGraph(tx, workflowId);
  });
}
```

---

## Data Models

### 1. Database Schema (SQL)

```sql
-- Workflows table
CREATE TABLE workflows (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  status          VARCHAR(20) DEFAULT 'draft',  -- draft, published, archived
  version         INTEGER DEFAULT 1,
  viewport        JSONB DEFAULT '{"x": 0, "y": 0, "zoom": 1}',

  -- Multi-tenancy
  organization_id VARCHAR(255) NOT NULL,
  user_id         VARCHAR(255) NOT NULL,
  session_id      VARCHAR(255),

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(organization_id, name)
);

CREATE INDEX idx_workflows_org ON workflows(organization_id);
CREATE INDEX idx_workflows_org_user ON workflows(organization_id, user_id);

-- Workflow nodes table
CREATE TABLE workflow_nodes (
  id              SERIAL PRIMARY KEY,
  workflow_id     INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  client_id       VARCHAR(255) NOT NULL,  -- ID used by UI library
  type            VARCHAR(50) NOT NULL,   -- start, end, agent, condition, etc.
  position_x      FLOAT NOT NULL,
  position_y      FLOAT NOT NULL,
  data            JSONB DEFAULT '{}',     -- Node-specific configuration

  -- Optional: link to external resources (e.g., agents)
  agent_id        INTEGER REFERENCES agents(id) ON DELETE SET NULL,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(workflow_id, client_id)
);

CREATE INDEX idx_workflow_nodes_workflow ON workflow_nodes(workflow_id);

-- Workflow edges table
CREATE TABLE workflow_edges (
  id              SERIAL PRIMARY KEY,
  workflow_id     INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  client_id       VARCHAR(255) NOT NULL,  -- ID used by UI library
  source_node_id  INTEGER NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  target_node_id  INTEGER NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  source_handle   VARCHAR(100),           -- Optional handle identifier
  target_handle   VARCHAR(100),           -- Optional handle identifier
  label           VARCHAR(255),
  data            JSONB DEFAULT '{}',     -- Edge-specific configuration

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(workflow_id, client_id)
);

CREATE INDEX idx_workflow_edges_workflow ON workflow_edges(workflow_id);
CREATE INDEX idx_workflow_edges_source ON workflow_edges(source_node_id);
CREATE INDEX idx_workflow_edges_target ON workflow_edges(target_node_id);
```

### 2. TypeScript Interfaces

```typescript
// Database models
interface DBWorkflow {
  id: number;
  name: string;
  description?: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
  viewport: { x: number; y: number; zoom: number };
  organizationId: string;
  userId: string;
  sessionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface DBWorkflowNode {
  id: number;
  workflowId: number;
  clientId: string;
  type: string;
  positionX: number;
  positionY: number;
  data: Record<string, unknown>;
  agentId?: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DBWorkflowEdge {
  id: number;
  workflowId: number;
  clientId: string;
  sourceNodeId: number;
  targetNodeId: number;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// UI/Client models (ReactFlow compatible)
interface UINode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface UIEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  data?: Record<string, unknown>;
}

interface ClientWorkflowState {
  workflow: {
    id: number;
    name: string;
    description?: string;
    status: string;
    version: number;
  };
  nodes: UINode[];
  edges: UIEdge[];
  viewport: { x: number; y: number; zoom: number };
}
```

---

## Real-Time Synchronization

### 1. WebSocket Event Protocol

```typescript
// Client → Server Events
interface ClientEvents {
  // Node operations
  'add_node':       { node: UINode };
  'update_node':    { id: string; data: Partial<UINode['data']> };
  'delete_nodes':   { ids: string[] };
  'nodes_change':   { changes: NodeChange[] };

  // Edge operations
  'connect':        { connection: { source: string; target: string; sourceHandle?: string; targetHandle?: string } };
  'delete_edge':    { id: string };

  // Viewport
  'update_viewport': { viewport: { x: number; y: number; zoom: number } };

  // Workflow metadata
  'update_workflow': { data: { name?: string; description?: string; status?: string } };
  'publish':         {};
}

// Server → Client Events
interface ServerEvents {
  'state:change':   { state: ClientWorkflowState; version: number };
  'error':          { code: string; message: string };
}

// Node change types (from ReactFlow)
type NodeChange =
  | { type: 'position'; id: string; position: { x: number; y: number } }
  | { type: 'remove'; id: string }
  | { type: 'select'; id: string; selected: boolean }
  | { type: 'dimensions'; id: string; dimensions: { width: number; height: number } };
```

### 2. Server Event Handler Pattern

```typescript
// Node.js/TypeScript example with Socket.io

class WorkflowChannel {
  private workflowId: string;
  private workflowService: WorkflowService;

  constructor(socket: Socket, workflowId: string) {
    this.workflowId = workflowId;
    this.setupEventHandlers(socket);
  }

  private setupEventHandlers(socket: Socket) {
    socket.on('add_node', (payload) => this.handleAddNode(socket, payload));
    socket.on('nodes_change', (payload) => this.handleNodesChange(socket, payload));
    socket.on('connect', (payload) => this.handleConnect(socket, payload));
    socket.on('delete_edge', (payload) => this.handleDeleteEdge(socket, payload));
    socket.on('update_viewport', (payload) => this.handleUpdateViewport(socket, payload));
  }

  private async handleNodesChange(socket: Socket, payload: { changes: NodeChange[] }) {
    const { changes } = payload;

    for (const change of changes) {
      switch (change.type) {
        case 'position':
          if (change.position) {
            await this.workflowService.updateNodePosition(
              this.workflowId,
              change.id,
              change.position
            );
          }
          break;
        case 'remove':
          await this.workflowService.deleteNode(this.workflowId, change.id);
          break;
      }
    }

    // Broadcast updated state to all clients
    await this.broadcastState(socket);
  }

  private async handleConnect(socket: Socket, payload: { connection: Connection }) {
    const { connection } = payload;

    const edgeId = `e${connection.source}-${connection.target}`;
    await this.workflowService.createEdge(this.workflowId, {
      clientId: edgeId,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    });

    await this.broadcastState(socket);
  }

  private async broadcastState(socket: Socket) {
    const workflowWithGraph = await this.workflowService.getWorkflowWithGraph(this.workflowId);
    const clientState = this.workflowService.toClientFormat(workflowWithGraph);

    // Broadcast to all clients in this workflow's room
    socket.to(`workflow:${this.workflowId}`).emit('state:change', {
      state: clientState,
      version: workflowWithGraph.workflow.version,
    });

    // Also send to the originating client
    socket.emit('state:change', {
      state: clientState,
      version: workflowWithGraph.workflow.version,
    });
  }
}
```

### 3. Connection Management

```typescript
// Client-side connection manager

class WorkflowConnection {
  private socket: Socket;
  private workflowId: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  async connect(workflowId: string, tenant: TenantContext): Promise<void> {
    this.workflowId = workflowId;

    this.socket = io('/workflow', {
      query: {
        workflow_id: workflowId,
        organization_id: tenant.organizationId,
        user_id: tenant.userId,
        session_id: tenant.sessionId,
      },
    });

    this.socket.on('connect', () => {
      this.reconnectAttempts = 0;
      store.setConnectionStatus('connected');
    });

    this.socket.on('disconnect', () => {
      store.setConnectionStatus('disconnected');
    });

    this.socket.on('state:change', (payload) => {
      store.applyServerState(payload.state);
    });

    this.socket.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  }

  send<K extends keyof ClientEvents>(event: K, payload: ClientEvents[K]): void {
    if (this.socket?.connected) {
      this.socket.emit(event, payload);
    } else {
      // Queue for later or handle offline
      store.addPendingChange({ event, payload });
    }
  }

  disconnect(): void {
    this.socket?.disconnect();
  }
}
```

---

## API Design

### REST Endpoints (for initial load and non-realtime operations)

```
# Workflow CRUD
GET    /api/workflows                    # List workflows (with filters)
POST   /api/workflows                    # Create new workflow
GET    /api/workflows/:id                # Get workflow with full graph
PUT    /api/workflows/:id                # Update workflow metadata
DELETE /api/workflows/:id                # Delete workflow

# Query Parameters
?organization_id=string                  # Required for multi-tenant
&user_id=string                          # Optional filter by user
&status=draft|published|archived         # Optional status filter

# Response format for GET /api/workflows/:id
{
  "workflow": {
    "id": 123,
    "name": "My Workflow",
    "description": "...",
    "status": "draft",
    "version": 1,
    "organizationId": "org_123",
    "userId": "user_456"
  },
  "nodes": [
    {
      "id": "node-1",
      "type": "start",
      "position": { "x": 100, "y": 100 },
      "data": { "label": "Start" }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "node-1",
      "target": "node-2"
    }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

### WebSocket Topics

```
# Connect to existing workflow
ws://server/workflow?workflow_id=123&organization_id=org_123

# Create new workflow
ws://server/workflow?new=true&organization_id=org_123&name=My%20Workflow
```

---

## Multi-Tenancy

### 1. Tenant Context

Every request (REST and WebSocket) must include tenant context:

```typescript
interface TenantContext {
  organizationId: string;   // Required: isolates data between organizations
  userId: string;           // Required: tracks ownership and permissions
  sessionId?: string;       // Optional: tracks editing sessions for audit
}
```

### 2. Query Scoping

All database queries must be scoped by tenant:

```typescript
// BAD - no tenant scoping
const workflow = await db.workflows.findById(id);

// GOOD - scoped by organization
const workflow = await db.workflows.findOne({
  id: id,
  organizationId: tenant.organizationId,
});
```

### 3. Authorization Patterns

```typescript
// Resource-level authorization
async function canAccessWorkflow(
  tenant: TenantContext,
  workflowId: string,
  action: 'view' | 'edit' | 'delete'
): Promise<boolean> {
  const workflow = await getWorkflow(workflowId);

  if (!workflow) return false;

  // Must be same organization
  if (workflow.organizationId !== tenant.organizationId) {
    return false;
  }

  // Check user-level permissions based on action
  switch (action) {
    case 'view':
      return true;  // All org members can view
    case 'edit':
      return workflow.userId === tenant.userId || hasRole(tenant, 'editor');
    case 'delete':
      return workflow.userId === tenant.userId || hasRole(tenant, 'admin');
  }
}
```

---

## Technology Recommendations

### Frontend

| Category | Recommended | Alternatives |
|----------|-------------|--------------|
| Canvas Library | **ReactFlow** | Vue Flow, JointJS, GoJS |
| State Management | **Zustand** | Redux Toolkit, Pinia (Vue), Jotai |
| WebSocket Client | **Socket.io-client** | Phoenix Channels (phx-socket), native WebSocket |

### Backend (Node.js/TypeScript)

| Category | Recommended | Alternatives |
|----------|-------------|--------------|
| Framework | **NestJS** | Express + custom, Fastify |
| WebSocket | **Socket.io** | ws, uWebSockets.js |
| ORM | **Prisma** | TypeORM, Drizzle, Knex |
| Database | **PostgreSQL** | MySQL, MongoDB |

### Backend (Python)

| Category | Recommended | Alternatives |
|----------|-------------|--------------|
| Framework | **FastAPI** | Django, Flask |
| WebSocket | **python-socketio** | websockets, Starlette WebSockets |
| ORM | **SQLAlchemy** | Tortoise ORM, Django ORM |
| Database | **PostgreSQL** | MySQL, MongoDB |

### Backend (Elixir - Reference Implementation)

| Category | Used |
|----------|------|
| Framework | Phoenix |
| WebSocket | Phoenix Channels + LiveState |
| ORM | Ecto |
| Database | PostgreSQL |

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Set up database with workflows, nodes, edges tables
- [ ] Implement WorkflowService with CRUD operations
- [ ] Create format conversion functions (DB ↔ UI)
- [ ] Set up REST endpoints for initial load

### Phase 2: Frontend Canvas
- [ ] Install and configure canvas library (ReactFlow)
- [ ] Create custom node components for each node type
- [ ] Implement client state store (Zustand)
- [ ] Wire up event handlers (onNodesChange, onConnect, etc.)

### Phase 3: Real-Time Sync
- [ ] Set up WebSocket server (Socket.io)
- [ ] Implement event handlers for all client events
- [ ] Add state broadcasting after each change
- [ ] Implement client connection manager
- [ ] Add optimistic updates with debouncing

### Phase 4: Multi-Tenancy
- [ ] Add tenant fields to database schema
- [ ] Implement tenant context extraction middleware
- [ ] Scope all queries by organization_id
- [ ] Add authorization checks

### Phase 5: Advanced Features
- [ ] Undo/redo support
- [ ] Offline support with change queuing
- [ ] Conflict resolution for concurrent edits
- [ ] Version history and rollback
- [ ] Execution graph builder

---

## Key Implementation Insights

1. **Use separate IDs**: Database uses auto-increment PKs; UI uses string IDs (e.g., `node-1`). Map between them.

2. **Store positions as separate fields**: `position_x` and `position_y` as floats, not a JSON blob. Enables partial updates.

3. **Debounce position changes**: Drag operations fire rapidly. Debounce at 50-100ms to reduce server load.

4. **Eager load relationships**: When fetching edges, always preload source/target nodes to avoid N+1 queries.

5. **Use transactions for batch operations**: Multiple node/edge changes should be atomic.

6. **Cascade deletes carefully**: Deleting a workflow cascades to nodes/edges. Deleting a node cascades to its edges.

7. **Viewport is metadata**: Store viewport (pan/zoom) on the workflow itself, not as a node.

8. **Handle reconnection gracefully**: On reconnect, fetch full state from server to resolve any missed updates.
