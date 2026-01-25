'use client';

import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { Zap } from 'lucide-react';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

export const TriggerNode = memo(function TriggerNode(props: NodeProps<WorkflowNodeData>) {
  const triggerType = props.data.config?.triggerType as string | undefined;

  return (
    <BaseNode
      {...props}
      icon={<Zap className="h-4 w-4 text-white" />}
      headerClassName="bg-amber-500"
      showTargetHandle={false}
    >
      {triggerType && (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
          {triggerType}
        </span>
      )}
      {!triggerType && (
        <span className="text-gray-400">Click to configure trigger</span>
      )}
    </BaseNode>
  );
});
