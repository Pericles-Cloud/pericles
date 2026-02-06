'use client';

import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

export const NotificationNode = memo(function NotificationNode(props: NodeProps<WorkflowNodeData>) {
  return (
    <BaseNode
      {...props}
      typeName="Notification"
      headerClassName="bg-teal-500"
    />
  );
});
