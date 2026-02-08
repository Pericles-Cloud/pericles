/**
 * Condition Node Handler
 *
 * Handles condition nodes that evaluate expressions and branch
 * the workflow based on the result (yes/no paths).
 *
 * Both trial and run modes evaluate conditions the same way.
 * The result determines which edge to follow: 'yes' or 'no'.
 */

import { NodeType } from '@prisma/client';
import type { ExecutionContext, NodeExecutionResult, ConditionNodeData, WorkflowNodeWithData } from '../types.js';
import { BaseNodeHandler } from './base-handler.js';
import { evaluateCondition } from '../expression-evaluator.js';

export class ConditionHandler extends BaseNodeHandler {
  protected readonly supportedTypes: NodeType[] = [NodeType.CONDITION];

  execute(node: WorkflowNodeWithData, context: ExecutionContext): Promise<NodeExecutionResult> {
    this.startExecution(node, context);

    try {
      const data = this.getNodeData(node) as ConditionNodeData;
      const conditionType = data.conditionType || 'expression';

      let result: boolean;
      let evaluationDetails: Record<string, unknown>;

      switch (conditionType) {
        case 'expression':
          ({ result, details: evaluationDetails } = this.evaluateExpression(data, context));
          break;

        case 'threshold':
          ({ result, details: evaluationDetails } = this.evaluateThreshold(data, context));
          break;

        case 'contains':
          ({ result, details: evaluationDetails } = this.evaluateContains(data, context));
          break;

        default:
          return Promise.resolve({
            success: false,
            error: `Unknown condition type: ${conditionType}`,
          });
      }

      // Store condition result in variables
      const outputKey = `condition_${node.client_id}_result`;
      context.variables[outputKey] = result;

      const output = {
        conditionType,
        result,
        nextPath: result ? 'yes' : 'no',
        ...evaluationDetails,
      };

      const executionResult: NodeExecutionResult = {
        success: true,
        output,
        nextEdges: [result ? 'yes' : 'no'],
      };

      this.completeExecution(node, context, executionResult);
      return Promise.resolve(executionResult);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorResult: NodeExecutionResult = {
        success: false,
        error: `Condition evaluation failed: ${errorMessage}`,
      };
      this.completeExecution(node, context, errorResult);
      return Promise.resolve(errorResult);
    }
  }

  /**
   * Evaluate a free-form expression
   */
  private evaluateExpression(
    data: ConditionNodeData,
    context: ExecutionContext
  ): { result: boolean; details: Record<string, unknown> } {
    const expression = data.expression;

    if (!expression) {
      throw new Error('Expression is required for expression condition type');
    }

    const result = evaluateCondition(expression, context.variables);

    return {
      result,
      details: {
        expression,
        evaluatedWith: this.getSafeVariableSnapshot(context.variables),
      },
    };
  }

  /**
   * Evaluate a threshold comparison
   */
  private evaluateThreshold(
    data: ConditionNodeData,
    context: ExecutionContext
  ): { result: boolean; details: Record<string, unknown> } {
    const field = data.field;
    const operator = data.operator || '>=';
    const threshold = data.value;

    if (!field) {
      throw new Error('Field is required for threshold condition type');
    }

    if (threshold === undefined || threshold === null) {
      throw new Error('Value/threshold is required for threshold condition type');
    }

    // Get the field value from variables
    const actualValue = this.getNestedValue(context.variables, field);

    if (actualValue === undefined) {
      throw new Error(`Field "${field}" not found in variables`);
    }

    const actualValueStr = this.toSafeString(actualValue);
    const thresholdStr = this.toSafeString(threshold);
    const numericValue = typeof actualValue === 'number' ? actualValue : parseFloat(actualValueStr);
    const numericThreshold = typeof threshold === 'number' ? threshold : parseFloat(thresholdStr);

    if (isNaN(numericValue) || isNaN(numericThreshold)) {
      throw new Error(`Cannot compare non-numeric values: ${actualValueStr} ${operator} ${thresholdStr}`);
    }

    let result: boolean;

    switch (operator) {
      case '==':
        result = numericValue === numericThreshold;
        break;
      case '!=':
        result = numericValue !== numericThreshold;
        break;
      case '>':
        result = numericValue > numericThreshold;
        break;
      case '<':
        result = numericValue < numericThreshold;
        break;
      case '>=':
        result = numericValue >= numericThreshold;
        break;
      case '<=':
        result = numericValue <= numericThreshold;
        break;
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }

    return {
      result,
      details: {
        field,
        actualValue: numericValue,
        operator,
        threshold: numericThreshold,
      },
    };
  }

  /**
   * Evaluate a contains/not_contains condition
   */
  private evaluateContains(
    data: ConditionNodeData,
    context: ExecutionContext
  ): { result: boolean; details: Record<string, unknown> } {
    const field = data.field;
    const operator = data.operator || 'contains';
    const searchValue = data.value;

    if (!field) {
      throw new Error('Field is required for contains condition type');
    }

    if (searchValue === undefined || searchValue === null) {
      throw new Error('Value is required for contains condition type');
    }

    // Get the field value from variables
    const actualValue = this.getNestedValue(context.variables, field);

    if (actualValue === undefined) {
      throw new Error(`Field "${field}" not found in variables`);
    }

    // Convert to string safely
    const actualValueStr = this.toSafeString(actualValue);
    const searchValueStr = this.toSafeString(searchValue);
    const stringValue = actualValueStr.toLowerCase();
    const searchString = searchValueStr.toLowerCase();

    let result: boolean;

    if (operator === 'contains') {
      result = stringValue.includes(searchString);
    } else if (operator === 'not_contains') {
      result = !stringValue.includes(searchString);
    } else {
      // Fall back to simple contains check
      result = stringValue.includes(searchString);
    }

    return {
      result,
      details: {
        field,
        actualValue: actualValueStr,
        operator,
        searchValue: searchValueStr,
      },
    };
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
      if (current === null || current === undefined) return undefined;
      return (current as Record<string, unknown>)[key];
    }, obj);
  }

  /**
   * Convert unknown value to string safely (handles objects)
   */
  private toSafeString(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    // Value is primitive (string, number, boolean, symbol, bigint)
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return value.toString();
    }
    // Fallback for symbol or other exotic types
    return JSON.stringify(value);
  }

  /**
   * Create a safe snapshot of variables for logging (exclude sensitive data)
   */
  private getSafeVariableSnapshot(variables: Record<string, unknown>): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'credential'];

    for (const [key, value] of Object.entries(variables)) {
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        snapshot[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        snapshot[key] = '[Object]';
      } else {
        snapshot[key] = value;
      }
    }

    return snapshot;
  }
}
