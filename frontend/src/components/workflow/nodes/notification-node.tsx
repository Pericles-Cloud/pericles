'use client';

import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { Bell, Mail, MessageSquare, Phone } from 'lucide-react';
import { BaseNode } from './base-node';
import { WorkflowNodeData } from '@/stores/workflow-store';

const channelIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  slack: MessageSquare,
  sms: Phone,
  default: Bell,
};

export const NotificationNode = memo(function NotificationNode(props: NodeProps<WorkflowNodeData>) {
  const channel = props.data.config?.channel as string | undefined;
  const recipients = props.data.config?.recipients as string[] | undefined;

  const IconComponent = channel ? (channelIcons[channel] || channelIcons.default) : channelIcons.default;

  return (
    <BaseNode
      {...props}
      icon={<IconComponent className="h-4 w-4 text-white" />}
      headerClassName="bg-teal-500"
    >
      <div className="flex flex-col gap-1">
        {channel && (
          <span className="rounded bg-teal-50 px-1.5 py-0.5 text-teal-700 capitalize">
            {channel}
          </span>
        )}
        {recipients && recipients.length > 0 && (
          <span className="text-gray-500 truncate">
            {recipients.length} recipient{recipients.length > 1 ? 's' : ''}
          </span>
        )}
        {!channel && !recipients && (
          <span className="text-gray-400">Click to configure</span>
        )}
      </div>
    </BaseNode>
  );
});
