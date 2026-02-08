/**
 * Base Node Handler
 *
 * Abstract base class for all node handlers.
 * Provides common functionality for logging and execution tracking.
 */

import type { NodeType } from '@prisma/client';
import type {
  ExecutionContext,
  ExecutionLog,
  NodeExecutionResult,
  NodeHandler,
  WorkflowNodeWithData,
} from '../types.js';

/**
 * Abstract base handler that all node handlers extend.
 * Provides common logging and utility methods.
 */
export abstract class BaseNodeHandler implements NodeHandler {
  /**
   * The node types this handler can process
   */
  protected abstract readonly supportedTypes: NodeType[];

  /**
   * Check if this handler can handle the given node type
   */
  canHandle(nodeType: NodeType): boolean {
    return this.supportedTypes.includes(nodeType);
  }

  /**
   * Execute the node - to be implemented by subclasses
   */
  abstract execute(
    node: WorkflowNodeWithData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult>;

  /**
   * Create a log entry for a node
   */
  protected createLogEntry(
    node: WorkflowNodeWithData,
    overrides: Partial<ExecutionLog> = {}
  ): ExecutionLog {
    return {
      nodeId: node.id,
      nodeClientId: node.client_id,
      nodeType: node.type,
      nodeLabel: node.label || `${node.type} Node`,
      status: 'pending',
      ...overrides,
    };
  }

  /**
   * Update a log entry in the context
   */
  protected updateLogEntry(
    context: ExecutionContext,
    nodeId: string,
    updates: Partial<ExecutionLog>
  ): void {
    const logIndex = context.logs.findIndex((log) => log.nodeId === nodeId);
    if (logIndex !== -1) {
      context.logs[logIndex] = { ...context.logs[logIndex], ...updates };
    }
  }

  /**
   * Get the existing log entry for a node, or create one
   */
  protected getOrCreateLogEntry(
    node: WorkflowNodeWithData,
    context: ExecutionContext
  ): ExecutionLog {
    const existing = context.logs.find((log) => log.nodeId === node.id);
    if (existing) {
      return existing;
    }

    const newEntry = this.createLogEntry(node);
    context.logs.push(newEntry);
    return newEntry;
  }

  /**
   * Start execution logging for a node
   */
  protected startExecution(node: WorkflowNodeWithData, context: ExecutionContext): void {
    this.getOrCreateLogEntry(node, context);
    this.updateLogEntry(context, node.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * Complete execution logging for a node
   */
  protected completeExecution(
    node: WorkflowNodeWithData,
    context: ExecutionContext,
    result: NodeExecutionResult
  ): void {
    const startedAt = context.logs.find((log) => log.nodeId === node.id)?.startedAt;
    const completedAt = new Date().toISOString();

    let durationMs: number | undefined;
    if (startedAt) {
      durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    }

    this.updateLogEntry(context, node.id, {
      status: result.success ? 'completed' : 'failed',
      completedAt,
      durationMs,
      result: result.output,
      error: result.error,
      simulated: result.simulated,
      skippedReason: result.simulated ? 'Simulated in trial mode' : undefined,
    });
  }

  /**
   * Skip execution logging for a node
   */
  protected skipExecution(
    node: WorkflowNodeWithData,
    context: ExecutionContext,
    reason: string
  ): void {
    this.getOrCreateLogEntry(node, context);
    this.updateLogEntry(context, node.id, {
      status: 'skipped',
      skippedReason: reason,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Check if we're in trial mode
   */
  protected isTrialMode(context: ExecutionContext): boolean {
    return context.mode === 'trial';
  }

  /**
   * Get node data
   */
  protected getNodeData(node: WorkflowNodeWithData): Record<string, unknown> {
    return (node.data ?? {}) as Record<string, unknown>;
  }
}
