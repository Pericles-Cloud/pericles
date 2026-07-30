'use client';

import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

export const TriggerNode = memo(function TriggerNode(props: NodeProps<WorkflowNodeData>) {
  return (
    <BaseNode
      {...props}
      typeName="Trigger"
      headerClassName="bg-purple-600"
      showTargetHandle={false}
    />
  );
});
