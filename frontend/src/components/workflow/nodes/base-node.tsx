'use client';

import { memo, ReactNode } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';
import { WorkflowNodeData } from '@/stores/workflow-store';

interface BaseNodeProps extends NodeProps<WorkflowNodeData> {
  typeName: string;
  className?: string;
  headerClassName?: string;
  /** Defaults to light text. The five per-type header colours (#25) span the
   * full ramp for distinguishability, so the two lightest need dark text
   * instead — see the NODE HEADER PALETTE check in contrast-audit.mjs. */
  headerTextClassName?: string;
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
  headerTextClassName = 'text-grey-100',
  showSourceHandle = true,
  showTargetHandle = true,
  sourceHandles,
  targetHandles,
  children,
}: BaseNodeProps) {
  return (
    <div
      className={cn(
        // The node body is 1.03:1 from the canvas in light mode (--card is
        // white, --background is grey-50 — barely distinct, see #31) and
        // 1.21:1 in dark, so the BORDER is the only thing that delineates a
        // node. It must therefore be set on
        // the unselected branch, not in the base string: cn() is tailwind-merge,
        // and any border-colour later in the argument list wins outright — a
        // base `border-muted-foreground/70` here was silently replaced by
        // `border-input` (1.31:1 dark, 1.09:1 light) and never rendered.
        // /80, not /70: /70 measures 3.92:1 on the dark card but only 2.80:1 on
        // the white one, under the 3:1 non-text floor (WCAG 1.4.11). /80 is
        // 4.13:1 light and 4.69:1 dark.
        'min-w-[80px] rounded border bg-card shadow-sm transition-shadow overflow-hidden',
        selected
          ? 'border-primary shadow-md ring-2 ring-ring/30'
          : 'border-muted-foreground/80',
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
          'px-2 py-1 text-[10px] font-medium text-center',
          headerTextClassName,
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
