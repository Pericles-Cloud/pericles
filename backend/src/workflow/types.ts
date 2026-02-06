/**
 * Workflow Execution Engine Types
 *
 * Core type definitions for the workflow execution system.
 */

import type { NodeType, ExecutionStatus, WorkflowNode, WorkflowEdge, PrismaClient } from '@prisma/client';

// Re-export Prisma types for convenience
export { NodeType, ExecutionStatus };

/**
 * Execution mode for workflow runs
 * - 'trial': Dry run with NO side effects (notifications, API calls are simulated)
 * - 'run': Full execution with real side effects
 */
export type ExecutionMode = 'trial' | 'run';

/**
 * Status of individual node execution within a workflow run
 */
export type NodeExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Execution context passed through the workflow during traversal
 */
export interface ExecutionContext {
  /** Execution mode: 'trial' (dry run) or 'run' (live) */
  mode: ExecutionMode;
  /** ID of the workflow being executed */
  workflowId: string;
  /** ID of this execution record */
  executionId: string;
  /** Organization ID for tenant isolation */
  organizationId: string;
  /** User ID who triggered the execution (if available) */
  triggeredBy?: string;
  /** Shared state/variables between nodes */
  variables: Record<string, unknown>;
  /** Execution logs for each node */
  logs: ExecutionLog[];
  /** Prisma client instance for database operations */
  prisma: PrismaClient;
}

/**
 * Log entry for individual node execution
 */
export interface ExecutionLog {
  /** Database ID of the node */
  nodeId: string;
  /** Client ID of the node (e.g., "node-1") */
  nodeClientId: string;
  /** Type of the node */
  nodeType: NodeType;
  /** Label/name of the node */
  nodeLabel: string;
  /** Current execution status */
  status: NodeExecutionStatus;
  /** When execution started */
  startedAt?: string;
  /** When execution completed */
  completedAt?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Result/output from the node */
  result?: unknown;
  /** Error message if failed */
  error?: string;
  /** Reason for skipping (e.g., "Simulated in trial mode") */
  skippedReason?: string;
  /** Whether this was simulated (trial mode side effects) */
  simulated?: boolean;
}

/**
 * Result returned by a node handler after execution
 */
export interface NodeExecutionResult {
  /** Whether execution was successful */
  success: boolean;
  /** Output data from the node */
  output?: Record<string, unknown>;
  /** Error message if execution failed */
  error?: string;
  /** Next edges to follow (for condition nodes: ['yes'] or ['no']) */
  nextEdges?: string[];
  /** Whether this was a simulated execution (trial mode) */
  simulated?: boolean;
}

/**
 * Workflow node with full data structure
 */
export interface WorkflowNodeWithData extends Omit<WorkflowNode, 'data'> {
  data: NodeData;
  outgoing_edges: WorkflowEdge[];
  incoming_edges: WorkflowEdge[];
}

/**
 * Node-specific configuration data
 */
export type NodeData = TriggerNodeData | ActionNodeData | ConditionNodeData | NotificationNodeData | EndNodeData;

/**
 * Trigger node configuration
 */
export interface TriggerNodeData {
  triggerType?: 'incident' | 'schedule' | 'manual' | 'webhook';
  incidentTypes?: string[];
  severityThreshold?: number;
  cronExpression?: string;
  webhookPath?: string;
}

/**
 * Action node configuration
 */
export interface ActionNodeData {
  actionType?: 'invoke_agent' | 'api_call' | 'database_update' | 'script';
  agentId?: string;
  agentPrompt?: string;
  apiEndpoint?: string;
  apiMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  apiHeaders?: Record<string, string>;
  apiBody?: string;
  scriptCode?: string;
}

/**
 * Condition node configuration
 */
export interface ConditionNodeData {
  conditionType?: 'expression' | 'threshold' | 'contains';
  expression?: string;
  field?: string;
  operator?: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'not_contains';
  value?: string | number | boolean;
}

/**
 * Notification node configuration
 */
export interface NotificationNodeData {
  notificationType?: 'email' | 'slack' | 'sms' | 'webhook';
  recipients?: string[];
  subject?: string;
  message?: string;
  slackChannel?: string;
  webhookUrl?: string;
  templateId?: string;
}

/**
 * End node configuration
 */
export interface EndNodeData {
  status?: 'success' | 'failure' | 'cancelled';
  summary?: string;
}

/**
 * Workflow structure with nodes and edges for execution
 */
export interface WorkflowForExecution {
  id: string;
  organization_id: string;
  name: string;
  version: number;
  nodes: WorkflowNodeWithData[];
  edges: WorkflowEdge[];
}

/**
 * Final result of a workflow execution
 */
export interface WorkflowExecutionResult {
  /** Execution record ID */
  id: string;
  /** Final status */
  status: ExecutionStatus;
  /** Execution logs for all nodes */
  executionLog: ExecutionLog[];
  /** Error message if execution failed */
  error?: string;
  /** Workflow-level output/variables */
  output?: Record<string, unknown>;
  /** Execution start time */
  startedAt: string;
  /** Execution completion time */
  completedAt: string;
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Node handler interface
 */
export interface NodeHandler {
  /** Check if this handler can handle the given node type */
  canHandle(nodeType: NodeType): boolean;

  /** Execute the node */
  execute(
    node: WorkflowNodeWithData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult>;
}
