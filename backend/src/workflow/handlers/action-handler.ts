/**
 * Action Node Handler
 *
 * Handles action nodes that perform operations like invoking agents,
 * making API calls, updating databases, or running scripts.
 *
 * In trial mode: Logs what WOULD execute and returns simulated success.
 * In run mode: Executes the actual action.
 */

import { NodeType } from '@prisma/client';
import type { ExecutionContext, NodeExecutionResult, ActionNodeData, WorkflowNodeWithData } from '../types.js';
import { BaseNodeHandler } from './base-handler.js';

export class ActionHandler extends BaseNodeHandler {
  protected readonly supportedTypes: NodeType[] = [NodeType.ACTION];

  async execute(node: WorkflowNodeWithData, context: ExecutionContext): Promise<NodeExecutionResult> {
    this.startExecution(node, context);

    try {
      const data = this.getNodeData(node) as ActionNodeData;

      // Trial mode: simulate execution
      if (this.isTrialMode(context)) {
        const result = this.simulateAction(node, data, context);
        this.completeExecution(node, context, result);
        return result;
      }

      // Run mode: execute actual action
      const result = await this.executeAction(node, data, context);
      this.completeExecution(node, context, result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const result: NodeExecutionResult = {
        success: false,
        error: `Action execution failed: ${errorMessage}`,
      };
      this.completeExecution(node, context, result);
      return result;
    }
  }

  /**
   * Simulate action execution for trial mode
   */
  private simulateAction(
    node: WorkflowNodeWithData,
    data: ActionNodeData,
    context: ExecutionContext
  ): NodeExecutionResult {
    const actionType = data.actionType || 'unknown';

    let simulatedOutput: Record<string, unknown>;

    switch (actionType) {
      case 'invoke_agent':
        simulatedOutput = {
          message: `[SIMULATED] Would invoke agent: ${data.agentId || 'default'}`,
          agentId: data.agentId,
          prompt: data.agentPrompt,
          simulatedResponse: 'Agent response would appear here',
        };
        break;

      case 'api_call':
        simulatedOutput = {
          message: `[SIMULATED] Would make ${data.apiMethod || 'GET'} request to: ${data.apiEndpoint || 'unknown'}`,
          method: data.apiMethod,
          endpoint: data.apiEndpoint,
          simulatedStatus: 200,
          simulatedBody: { success: true },
        };
        break;

      case 'database_update':
        simulatedOutput = {
          message: '[SIMULATED] Would update database',
          simulatedRowsAffected: 1,
        };
        break;

      case 'script':
        simulatedOutput = {
          message: '[SIMULATED] Would execute script',
          scriptPreview: data.scriptCode?.substring(0, 100) || 'No script defined',
        };
        break;

      default:
        simulatedOutput = {
          message: `[SIMULATED] Unknown action type: ${actionType}`,
        };
    }

    // Store simulated result in variables
    const outputKey = `action_${node.client_id}_output`;
    context.variables[outputKey] = simulatedOutput;

    return {
      success: true,
      output: simulatedOutput,
      simulated: true,
    };
  }

  /**
   * Execute the actual action
   */
  private async executeAction(
    node: WorkflowNodeWithData,
    data: ActionNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    const actionType = data.actionType || 'unknown';

    switch (actionType) {
      case 'invoke_agent':
        return this.executeAgentInvocation(node, data, context);

      case 'api_call':
        return this.executeApiCall(node, data, context);

      case 'database_update':
        return this.executeDatabaseUpdate(node, data, context);

      case 'script':
        return this.executeScript(node, data, context);

      default:
        return {
          success: false,
          error: `Unknown action type: ${actionType}`,
        };
    }
  }

  /**
   * Invoke a Mastra agent
   */
  private executeAgentInvocation(
    node: WorkflowNodeWithData,
    data: ActionNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    const agentId = data.agentId;
    const prompt = data.agentPrompt;

    if (!agentId) {
      return Promise.resolve({ success: false, error: 'Agent ID is required' });
    }

    // TODO: Integrate with Mastra agent system
    // For now, return a placeholder result
    const output = {
      message: `Agent ${agentId} invoked`,
      agentId,
      prompt,
      response: 'Agent integration pending implementation',
      executedAt: new Date().toISOString(),
    };

    const outputKey = `action_${node.client_id}_output`;
    context.variables[outputKey] = output;

    return Promise.resolve({ success: true, output });
  }

  /**
   * Make an API call
   */
  private async executeApiCall(
    node: WorkflowNodeWithData,
    data: ActionNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    const endpoint = data.apiEndpoint;
    const method = data.apiMethod || 'GET';

    if (!endpoint) {
      return { success: false, error: 'API endpoint is required' };
    }

    try {
      // Parse headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...data.apiHeaders,
      };

      // Parse body for non-GET requests
      let body: string | undefined;
      if (method !== 'GET' && data.apiBody) {
        // Replace variables in body using simple template syntax
        body = this.interpolateVariables(data.apiBody, context.variables);
      }

      const response = await fetch(endpoint, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(30000), // 30s timeout
      });

      const responseData = await response.json().catch(() => response.text());

      const output = {
        status: response.status,
        statusText: response.statusText,
        data: responseData,
        executedAt: new Date().toISOString(),
      };

      const outputKey = `action_${node.client_id}_output`;
      context.variables[outputKey] = output;

      return {
        success: response.ok,
        output,
        error: response.ok ? undefined : `API returned status ${response.status}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'API call failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute a database update
   */
  private executeDatabaseUpdate(
    node: WorkflowNodeWithData,
    _data: ActionNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    // TODO: Implement database update logic
    // This would use context.prisma to perform safe updates

    const output = {
      message: 'Database update functionality pending implementation',
      executedAt: new Date().toISOString(),
    };

    const outputKey = `action_${node.client_id}_output`;
    context.variables[outputKey] = output;

    return Promise.resolve({ success: true, output });
  }

  /**
   * Execute a script (sandboxed)
   */
  private executeScript(
    node: WorkflowNodeWithData,
    _data: ActionNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    // For security, script execution is not implemented
    // In production, this would use a sandboxed environment

    const output = {
      message: 'Script execution is disabled for security. Use other action types.',
      executedAt: new Date().toISOString(),
    };

    const outputKey = `action_${node.client_id}_output`;
    context.variables[outputKey] = output;

    return Promise.resolve({
      success: false,
      output,
      error: 'Script execution is disabled for security reasons',
    });
  }

  /**
   * Simple variable interpolation for API body templates
   * Replaces {{variableName}} with actual values
   */
  private interpolateVariables(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
      const value = this.getNestedValue(variables, key.trim());
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      // Primitives can be safely converted to string
      return String(value as string | number | boolean);
    });
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
}
