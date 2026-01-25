/**
 * Zustand store for workflow builder state management
 *
 * Handles:
 * - ReactFlow nodes and edges state
 * - WebSocket connection for real-time collaboration
 * - Optimistic updates with rollback
 * - Viewport synchronization
 */

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import {
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from 'reactflow';
import {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  NodeType,
  getWorkflow,
  saveWorkflowState,
  getAccessToken,
} from '@/lib/api-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4112';

// Custom node data structure
export interface WorkflowNodeData {
  label: string;
  type: NodeType;
  config?: Record<string, unknown>;
}

// Participant info
export interface Participant {
  userId: string;
  email: string;
  name: string;
}

// Connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Store state interface
interface WorkflowState {
  // Workflow metadata
  workflow: Workflow | null;
  organizationId: string | null;

  // ReactFlow state
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number };

  // WebSocket state
  socket: Socket | null;
  connectionStatus: ConnectionStatus;

  // Collaboration
  participants: Participant[];
  cursors: Map<string, { x: number; y: number }>;

  // Loading states
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  // Actions - Workflow loading
  loadWorkflow: (orgId: string, workflowId: string) => Promise<void>;
  clearWorkflow: () => void;

  // Actions - ReactFlow
  setNodes: (nodes: Node<WorkflowNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  deleteSelectedNodes: () => void;
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;

  // Actions - Save
  saveState: () => Promise<void>;

  // Actions - WebSocket
  initSocket: () => void;
  disconnect: () => void;
  sendCursorPosition: (position: { x: number; y: number }) => void;
}

// Convert API nodes to ReactFlow nodes
function apiNodesToReactFlow(nodes: WorkflowNode[]): Node<WorkflowNodeData>[] {
  return nodes.map((node) => ({
    id: node.clientId,
    type: node.type.toLowerCase(),
    position: node.position,
    data: {
      label: node.label || getDefaultLabel(node.type),
      type: node.type,
      config: node.data as Record<string, unknown>,
    },
  }));
}

// Convert API edges to ReactFlow edges
function apiEdgesToReactFlow(edges: WorkflowEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.clientId,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label || undefined,
    data: edge.data,
  }));
}

// Get default label for node type
function getDefaultLabel(type: NodeType): string {
  const labels: Record<NodeType, string> = {
    TRIGGER: 'Trigger',
    ACTION: 'Action',
    CONDITION: 'Condition',
    NOTIFICATION: 'Notification',
    END: 'End',
  };
  return labels[type];
}

// Generate unique client ID
function generateClientId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Create the store
export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  // Initial state
  workflow: null,
  organizationId: null,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  socket: null,
  connectionStatus: 'disconnected',
  participants: [],
  cursors: new Map(),
  isLoading: false,
  isSaving: false,
  error: null,

  // Load workflow from API
  loadWorkflow: async (orgId: string, workflowId: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await getWorkflow(orgId, workflowId);

      if (!response.success || !response.data) {
        throw new Error(response.error?.message || 'Failed to load workflow');
      }

      const workflow = response.data;

      set({
        workflow,
        organizationId: orgId,
        nodes: workflow.nodes ? apiNodesToReactFlow(workflow.nodes) : [],
        edges: workflow.edges ? apiEdgesToReactFlow(workflow.edges) : [],
        viewport: workflow.viewport || { x: 0, y: 0, zoom: 1 },
        isLoading: false,
      });

      // Initialize WebSocket after loading
      get().initSocket();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load workflow';
      set({ error: message, isLoading: false });
    }
  },

  // Clear workflow state
  clearWorkflow: () => {
    get().disconnect();
    set({
      workflow: null,
      organizationId: null,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      participants: [],
      cursors: new Map(),
      error: null,
    });
  },

  // Set nodes
  setNodes: (nodes) => set({ nodes }),

  // Set edges
  setEdges: (edges) => set({ edges }),

  // Handle node changes (drag, select, etc.)
  onNodesChange: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
    }));
  },

  // Handle edge changes
  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    }));
  },

  // Handle new connections
  onConnect: (connection) => {
    const { socket } = get();

    if (!connection.source || !connection.target) return;

    const edgeId = `edge-${connection.source}-${connection.target}-${Date.now()}`;

    // Optimistic update
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          id: edgeId,
        },
        state.edges
      ),
    }));

    // Send to WebSocket if connected
    if (socket && socket.connected) {
      socket.emit('connect_nodes', {
        clientId: edgeId,
        sourceNodeClientId: connection.source,
        targetNodeClientId: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
    }
  },

  // Add a new node
  addNode: (type, position) => {
    const { socket } = get();
    const clientId = generateClientId();

    const newNode: Node<WorkflowNodeData> = {
      id: clientId,
      type: type.toLowerCase(),
      position,
      data: {
        label: getDefaultLabel(type),
        type,
        config: {},
      },
    };

    // Optimistic update
    set((state) => ({
      nodes: [...state.nodes, newNode],
    }));

    // Send to WebSocket if connected
    if (socket && socket.connected) {
      socket.emit('add_node', {
        clientId,
        type,
        label: newNode.data.label,
        positionX: position.x,
        positionY: position.y,
        data: newNode.data.config,
      });
    }
  },

  // Update node data
  updateNodeData: (nodeId, data) => {
    const { socket } = get();

    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      ),
    }));

    // Send to WebSocket if connected
    if (socket && socket.connected) {
      socket.emit('update_node', {
        clientId: nodeId,
        updates: {
          label: data.label,
          data: data.config,
        },
      });
    }
  },

  // Delete selected nodes
  deleteSelectedNodes: () => {
    const { nodes, socket } = get();
    const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);

    if (selectedIds.length === 0) return;

    // Optimistic update
    set((state) => ({
      nodes: state.nodes.filter((n) => !n.selected),
      edges: state.edges.filter(
        (e) => !selectedIds.includes(e.source) && !selectedIds.includes(e.target)
      ),
    }));

    // Send to WebSocket if connected
    if (socket && socket.connected) {
      socket.emit('delete_nodes', selectedIds);
    }
  },

  // Set viewport
  setViewport: (viewport) => set({ viewport }),

  // Save current state to API
  saveState: async () => {
    const { workflow, organizationId, nodes, edges, viewport } = get();

    if (!workflow || !organizationId) return;

    set({ isSaving: true, error: null });

    try {
      const stateData = {
        nodes: nodes.map((node) => ({
          clientId: node.id,
          type: node.data.type,
          label: node.data.label,
          positionX: node.position.x,
          positionY: node.position.y,
          data: node.data.config || {},
        })),
        edges: edges.map((edge) => ({
          clientId: edge.id,
          sourceNodeClientId: edge.source,
          targetNodeClientId: edge.target,
          sourceHandle: edge.sourceHandle || undefined,
          targetHandle: edge.targetHandle || undefined,
          label: edge.label as string | undefined,
          data: (edge.data as Record<string, unknown>) || {},
        })),
        viewportX: viewport.x,
        viewportY: viewport.y,
        viewportZoom: viewport.zoom,
      };

      const response = await saveWorkflowState(organizationId, workflow.id, stateData);

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to save workflow');
      }

      // Update workflow with new version
      if (response.data) {
        set({ workflow: response.data });
      }

      set({ isSaving: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save workflow';
      set({ error: message, isSaving: false });
    }
  },

  // Initialize WebSocket connection
  initSocket: () => {
    const { workflow, organizationId, socket: existingSocket } = get();

    if (!workflow || !organizationId) return;
    if (existingSocket?.connected) return;

    set({ connectionStatus: 'connecting' });

    const token = getAccessToken();
    if (!token) {
      set({ connectionStatus: 'error', error: 'No authentication token' });
      return;
    }

    const socket = io(WS_URL, {
      path: '/ws/workflow',
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      set({ connectionStatus: 'connected' });

      // Join the workflow room
      socket.emit('join_workflow', {
        workflowId: workflow.id,
        orgId: organizationId,
      });
    });

    socket.on('disconnect', () => {
      set({ connectionStatus: 'disconnected', participants: [] });
    });

    socket.on('connect_error', (error) => {
      console.error('[WS] Connection error:', error);
      set({ connectionStatus: 'error', error: error.message });
    });

    // Room events
    socket.on('room:joined', (data: { participants: Participant[] }) => {
      set({ participants: data.participants });
    });

    socket.on('user:joined', (participant: Participant) => {
      set((state) => ({
        participants: [...state.participants.filter((p) => p.userId !== participant.userId), participant],
      }));
    });

    socket.on('user:left', (data: { userId: string }) => {
      set((state) => ({
        participants: state.participants.filter((p) => p.userId !== data.userId),
        cursors: new Map(Array.from(state.cursors.entries()).filter(([key]) => key !== data.userId)),
      }));
    });

    // State change events from other users
    socket.on('state:node_added', (data: {
      clientId: string;
      type: string;
      label: string | null;
      position: { x: number; y: number };
      data: Record<string, unknown>;
      addedBy: string;
    }) => {
      // Only apply if we don't already have this node
      set((state) => {
        if (state.nodes.some((n) => n.id === data.clientId)) {
          return state;
        }
        return {
          nodes: [
            ...state.nodes,
            {
              id: data.clientId,
              type: data.type.toLowerCase(),
              position: data.position,
              data: {
                label: data.label || getDefaultLabel(data.type.toUpperCase() as NodeType),
                type: data.type.toUpperCase() as NodeType,
                config: data.data,
              },
            },
          ],
        };
      });
    });

    socket.on('state:node_updated', (data: {
      clientId: string;
      label: string | null;
      position: { x: number; y: number };
      data: Record<string, unknown>;
    }) => {
      set((state) => ({
        nodes: state.nodes.map((node) =>
          node.id === data.clientId
            ? {
                ...node,
                position: data.position,
                data: {
                  ...node.data,
                  label: data.label || node.data.label,
                  config: data.data,
                },
              }
            : node
        ),
      }));
    });

    socket.on('state:nodes_deleted', (data: { clientIds: string[] }) => {
      set((state) => ({
        nodes: state.nodes.filter((n) => !data.clientIds.includes(n.id)),
        edges: state.edges.filter(
          (e) => !data.clientIds.includes(e.source) && !data.clientIds.includes(e.target)
        ),
      }));
    });

    socket.on('state:edge_added', (data: {
      clientId: string;
      source: string;
      target: string;
      sourceHandle: string | null;
      targetHandle: string | null;
      label: string | null;
    }) => {
      set((state) => {
        if (state.edges.some((e) => e.id === data.clientId)) {
          return state;
        }
        return {
          edges: [
            ...state.edges,
            {
              id: data.clientId,
              source: data.source,
              target: data.target,
              sourceHandle: data.sourceHandle,
              targetHandle: data.targetHandle,
              label: data.label || undefined,
            },
          ],
        };
      });
    });

    socket.on('state:edge_deleted', (data: { clientId: string }) => {
      set((state) => ({
        edges: state.edges.filter((e) => e.id !== data.clientId),
      }));
    });

    // Cursor updates from other users
    socket.on('cursor:move', (data: { userId: string; position: { x: number; y: number } }) => {
      set((state) => ({
        cursors: new Map(state.cursors).set(data.userId, data.position),
      }));
    });

    // Error handling
    socket.on('error', (data: { message: string }) => {
      console.error('[WS] Error:', data.message);
      set({ error: data.message });
    });

    set({ socket });
  },

  // Disconnect WebSocket
  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null, connectionStatus: 'disconnected', participants: [] });
    }
  },

  // Send cursor position
  sendCursorPosition: (position) => {
    const { socket } = get();
    if (socket?.connected) {
      socket.emit('cursor_move', position);
    }
  },
}));
