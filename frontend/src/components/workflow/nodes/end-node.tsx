'use client';

import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

export const EndNode = memo(function EndNode(props: NodeProps<WorkflowNodeData>) {
  return (
    <BaseNode
      {...props}
      typeName="End"
      headerClassName="bg-grey-950 dark:bg-grey-400"
      headerTextClassName="text-grey-100 dark:text-purple-900"
      showSourceHandle={false}
    />
  );
});
