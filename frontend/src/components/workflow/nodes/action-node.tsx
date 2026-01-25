'use client';

import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { Play } from 'lucide-react';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

export const ActionNode = memo(function ActionNode(props: NodeProps<WorkflowNodeData>) {
  const actionType = props.data.config?.actionType as string | undefined;

  return (
    <BaseNode
      {...props}
      icon={<Play className="h-4 w-4 text-white" />}
      headerClassName="bg-blue-500"
    >
      {actionType && (
        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
          {actionType}
        </span>
      )}
      {!actionType && (
        <span className="text-gray-400">Click to configure action</span>
      )}
    </BaseNode>
  );
});
