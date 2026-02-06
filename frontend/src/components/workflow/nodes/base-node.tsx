'use client';

import { memo, ReactNode } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';
import { WorkflowNodeData } from '@/stores/workflow-store';

interface BaseNodeProps extends NodeProps<WorkflowNodeData> {
  typeName: string;
  className?: string;
  headerClassName?: string;
  showSourceHandle?: boolean;
  showTargetHandle?: boolean;
  sourceHandles?: Array<{ id: string; position: Position; label?: string; className?: string }>;
  targetHandles?: Array<{ id: string; position: Position; label?: string; className?: string }>;
  children?: ReactNode;
}

export const BaseNode = memo(function BaseNode({
  data,
  selected,
  typeName,
  className,
  headerClassName,
  showSourceHandle = true,
  showTargetHandle = true,
  sourceHandles,
  targetHandles,
  children,
}: BaseNodeProps) {
  return (
    <div
      className={cn(
        'min-w-[80px] rounded border bg-white shadow-sm transition-shadow overflow-hidden',
        selected ? 'border-blue-500 shadow-md ring-2 ring-blue-200' : 'border-gray-300',
        className
      )}
    >
      {/* Default target handle - centered */}
      {showTargetHandle && !targetHandles && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !border !border-white !bg-gray-400 !top-1/2 !-translate-y-1/2"
        />
      )}

      {/* Custom target handles */}
      {targetHandles?.map((handle) => (
        <Handle
          key={handle.id}
          type="target"
          position={handle.position}
          id={handle.id}
          className={cn('!h-2 !w-2 !border !border-white !bg-gray-400', handle.className)}
        />
      ))}

      {/* Header with type name */}
      <div
        className={cn(
          'px-2 py-1 text-[10px] font-medium text-white text-center',
          headerClassName
        )}
      >
        {typeName}
      </div>

      {/* Body with label */}
      <div className="px-3 py-2 text-xs text-gray-800 text-center font-medium">
        {data.label}
      </div>

      {/* Additional content */}
      {children && (
        <div className="border-t border-gray-100 px-2 py-1 text-[10px] text-gray-600">
          {children}
        </div>
      )}

      {/* Default source handle - centered */}
      {showSourceHandle && !sourceHandles && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-2 !w-2 !border !border-white !bg-gray-400 !top-1/2 !-translate-y-1/2"
        />
      )}

      {/* Custom source handles */}
      {sourceHandles?.map((handle) => (
        <Handle
          key={handle.id}
          type="source"
          position={handle.position}
          id={handle.id}
          className={cn('!h-2 !w-2 !border !border-white !bg-gray-400', handle.className)}
        />
      ))}
    </div>
  );
});
