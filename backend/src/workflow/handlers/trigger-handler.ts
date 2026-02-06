/**
 * Trigger Node Handler
 *
 * Handles workflow trigger nodes. The trigger node is the entry point
 * of workflow execution and initializes the execution context with
 * trigger-specific variables.
 */

import { NodeType } from '@prisma/client';
import type { ExecutionContext, NodeExecutionResult, TriggerNodeData, WorkflowNodeWithData } from '../types';
import { BaseNodeHandler } from './base-handler';

export class TriggerHandler extends BaseNodeHandler {
  protected readonly supportedTypes: NodeType[] = [NodeType.TRIGGER];

  execute(node: WorkflowNodeWithData, context: ExecutionContext): Promise<NodeExecutionResult> {
    this.startExecution(node, context);

    try {
      const data = this.getNodeData(node) as TriggerNodeData;
      const triggerType = data.triggerType || 'manual';

      // Set trigger-related variables in context
      const triggerInfo = {
        triggeredAt: new Date().toISOString(),
        triggerType,
        triggerNodeId: node.id,
        triggerNodeLabel: node.label || 'Trigger',
      };

      // Add trigger configuration to variables
      if (triggerType === 'incident') {
        context.variables.incidentTypes = data.incidentTypes || [];
        context.variables.severityThreshold = data.severityThreshold ?? 0.5;
      } else if (triggerType === 'schedule') {
        context.variables.cronExpression = data.cronExpression;
      } else if (triggerType === 'webhook') {
        context.variables.webhookPath = data.webhookPath;
      }

      // Store trigger info
      context.variables.trigger = triggerInfo;
      context.variables.workflowId = context.workflowId;
      context.variables.executionId = context.executionId;
      context.variables.organizationId = context.organizationId;

      const result: NodeExecutionResult = {
        success: true,
        output: {
          message: `Trigger activated: ${triggerType}`,
          trigger: triggerInfo,
        },
      };

      this.completeExecution(node, context, result);
      return Promise.resolve(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const result: NodeExecutionResult = {
        success: false,
        error: `Trigger execution failed: ${errorMessage}`,
      };
      this.completeExecution(node, context, result);
      return Promise.resolve(result);
    }
  }
}
