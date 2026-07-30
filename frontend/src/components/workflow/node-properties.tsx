'use client';

import { useMemo } from 'react';
import { Zap, Play, GitBranch, Bell, CircleStop } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useWorkflowStore } from '@/stores/workflow-store';
import { NodeType } from '@/lib/api-client';

interface NodePropertiesProps {
  selectedNodeId: string | null;
}

// NOTE: all four non-END icons are `text-primary` — the node-type colour
// coding is uniform here, unlike the palette swatches and node headers. The
// selected type is still named in text beside the icon. Unifying the three
// legs needs the per-mode palette tracked in #25; see that issue before
// changing these.
const nodeTypeConfig: Record<NodeType, {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'select' | 'textarea' | 'list';
    options?: Array<{ value: string; label: string }>;
    placeholder?: string;
  }>;
}> = {
  TRIGGER: {
    icon: Zap,
    color: 'text-primary',
    fields: [
      {
        key: 'triggerType',
        label: 'Trigger Type',
        type: 'select',
        options: [
          { value: 'incident', label: 'Incident Created' },
          { value: 'event', label: 'Event Detected' },
          { value: 'schedule', label: 'Scheduled' },
          { value: 'manual', label: 'Manual Trigger' },
          { value: 'webhook', label: 'Webhook' },
        ],
      },
      {
        key: 'conditions',
        label: 'Filter Conditions',
        type: 'textarea',
        placeholder: 'e.g., severity >= 0.7',
      },
    ],
  },
  ACTION: {
    icon: Play,
    color: 'text-primary',
    fields: [
      {
        key: 'actionType',
        label: 'Action Type',
        type: 'select',
        options: [
          { value: 'update_incident', label: 'Update Incident' },
          { value: 'create_task', label: 'Create Task' },
          { value: 'call_agent', label: 'Call Monitoring Agent' },
          { value: 'webhook', label: 'Call Webhook' },
          { value: 'log', label: 'Log Message' },
        ],
      },
      {
        key: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Describe what this action does...',
      },
    ],
  },
  CONDITION: {
    icon: GitBranch,
    color: 'text-primary',
    fields: [
      {
        key: 'expression',
        label: 'Condition Expression',
        type: 'text',
        placeholder: 'e.g., incident.severity >= 0.8',
      },
      {
        key: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Describe this condition...',
      },
    ],
  },
  NOTIFICATION: {
    icon: Bell,
    color: 'text-primary',
    fields: [
      {
        key: 'channel',
        label: 'Channel',
        type: 'select',
        options: [
          { value: 'email', label: 'Email' },
          { value: 'slack', label: 'Slack' },
          { value: 'sms', label: 'SMS' },
          { value: 'push', label: 'Push Notification' },
        ],
      },
      {
        key: 'template',
        label: 'Message Template',
        type: 'textarea',
        placeholder: 'Enter notification message...',
      },
    ],
  },
  END: {
    icon: CircleStop,
    color: 'text-muted-foreground',
    fields: [
      {
        key: 'status',
        label: 'End Status',
        type: 'select',
        options: [
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' },
          { value: 'failed', label: 'Failed' },
        ],
      },
      {
        key: 'summary',
        label: 'Summary',
        type: 'textarea',
        placeholder: 'End state summary...',
      },
    ],
  },
};

export function NodeProperties({ selectedNodeId }: NodePropertiesProps) {
  const { nodes, updateNodeData, deleteSelectedNodes } = useWorkflowStore();

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId);
  }, [nodes, selectedNodeId]);

  if (!selectedNode) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center">
        <div className="text-muted-foreground">
          <p className="text-sm font-medium">No node selected</p>
          <p className="text-xs mt-1">Click a node to edit its properties</p>
        </div>
      </div>
    );
  }

  const nodeType = selectedNode.data.type;
  const config = nodeTypeConfig[nodeType];
  const Icon = config.icon;

  const handleLabelChange = (value: string) => {
    updateNodeData(selectedNode.id, { label: value });
  };

  const handleConfigChange = (key: string, value: unknown) => {
    updateNodeData(selectedNode.id, {
      config: {
        ...(selectedNode.data.config || {}),
        [key]: value,
      },
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border p-4">
        <Icon className={`h-5 w-5 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{nodeType}</p>
          <p className="text-xs text-muted-foreground truncate">{selectedNode.id}</p>
        </div>
      </div>

      {/* Properties form */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {/* Label field - always present */}
          <div>
            <Label htmlFor="node-label" className="text-xs">
              Label
            </Label>
            <Input
              id="node-label"
              value={selectedNode.data.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              className="mt-1"
              placeholder="Node label..."
            />
          </div>

          {/* Type-specific fields */}
          {config.fields.map((field) => {
            const value = (selectedNode.data.config as Record<string, unknown>)?.[field.key] ?? '';

            return (
              <div key={field.key}>
                <Label htmlFor={`node-${field.key}`} className="text-xs">
                  {field.label}
                </Label>

                {field.type === 'select' && (
                  <select
                    id={`node-${field.key}`}
                    value={value as string}
                    onChange={(e) => handleConfigChange(field.key, e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Select...</option>
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                {field.type === 'text' && (
                  <Input
                    id={`node-${field.key}`}
                    value={value as string}
                    onChange={(e) => handleConfigChange(field.key, e.target.value)}
                    className="mt-1"
                    placeholder={field.placeholder}
                  />
                )}

                {field.type === 'textarea' && (
                  <textarea
                    id={`node-${field.key}`}
                    value={value as string}
                    onChange={(e) => handleConfigChange(field.key, e.target.value)}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={3}
                    placeholder={field.placeholder}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer actions */}
      <div className="border-t border-border p-4">
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={deleteSelectedNodes}
        >
          Delete Node
        </Button>
      </div>
    </div>
  );
}
