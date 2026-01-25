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

import { useWorkflowStore } from '@/stores/workflow-store';
import { nodeTypes } from './nodes';
import { NodeType } from '@/lib/api-client';

interface WorkflowCanvasProps {
  onNodeSelect?: (nodeId: string | null) => void;
}

function WorkflowCanvasInner({ onNodeSelect }: WorkflowCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { setViewport, project } = useReactFlow();
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

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
        return 'bg-green-500';
      case 'connecting':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
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
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-md">
        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className="text-xs font-medium text-gray-600 capitalize">
          {connectionStatus}
        </span>
        {participants.length > 0 && (
          <span className="ml-2 text-xs text-gray-500">
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
        connectionLineStyle={{ stroke: '#6b7280', strokeWidth: 2 }}
        snapToGrid
        snapGrid={[15, 15]}
        deleteKeyCode={['Backspace', 'Delete']}
        className="bg-gray-50"
      >
        <Background gap={15} size={1} color="#e5e7eb" />
        <Controls className="!bottom-4 !left-4" />
        <MiniMap
          className="!bottom-4 !right-4"
          nodeColor={(node) => {
            const typeColors: Record<string, string> = {
              trigger: '#f59e0b',
              action: '#3b82f6',
              condition: '#a855f7',
              notification: '#14b8a6',
              end: '#374151',
            };
            return typeColors[node.type || 'action'] || '#6b7280';
          }}
          maskColor="rgba(0,0,0,0.1)"
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
