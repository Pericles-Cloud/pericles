'use client';

import { memo } from 'react';
import { NodeProps, Position } from 'reactflow';
import { GitBranch } from 'lucide-react';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

export const ConditionNode = memo(function ConditionNode(props: NodeProps<WorkflowNodeData>) {
  const conditionExpression = props.data.config?.expression as string | undefined;

  return (
    <BaseNode
      {...props}
      icon={<GitBranch className="h-4 w-4 text-white" />}
      headerClassName="bg-purple-500"
      showSourceHandle={false}
      sourceHandles={[
        {
          id: 'yes',
          position: Position.Bottom,
          className: '!bg-green-500 !-left-2',
        },
        {
          id: 'no',
          position: Position.Bottom,
          className: '!bg-red-500 !-right-2 !left-auto',
        },
      ]}
    >
      <div className="flex flex-col gap-1">
        {conditionExpression ? (
          <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700 font-mono text-[10px]">
            {conditionExpression}
          </span>
        ) : (
          <span className="text-gray-400">Click to set condition</span>
        )}
        <div className="flex justify-between text-[10px] mt-1">
          <span className="text-green-600">Yes</span>
          <span className="text-red-600">No</span>
        </div>
      </div>
    </BaseNode>
  );
});
