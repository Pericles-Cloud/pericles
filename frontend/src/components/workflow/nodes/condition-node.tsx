'use client';

import { memo } from 'react';
import { NodeProps, Position } from 'reactflow';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

export const ConditionNode = memo(function ConditionNode(props: NodeProps<WorkflowNodeData>) {
  return (
    <BaseNode
      {...props}
      typeName="Condition"
      headerClassName="bg-purple-500"
      showSourceHandle={false}
      sourceHandles={[
        {
          id: 'yes',
          position: Position.Right,
          className: '!bg-green-500 !top-1/3',
        },
        {
          id: 'no',
          position: Position.Right,
          className: '!bg-red-500 !top-2/3',
        },
      ]}
    >
      <div className="flex justify-between text-[10px]">
        <span className="text-green-600">Yes</span>
        <span className="text-red-600">No</span>
      </div>
    </BaseNode>
  );
});
