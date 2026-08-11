'use client';

import { useCallback, useRef, useEffect, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  Connection,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useResolvedDark } from '@/lib/use-resolved-dark';
import { useWorkflowStore } from '@/stores/workflow-store';
import { nodeTypes } from './nodes';
import { NodeType } from '@/lib/api-client';

/**
 * reactflow takes literal colours, not CSS custom properties, so these mirror
 * the ramps in globals.css — the same reason atlas-brand.ts exists. They MUST
 * track the node header classes in ./nodes/*; a mismatch means the minimap
 * shows a different legend from the canvas.
 *
 * Mode-aware, like CANVAS below: a single fixed hex-per-type can't clear a
 * legible 3:1 against the node card in BOTH modes, since the card itself
 * flips between white (light) and purple-800 (dark) — near-opposite ends of
 * the ramp. An earlier version tried one shared palette and passed review on
 * pairwise distinguishability alone; a second review pass caught that the
 * lightest pick (purple-50) measured 1.08:1 against the white card in light
 * mode — visually not a coloured header at all (#25).
 *
 * Each mode's five colours are chosen independently by exhaustive search over
 * the purple+grey ramps for the best achievable MINIMUM pairwise contrast,
 * subject to every colour clearing BOTH 4.5:1 against its header text
 * (grey-100 or purple-900 — see headerTextClassName in ./nodes/base-node.tsx)
 * AND 3:1 against its own mode's card. Light: 1.28:1 minimum pairwise.
 * Dark: 1.16:1 minimum pairwise — lower, because the card-contrast
 * requirement leaves only 9 ramp steps eligible in dark mode vs. 10 in
 * light. base-node.tsx's header now also carries a black/white overlay
 * border as a second, fill-colour-independent way to read as a distinct
 * region, since neither figure is a wide margin on its own.
 *
 * See the NODE HEADER PALETTE check in contrast-audit.mjs, which re-derives
 * and asserts both searches (including the card-contrast floor this file's
 * history shows is easy to forget) so the two can't drift apart silently.
 */
const NODE_COLORS = {
  light: {
    trigger: '#6B5D84', // purple-500
    action: '#524765', // purple-600
    condition: '#423851', // purple-700
    notification: '#2E273A', // purple-800
    end: '#0F0D11', // grey-950
  },
  dark: {
    trigger: '#FBFBFC', // grey-50
    action: '#ECE9F1', // purple-100
    condition: '#D7D1E0', // purple-200
    notification: '#B4AAC5', // purple-300
    end: '#A4A0AB', // grey-400
  },
} as const satisfies Record<'light' | 'dark', Record<string, string>>;

const CANVAS = {
  light: { dots: '#E8E6EA', connection: '#A4A0AB', mask: 'rgba(25,23,28,0.10)' },
  dark: { dots: '#2A272F', connection: '#5F5A68', mask: 'rgba(0,0,0,0.35)' },
} as const;

interface WorkflowCanvasProps {
  onNodeSelect?: (nodeId: string | null) => void;
}

function WorkflowCanvasInner({ onNodeSelect }: WorkflowCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { setViewport, project } = useReactFlow();
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  // Correct on the first paint: a dark-mode user would otherwise get the light
  // dot grid, minimap mask, and node-header legend, then a repaint.
  const isDark = useResolvedDark();
  const canvas = isDark ? CANVAS.dark : CANVAS.light;
  const nodeColors = isDark ? NODE_COLORS.dark : NODE_COLORS.light;

  const {
    nodes,
    edges,
    viewport,
    connectionStatus,
    participants,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setViewport: storeSetViewport,
    sendCursorPosition,
  } = useWorkflowStore();

  // Connection status indicator color
  const statusColor = useMemo(() => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-risk-low-accent';
      case 'connecting':
        return 'bg-risk-elevated-accent';
      case 'error':
        return 'bg-risk-critical-accent';
      default:
        return 'bg-muted-foreground';
    }
  }, [connectionStatus]);

  // Handle connection validation
  const isValidConnection = useCallback((connection: Connection) => {
    // Prevent self-connections
    if (connection.source === connection.target) return false;

    // Prevent duplicate connections
    const existingEdge = edges.find(
      (e) =>
        e.source === connection.source &&
        e.target === connection.target &&
        e.sourceHandle === connection.sourceHandle &&
        e.targetHandle === connection.targetHandle
    );
    if (existingEdge) return false;

    return true;
  }, [edges]);

  // Handle drop from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow') as NodeType;
      if (!type || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      addNode(type, position);
    },
    [project, addNode]
  );

  // Track cursor for collaboration
  const onMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!reactFlowWrapper.current || connectionStatus !== 'connected') return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      sendCursorPosition(position);
    },
    [project, sendCursorPosition, connectionStatus]
  );

  // Handle viewport changes
  const onMoveEnd = useCallback(
    (_: unknown, viewport: { x: number; y: number; zoom: number }) => {
      storeSetViewport(viewport);
    },
    [storeSetViewport]
  );

  // Handle node selection
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Array<{ id: string }> }) => {
      if (selectedNodes.length === 1) {
        onNodeSelect?.(selectedNodes[0].id);
      } else {
        onNodeSelect?.(null);
      }
    },
    [onNodeSelect]
  );

  // Set initial viewport
  useEffect(() => {
    if (viewport && reactFlowInstance.current) {
      setViewport(viewport, { duration: 0 });
    }
  }, [viewport, setViewport]);

  return (
    <div ref={reactFlowWrapper} className="h-full w-full relative">
      {/* Connection status badge */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 rounded-full bg-card px-3 py-1 shadow-md">
        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className="text-xs font-medium text-muted-foreground capitalize">
          {connectionStatus}
        </span>
        {participants.length > 0 && (
          <span className="ml-2 text-xs text-muted-foreground">
            {participants.length} online
          </span>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => {
          reactFlowInstance.current = instance;
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onMouseMove={onMouseMove}
        onMoveEnd={onMoveEnd}
        onSelectionChange={onSelectionChange}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
        }}
        connectionLineStyle={{ stroke: canvas.connection, strokeWidth: 2 }}
        snapToGrid
        snapGrid={[15, 15]}
        deleteKeyCode={['Backspace', 'Delete']}
        // bg-background, NOT bg-muted: dark --muted is purple-700, the same
        // step several node colours use — the Condition node was 1.00:1
        // against its own canvas.
        className="bg-background"
      >
        <Background gap={15} size={1} color={canvas.dots} />
        <Controls className="!bottom-4 !left-4" />
        <MiniMap
          className="!bottom-4 !right-4"
          // `||`, not `??`: reactflow reports an untyped node as '', which `??`
          // would pass through to the lookup and miss.
          nodeColor={(node) => nodeColors[(node.type || 'action') as keyof typeof nodeColors] ?? canvas.connection}
          maskColor={canvas.mask}
        />
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
