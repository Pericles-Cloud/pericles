'use client';

import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { CircleStop } from 'lucide-react';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

export const EndNode = memo(function EndNode(props: NodeProps<WorkflowNodeData>) {
  const status = props.data.config?.status as string | undefined;

  return (
    <BaseNode
      {...props}
      icon={<CircleStop className="h-4 w-4 text-white" />}
      headerClassName="bg-gray-700"
      showSourceHandle={false}
    >
      {status && (
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
          Status: {status}
        </span>
      )}
      {!status && (
        <span className="text-gray-400">Workflow ends here</span>
      )}
    </BaseNode>
  );
});
