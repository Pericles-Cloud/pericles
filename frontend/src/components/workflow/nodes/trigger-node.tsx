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
      headerClassName="bg-purple-500 dark:bg-grey-50"
      headerTextClassName="text-grey-100 dark:text-purple-900"
      showTargetHandle={false}
    />
  );
});
