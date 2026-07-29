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
 */
const NODE_COLORS: Record<string, string> = {
  trigger: '#524765', // purple-600
  action: '#6B5D84', // purple-500
  condition: '#423851', // purple-700
  notification: '#5F5A68', // grey-600
  end: '#2A272F', // grey-800
};

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
  // dot grid and minimap mask, then a repaint.
  const canvas = useResolvedDark() ? CANVAS.dark : CANVAS.light;

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
        className="bg-muted"
      >
        <Background gap={15} size={1} color={canvas.dots} />
        <Controls className="!bottom-4 !left-4" />
        <MiniMap
          className="!bottom-4 !right-4"
          // `||`, not `??`: reactflow reports an untyped node as '', which `??`
          // would pass through to the lookup and miss.
          nodeColor={(node) => NODE_COLORS[node.type || 'action'] ?? canvas.connection}
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
