/**
 * Workflow Engine
 *
 * BFS graph traversal engine that executes workflows from Trigger nodes to End nodes.
 * Handles condition branching (yes/no edges) and manages execution context.
 */

import type { WorkflowEdge } from '@prisma/client';
import type { ExecutionContext, NodeExecutionResult, WorkflowForExecution, WorkflowNodeWithData } from './types';
import { getHandler, hasHandler } from './handlers';

/**
 * Workflow Engine class
 * Traverses workflow graph using BFS and executes each node
 */
export class WorkflowEngine {
  /**
   * Execute a workflow from start to finish
   *
   * @param workflow - The workflow to execute (with nodes and edges)
   * @param context - The execution context
   * @returns Updated execution context with logs
   */
  async execute(workflow: WorkflowForExecution, context: ExecutionContext): Promise<ExecutionContext> {
    // Build node and edge lookup maps
    const nodeMap = new Map<string, WorkflowNodeWithData>();
    const nodeByClientId = new Map<string, WorkflowNodeWithData>();

    for (const node of workflow.nodes) {
      nodeMap.set(node.id, node);
      nodeByClientId.set(node.client_id, node);
    }

    // Build edge lookup: source_node_id -> edges (with optional handle filtering)
    const outgoingEdges = new Map<string, WorkflowEdge[]>();
    for (const edge of workflow.edges) {
      const existing = outgoingEdges.get(edge.source_node_id) || [];
      existing.push(edge);
      outgoingEdges.set(edge.source_node_id, existing);
    }

    // Find all trigger nodes (entry points)
    const triggerNodes = workflow.nodes.filter((node) => node.type === 'TRIGGER');

    if (triggerNodes.length === 0) {
      throw new Error('Workflow has no trigger node');
    }

    // BFS queue: stores node IDs to process
    const queue: string[] = triggerNodes.map((n) => n.id);
    const visited = new Set<string>();
    const executed = new Set<string>();

    // Process nodes in BFS order
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (!nodeId) continue;

      // Skip if already executed
      if (executed.has(nodeId)) {
        continue;
      }

      const node = nodeMap.get(nodeId);
      if (!node) {
        console.warn(`Node ${nodeId} not found in workflow`);
        continue;
      }

      // Check if all incoming edges have been satisfied (for non-trigger nodes)
      if (node.type !== 'TRIGGER') {
        const incomingEdges = workflow.edges.filter((e) => e.target_node_id === nodeId);
        const allPredecessorsExecuted = incomingEdges.every((edge) => executed.has(edge.source_node_id));

        if (!allPredecessorsExecuted) {
          // Re-queue this node for later processing
          if (!visited.has(nodeId)) {
            queue.push(nodeId);
            visited.add(nodeId);
          }
          continue;
        }
      }

      // Execute the node
      const result = await this.executeNode(node, context);
      executed.add(nodeId);

      // Determine next nodes based on execution result and edges
      const nextNodeIds = this.getNextNodes(node, result, outgoingEdges, nodeMap);

      // Add next nodes to queue
      for (const nextId of nextNodeIds) {
        if (!executed.has(nextId)) {
          queue.push(nextId);
        }
      }
    }

    return context;
  }

  /**
   * Execute a single node
   */
  private async executeNode(
    node: WorkflowNodeWithData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    const nodeType = node.type;

    // Get handler for this node type
    const handler = getHandler(nodeType);
    if (!handler) {
      const errorResult: NodeExecutionResult = {
        success: false,
        error: `No handler found for node type: ${nodeType}`,
      };

      // Log the error
      context.logs.push({
        nodeId: node.id,
        nodeClientId: node.client_id,
        nodeType: node.type,
        nodeLabel: node.label || `${node.type} Node`,
        status: 'failed',
        error: errorResult.error,
        completedAt: new Date().toISOString(),
      });

      return errorResult;
    }

    try {
      return await handler.execute(node, context);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorResult: NodeExecutionResult = {
        success: false,
        error: errorMessage,
      };

      // Update log with error
      const existingLog = context.logs.find((log) => log.nodeId === node.id);
      if (existingLog) {
        existingLog.status = 'failed';
        existingLog.error = errorMessage;
        existingLog.completedAt = new Date().toISOString();
      } else {
        context.logs.push({
          nodeId: node.id,
          nodeClientId: node.client_id,
          nodeType: node.type,
          nodeLabel: node.label || `${node.type} Node`,
          status: 'failed',
          error: errorMessage,
          completedAt: new Date().toISOString(),
        });
      }

      return errorResult;
    }
  }

  /**
   * Get next nodes to process based on execution result and edges
   */
  private getNextNodes(
    node: WorkflowNodeWithData,
    result: NodeExecutionResult,
    outgoingEdges: Map<string, WorkflowEdge[]>,
    nodeMap: Map<string, WorkflowNodeWithData>
  ): string[] {
    const edges = outgoingEdges.get(node.id) || [];

    if (edges.length === 0) {
      return [];
    }

    // For condition nodes, filter by source_handle (yes/no)
    if (node.type === 'CONDITION' && result.nextEdges && result.nextEdges.length > 0) {
      const allowedHandles = result.nextEdges;

      const filteredEdges = edges.filter((edge) => {
        // Match edge by source_handle
        const handle = edge.source_handle?.toLowerCase();
        return allowedHandles.some((allowed) => allowed.toLowerCase() === handle);
      });

      return filteredEdges
        .map((e) => e.target_node_id)
        .filter((id) => nodeMap.has(id));
    }

    // For other nodes, follow all outgoing edges
    return edges.map((e) => e.target_node_id).filter((id) => nodeMap.has(id));
  }

  /**
   * Validate workflow structure before execution
   */
  validateWorkflow(workflow: WorkflowForExecution): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for trigger nodes
    const triggerNodes = workflow.nodes.filter((n) => n.type === 'TRIGGER');
    if (triggerNodes.length === 0) {
      errors.push('Workflow must have at least one Trigger node');
    }

    // Check for end nodes
    const endNodes = workflow.nodes.filter((n) => n.type === 'END');
    if (endNodes.length === 0) {
      errors.push('Workflow must have at least one End node');
    }

    // Check for orphan nodes (no incoming or outgoing edges, except triggers and ends)
    for (const node of workflow.nodes) {
      const hasIncoming = workflow.edges.some((e) => e.target_node_id === node.id);
      const hasOutgoing = workflow.edges.some((e) => e.source_node_id === node.id);

      if (node.type === 'TRIGGER' && !hasOutgoing) {
        errors.push(`Trigger node "${node.label || node.id}" has no outgoing edges`);
      }

      if (node.type === 'END' && !hasIncoming) {
        errors.push(`End node "${node.label || node.id}" has no incoming edges`);
      }

      if (node.type !== 'TRIGGER' && node.type !== 'END') {
        if (!hasIncoming && !hasOutgoing) {
          errors.push(`Node "${node.label || node.id}" is disconnected`);
        }
      }
    }

    // Check condition nodes have both yes and no edges
    const conditionNodes = workflow.nodes.filter((n) => n.type === 'CONDITION');
    for (const node of conditionNodes) {
      const nodeEdges = workflow.edges.filter((e) => e.source_node_id === node.id);
      const handles = nodeEdges.map((e) => e.source_handle?.toLowerCase());

      if (!handles.includes('yes')) {
        errors.push(`Condition node "${node.label || node.id}" missing 'yes' branch`);
      }
      if (!handles.includes('no')) {
        errors.push(`Condition node "${node.label || node.id}" missing 'no' branch`);
      }
    }

    // Check for handler availability
    for (const node of workflow.nodes) {
      if (!hasHandler(node.type)) {
        errors.push(`No handler available for node type: ${node.type}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Create a new workflow engine instance
 */
export function createWorkflowEngine(): WorkflowEngine {
  return new WorkflowEngine();
}
