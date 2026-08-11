'use client';

import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

export const ActionNode = memo(function ActionNode(props: NodeProps<WorkflowNodeData>) {
  return (
    <BaseNode
      {...props}
      typeName="Action"
      headerClassName="bg-purple-600 dark:bg-purple-100"
      headerTextClassName="text-grey-100 dark:text-purple-900"
    />
  );
});
