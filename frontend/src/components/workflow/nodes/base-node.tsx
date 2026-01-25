'use client';

import { memo, ReactNode } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';
import { WorkflowNodeData } from '@/stores/workflow-store';

interface BaseNodeProps extends NodeProps<WorkflowNodeData> {
  icon: ReactNode;
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
  icon,
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
        'min-w-[180px] rounded-lg border-2 bg-white shadow-md transition-shadow',
        selected ? 'border-blue-500 shadow-lg ring-2 ring-blue-200' : 'border-gray-200',
        className
      )}
    >
      {/* Default target handle */}
      {showTargetHandle && !targetHandles && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-white !bg-gray-400"
        />
      )}

      {/* Custom target handles */}
      {targetHandles?.map((handle) => (
        <Handle
          key={handle.id}
          type="target"
          position={handle.position}
          id={handle.id}
          className={cn('!h-3 !w-3 !border-2 !border-white !bg-gray-400', handle.className)}
        />
      ))}

      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 rounded-t-md px-3 py-2',
          headerClassName
        )}
      >
        <span className="flex-shrink-0">{icon}</span>
        <span className="truncate text-sm font-medium text-white">{data.label}</span>
      </div>

      {/* Content */}
      {children && (
        <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
          {children}
        </div>
      )}

      {/* Default source handle */}
      {showSourceHandle && !sourceHandles && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-2 !border-white !bg-gray-400"
        />
      )}

      {/* Custom source handles */}
      {sourceHandles?.map((handle) => (
        <Handle
          key={handle.id}
          type="source"
          position={handle.position}
          id={handle.id}
          className={cn('!h-3 !w-3 !border-2 !border-white !bg-gray-400', handle.className)}
        />
      ))}
    </div>
  );
});
