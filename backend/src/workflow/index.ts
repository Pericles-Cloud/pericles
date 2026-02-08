/**
 * Workflow Execution Engine
 *
 * Main entry point for the workflow execution system.
 * Exports all types, handlers, and services.
 */

// Core types
export type {
  ExecutionMode,
  NodeExecutionStatus,
  ExecutionContext,
  ExecutionLog,
  NodeExecutionResult,
  WorkflowNodeWithData,
  NodeData,
  TriggerNodeData,
  ActionNodeData,
  ConditionNodeData,
  NotificationNodeData,
  EndNodeData,
  WorkflowForExecution,
  WorkflowExecutionResult,
  NodeHandler,
} from './types.js';

// Re-export Prisma enums for convenience
export { NodeType, ExecutionStatus } from '@prisma/client';

// Expression evaluator
export { evaluateCondition, validateExpression } from './expression-evaluator.js';

// Node handlers
export {
  BaseNodeHandler,
  TriggerHandler,
  ActionHandler,
  ConditionHandler,
  NotificationHandler,
  EndHandler,
  getHandler,
  getAllHandlers,
  hasHandler,
} from './handlers/index.js';

// Workflow engine
export { WorkflowEngine, createWorkflowEngine } from './workflow-engine.js';

// Workflow execution service
export type { ExecuteWorkflowOptions } from './workflow-execution-service.js';
export {
  WorkflowExecutionService,
  createWorkflowExecutionService,
} from './workflow-execution-service.js';
