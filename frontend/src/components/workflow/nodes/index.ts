import { TriggerNode } from './trigger-node';
import { ActionNode } from './action-node';
import { ConditionNode } from './condition-node';
import { NotificationNode } from './notification-node';
import { EndNode } from './end-node';

export { TriggerNode, ActionNode, ConditionNode, NotificationNode, EndNode };

// Node types mapping for ReactFlow
export const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  notification: NotificationNode,
  end: EndNode,
} as const;
