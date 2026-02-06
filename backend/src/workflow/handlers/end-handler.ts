/**
 * End Node Handler
 *
 * Handles workflow end nodes. The end node marks the completion
 * of a workflow execution path and logs the final status.
 */

import { NodeType } from '@prisma/client';
import type { ExecutionContext, NodeExecutionResult, EndNodeData, WorkflowNodeWithData } from '../types';
import { BaseNodeHandler } from './base-handler';

export class EndHandler extends BaseNodeHandler {
  protected readonly supportedTypes: NodeType[] = [NodeType.END];

  execute(node: WorkflowNodeWithData, context: ExecutionContext): Promise<NodeExecutionResult> {
    this.startExecution(node, context);

    try {
      const data = this.getNodeData(node) as EndNodeData;

      // Determine final status
      const status = data.status || 'success';
      const summary = data.summary || this.generateSummary(context);

      // Collect execution statistics
      const stats = this.collectExecutionStats(context);

      const output = {
        message: `Workflow execution ${status}`,
        finalStatus: status,
        summary,
        endNodeId: node.id,
        endNodeLabel: node.label || 'End',
        completedAt: new Date().toISOString(),
        statistics: stats,
      };

      // Store final result in variables
      context.variables.workflowResult = output;
      context.variables.workflowStatus = status;

      const result: NodeExecutionResult = {
        success: status !== 'failure',
        output,
      };

      this.completeExecution(node, context, result);
      return Promise.resolve(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorResult: NodeExecutionResult = {
        success: false,
        error: `End node execution failed: ${errorMessage}`,
      };
      this.completeExecution(node, context, errorResult);
      return Promise.resolve(errorResult);
    }
  }

  /**
   * Generate a default summary based on execution context
   */
  private generateSummary(context: ExecutionContext): string {
    const stats = this.collectExecutionStats(context);

    const parts: string[] = [
      `Workflow execution ${context.mode === 'trial' ? '(trial run)' : ''} completed.`,
    ];

    if (stats.totalNodes > 0) {
      parts.push(`${stats.completedNodes}/${stats.totalNodes} nodes executed.`);
    }

    if (stats.failedNodes > 0) {
      parts.push(`${stats.failedNodes} node(s) failed.`);
    }

    if (stats.skippedNodes > 0) {
      parts.push(`${stats.skippedNodes} node(s) skipped.`);
    }

    if (stats.simulatedNodes > 0) {
      parts.push(`${stats.simulatedNodes} node(s) simulated.`);
    }

    return parts.join(' ');
  }

  /**
   * Collect statistics from execution logs
   */
  private collectExecutionStats(context: ExecutionContext): {
    totalNodes: number;
    completedNodes: number;
    failedNodes: number;
    skippedNodes: number;
    simulatedNodes: number;
    totalDurationMs: number;
  } {
    const logs = context.logs;

    let completedNodes = 0;
    let failedNodes = 0;
    let skippedNodes = 0;
    let simulatedNodes = 0;
    let totalDurationMs = 0;

    for (const log of logs) {
      switch (log.status) {
        case 'completed':
          completedNodes++;
          break;
        case 'failed':
          failedNodes++;
          break;
        case 'skipped':
          skippedNodes++;
          break;
      }

      if (log.simulated) {
        simulatedNodes++;
      }

      if (log.durationMs) {
        totalDurationMs += log.durationMs;
      }
    }

    return {
      totalNodes: logs.length,
      completedNodes,
      failedNodes,
      skippedNodes,
      simulatedNodes,
      totalDurationMs,
    };
  }
}
