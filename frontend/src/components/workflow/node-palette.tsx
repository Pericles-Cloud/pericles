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
    color: 'bg-amber-500',
  },
  {
    type: 'ACTION',
    label: 'Action',
    description: 'Execute an operation',
    icon: Play,
    color: 'bg-blue-500',
  },
  {
    type: 'CONDITION',
    label: 'Condition',
    description: 'Branch based on logic',
    icon: GitBranch,
    color: 'bg-purple-500',
  },
  {
    type: 'NOTIFICATION',
    label: 'Notification',
    description: 'Send alerts',
    icon: Bell,
    color: 'bg-teal-500',
  },
  {
    type: 'END',
    label: 'End',
    description: 'Workflow termination',
    icon: CircleStop,
    color: 'bg-gray-700',
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
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Node Types</h3>
        <p className="text-xs text-gray-500">Drag nodes to the canvas</p>
      </div>

      <div className="flex flex-col gap-2">
        {paletteItems.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 cursor-grab active:cursor-grabbing hover:border-gray-300 hover:shadow-sm transition-all"
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-md ${item.color}`}
              >
                <Icon className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-500 truncate">{item.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg bg-gray-50 p-3">
        <h4 className="text-xs font-medium text-gray-700 mb-2">Tips</h4>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>- Drag nodes from here to the canvas</li>
          <li>- Connect nodes by dragging between handles</li>
          <li>- Press Delete to remove selected nodes</li>
          <li>- Condition nodes have Yes/No branches</li>
        </ul>
      </div>
    </div>
  );
}
