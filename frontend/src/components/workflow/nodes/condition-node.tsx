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
      headerClassName="bg-purple-700 dark:bg-purple-200"
      headerTextClassName="text-grey-100 dark:text-purple-900"
      showSourceHandle={false}
      sourceHandles={[
        {
          id: 'yes',
          position: Position.Right,
          className: '!bg-risk-low-accent !top-1/3',
        },
        {
          id: 'no',
          position: Position.Right,
          className: '!bg-risk-critical-accent !top-2/3',
        },
      ]}
    >
      <div className="flex justify-between text-[10px]">
        <span className="text-risk-low-text">Yes</span>
        <span className="text-risk-critical-text">No</span>
      </div>
    </BaseNode>
  );
});
