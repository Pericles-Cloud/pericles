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
        'min-w-[80px] rounded border bg-card shadow-sm transition-shadow overflow-hidden',
        selected ? 'border-primary shadow-md ring-2 ring-ring/30' : 'border-input',
        className
      )}
    >
      {/* Default target handle - centered */}
      {showTargetHandle && !targetHandles && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !border !border-card !bg-muted-foreground !top-1/2 !-translate-y-1/2"
        />
      )}

      {/* Custom target handles */}
      {targetHandles?.map((handle) => (
        <Handle
          key={handle.id}
          type="target"
          position={handle.position}
          id={handle.id}
          className={cn('!h-2 !w-2 !border !border-card !bg-muted-foreground', handle.className)}
        />
      ))}

      {/* Header with type name */}
      <div
        className={cn(
          'px-2 py-1 text-[10px] font-medium text-grey-100 text-center',
          headerClassName
        )}
      >
        {typeName}
      </div>

      {/* Body with label */}
      <div className="px-3 py-2 text-xs text-foreground text-center font-medium">
        {data.label}
      </div>

      {/* Additional content */}
      {children && (
        <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
          {children}
        </div>
      )}

      {/* Default source handle - centered */}
      {showSourceHandle && !sourceHandles && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-2 !w-2 !border !border-card !bg-muted-foreground !top-1/2 !-translate-y-1/2"
        />
      )}

      {/* Custom source handles */}
      {sourceHandles?.map((handle) => (
        <Handle
          key={handle.id}
          type="source"
          position={handle.position}
          id={handle.id}
          className={cn('!h-2 !w-2 !border !border-card !bg-muted-foreground', handle.className)}
        />
      ))}
    </div>
  );
});
