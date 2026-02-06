/**
 * Workflow Execution Service
 *
 * High-level orchestration service for workflow execution.
 * - Creates WorkflowExecution records
 * - Handles trial vs run mode
 * - Manages execution lifecycle
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ExecutionContext,
  ExecutionMode,
  WorkflowExecutionResult,
  WorkflowForExecution,
  WorkflowNodeWithData,
} from './types';
import { type WorkflowEngine, createWorkflowEngine } from './workflow-engine';

/**
 * Options for workflow execution
 */
export interface ExecuteWorkflowOptions {
  /** Execution mode: 'trial' (dry run) or 'run' (live) */
  mode: ExecutionMode;
  /** ID of the user triggering the execution */
  triggeredBy?: string;
  /** Initial variables to pass to the workflow */
  initialVariables?: Record<string, unknown>;
}

/**
 * Workflow Execution Service
 * Orchestrates workflow execution lifecycle
 */
export class WorkflowExecutionService {
  private prisma: PrismaClient;
  private engine: WorkflowEngine;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.engine = createWorkflowEngine();
  }

  /**
   * Execute a workflow
   *
   * @param workflowId - ID of the workflow to execute
   * @param organizationId - Organization ID for tenant isolation
   * @param options - Execution options (mode, triggeredBy, initialVariables)
   * @returns Execution result with logs
   */
  async execute(
    workflowId: string,
    organizationId: string,
    options: ExecuteWorkflowOptions
  ): Promise<WorkflowExecutionResult> {
    const startTime = new Date();

    // Load workflow with nodes and edges
    const workflow = await this.loadWorkflow(workflowId, organizationId);

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    // Validate workflow can be executed
    if (workflow.status !== 'PUBLISHED') {
      throw new Error('Only published workflows can be executed');
    }

    // Validate workflow structure
    const workflowForExecution = this.convertToExecutionFormat(workflow);
    const validation = this.engine.validateWorkflow(workflowForExecution);

    if (!validation.valid) {
      throw new Error(`Workflow validation failed: ${validation.errors.join(', ')}`);
    }

    // Create execution record
    const execution = await this.prisma.workflowExecution.create({
      data: {
        workflow_id: workflowId,
        triggered_by: options.mode === 'trial' ? `trial:${options.triggeredBy || 'manual'}` : options.triggeredBy || 'manual',
        status: 'RUNNING',
        started_at: startTime,
        execution_log: [],
      },
    });

    // Create execution context
    const context: ExecutionContext = {
      mode: options.mode,
      workflowId,
      executionId: execution.id,
      organizationId,
      triggeredBy: options.triggeredBy,
      variables: {
        ...(options.initialVariables || {}),
        _mode: options.mode,
        _startedAt: startTime.toISOString(),
      },
      logs: [],
      prisma: this.prisma,
    };

    let finalStatus: 'COMPLETED' | 'FAILED' = 'COMPLETED';
    let errorMessage: string | undefined;

    try {
      // Execute the workflow
      await this.engine.execute(workflowForExecution, context);

      // Check if any nodes failed
      const hasFailures = context.logs.some((log) => log.status === 'failed');
      if (hasFailures) {
        finalStatus = 'FAILED';
        const failedNodes = context.logs.filter((log) => log.status === 'failed');
        errorMessage = `${failedNodes.length} node(s) failed during execution`;
      }
    } catch (error) {
      finalStatus = 'FAILED';
      errorMessage = error instanceof Error ? error.message : 'Unknown error during execution';

      // Add error to logs
      context.logs.push({
        nodeId: 'engine',
        nodeClientId: 'engine',
        nodeType: 'END' as const,
        nodeLabel: 'Execution Engine',
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      });
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    // Update execution record
    await this.prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: finalStatus,
        completed_at: endTime,
        error: errorMessage,
        execution_log: context.logs as unknown as object[],
      },
    });

    return {
      id: execution.id,
      status: finalStatus,
      executionLog: context.logs,
      error: errorMessage,
      output: context.variables,
      startedAt: startTime.toISOString(),
      completedAt: endTime.toISOString(),
      durationMs,
    };
  }

  /**
   * Load a workflow with all nodes and edges
   */
  private async loadWorkflow(workflowId: string, organizationId: string) {
    return this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        organization_id: organizationId,
      },
      include: {
        nodes: {
          include: {
            outgoing_edges: true,
            incoming_edges: true,
          },
        },
        edges: true,
      },
    });
  }

  /**
   * Convert Prisma workflow to execution format
   */
  private convertToExecutionFormat(workflow: NonNullable<Awaited<ReturnType<typeof this.loadWorkflow>>>): WorkflowForExecution {
    return {
      id: workflow.id,
      organization_id: workflow.organization_id,
      name: workflow.name,
      version: workflow.version,
      nodes: workflow.nodes.map((node) => ({
        ...node,
        data: (node.data || {}) as Record<string, unknown>,
      })) as WorkflowNodeWithData[],
      edges: workflow.edges,
    };
  }

  /**
   * Get execution history for a workflow
   */
  async getExecutionHistory(workflowId: string, organizationId: string, limit = 50) {
    // Verify workflow belongs to organization
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, organization_id: organizationId },
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    return this.prisma.workflowExecution.findMany({
      where: { workflow_id: workflowId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  /**
   * Get a specific execution
   */
  async getExecution(executionId: string, workflowId: string, organizationId: string) {
    // Verify workflow belongs to organization
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, organization_id: organizationId },
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    return this.prisma.workflowExecution.findFirst({
      where: {
        id: executionId,
        workflow_id: workflowId,
      },
    });
  }

  /**
   * Cancel a running execution
   */
  async cancelExecution(executionId: string, workflowId: string, organizationId: string) {
    // Verify workflow belongs to organization
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, organization_id: organizationId },
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const execution = await this.prisma.workflowExecution.findFirst({
      where: {
        id: executionId,
        workflow_id: workflowId,
        status: 'RUNNING',
      },
    });

    if (!execution) {
      throw new Error('Running execution not found');
    }

    return this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'CANCELLED',
        completed_at: new Date(),
        error: 'Execution cancelled by user',
      },
    });
  }
}

/**
 * Create a new workflow execution service instance
 */
export function createWorkflowExecutionService(prisma: PrismaClient): WorkflowExecutionService {
  return new WorkflowExecutionService(prisma);
}
