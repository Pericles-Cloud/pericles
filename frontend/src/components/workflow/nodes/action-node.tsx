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
      headerClassName="bg-purple-300"
      headerTextClassName="text-purple-900"
    />
  );
});
