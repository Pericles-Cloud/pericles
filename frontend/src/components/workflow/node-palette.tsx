'use client';

import { DragEvent } from 'react';
import { Zap, Play, GitBranch, Bell, CircleStop } from 'lucide-react';
import { NodeType } from '@/lib/api-client';

interface NodePaletteItem {
  type: NodeType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const paletteItems: NodePaletteItem[] = [
  {
    type: 'TRIGGER',
    label: 'Trigger',
    description: 'Starts the workflow',
    icon: Zap,
    color: 'bg-purple-600',
  },
  {
    type: 'ACTION',
    label: 'Action',
    description: 'Execute an operation',
    icon: Play,
    color: 'bg-purple-500',
  },
  {
    type: 'CONDITION',
    label: 'Condition',
    description: 'Branch based on logic',
    icon: GitBranch,
    color: 'bg-purple-700',
  },
  {
    type: 'NOTIFICATION',
    label: 'Notification',
    description: 'Send alerts',
    icon: Bell,
    color: 'bg-grey-600',
  },
  {
    type: 'END',
    label: 'End',
    description: 'Workflow termination',
    icon: CircleStop,
    color: 'bg-grey-800',
  },
];

export function NodePalette() {
  const onDragStart = (event: DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Node Types</h3>
        <p className="text-xs text-muted-foreground">Drag nodes to the canvas</p>
      </div>

      <div className="flex flex-col gap-2">
        {paletteItems.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              // hover:border-ring, not hover:border-input — `--input` and
              // `--border` are the same value in both modes, so hovering to
              // `input` changed nothing at all.
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 cursor-grab active:cursor-grabbing hover:border-ring hover:shadow-sm transition-all"
            >
              <div
                // ring, because item.color is a ramp step that can land within
                // ~1.3:1 of whatever surface is behind it — the Condition
                // swatch was exactly --muted in dark mode and vanished.
                className={`flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-muted-foreground/40 ${item.color}`}
              >
                <Icon className="h-4 w-4 text-grey-100" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground truncate">{item.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg bg-muted p-3">
        <h4 className="text-xs font-medium text-muted-foreground mb-2">Tips</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>- Drag nodes from here to the canvas</li>
          <li>- Connect nodes by dragging between handles</li>
          <li>- Press Delete to remove selected nodes</li>
          <li>- Condition nodes have Yes/No branches</li>
        </ul>
      </div>
    </div>
  );
}
