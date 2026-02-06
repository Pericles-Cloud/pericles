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
      headerClassName="bg-gray-700"
      showSourceHandle={false}
    />
  );
});
