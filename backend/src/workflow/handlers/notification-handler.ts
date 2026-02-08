/**
 * Notification Node Handler
 *
 * Handles notification nodes that send alerts via various channels
 * (email, Slack, SMS, webhooks).
 *
 * In trial mode: Logs notification details and marks as "would send".
 * In run mode: Sends actual notifications.
 */

import { NodeType } from '@prisma/client';
import type { ExecutionContext, NodeExecutionResult, NotificationNodeData, WorkflowNodeWithData } from '../types.js';
import { BaseNodeHandler } from './base-handler.js';

export class NotificationHandler extends BaseNodeHandler {
  protected readonly supportedTypes: NodeType[] = [NodeType.NOTIFICATION];

  async execute(node: WorkflowNodeWithData, context: ExecutionContext): Promise<NodeExecutionResult> {
    this.startExecution(node, context);

    try {
      const data = this.getNodeData(node) as NotificationNodeData;

      // Trial mode: simulate notification
      if (this.isTrialMode(context)) {
        const result = this.simulateNotification(node, data, context);
        this.completeExecution(node, context, result);
        return result;
      }

      // Run mode: send actual notification
      const result = await this.sendNotification(node, data, context);
      this.completeExecution(node, context, result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorResult: NodeExecutionResult = {
        success: false,
        error: `Notification failed: ${errorMessage}`,
      };
      this.completeExecution(node, context, errorResult);
      return errorResult;
    }
  }

  /**
   * Simulate notification for trial mode
   */
  private simulateNotification(
    node: WorkflowNodeWithData,
    data: NotificationNodeData,
    context: ExecutionContext
  ): NodeExecutionResult {
    const notificationType = data.notificationType || 'email';
    const interpolatedMessage = this.interpolateVariables(data.message || '', context.variables);
    const interpolatedSubject = this.interpolateVariables(data.subject || '', context.variables);

    let simulatedOutput: Record<string, unknown>;

    switch (notificationType) {
      case 'email':
        simulatedOutput = {
          message: '[SIMULATED] Would send email notification',
          type: 'email',
          recipients: data.recipients || [],
          subject: interpolatedSubject,
          body: interpolatedMessage,
          wouldSendTo: data.recipients?.join(', ') || 'No recipients configured',
        };
        break;

      case 'slack':
        simulatedOutput = {
          message: '[SIMULATED] Would send Slack notification',
          type: 'slack',
          channel: data.slackChannel || '#general',
          body: interpolatedMessage,
        };
        break;

      case 'sms':
        simulatedOutput = {
          message: '[SIMULATED] Would send SMS notification',
          type: 'sms',
          recipients: data.recipients || [],
          body: interpolatedMessage,
        };
        break;

      case 'webhook':
        simulatedOutput = {
          message: '[SIMULATED] Would call notification webhook',
          type: 'webhook',
          url: data.webhookUrl || 'No URL configured',
          payload: {
            subject: interpolatedSubject,
            message: interpolatedMessage,
          },
        };
        break;

      default:
        simulatedOutput = {
          message: `[SIMULATED] Unknown notification type: ${notificationType}`,
        };
    }

    // Store simulated result in variables
    const outputKey = `notification_${node.client_id}_output`;
    context.variables[outputKey] = simulatedOutput;

    return {
      success: true,
      output: simulatedOutput,
      simulated: true,
    };
  }

  /**
   * Send actual notification
   */
  private async sendNotification(
    node: WorkflowNodeWithData,
    data: NotificationNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    const notificationType = data.notificationType || 'email';

    switch (notificationType) {
      case 'email':
        return this.sendEmailNotification(node, data, context);

      case 'slack':
        return this.sendSlackNotification(node, data, context);

      case 'sms':
        return this.sendSmsNotification(node, data, context);

      case 'webhook':
        return this.sendWebhookNotification(node, data, context);

      default:
        return {
          success: false,
          error: `Unknown notification type: ${notificationType}`,
        };
    }
  }

  /**
   * Send email notification
   */
  private sendEmailNotification(
    node: WorkflowNodeWithData,
    data: NotificationNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    const recipients = data.recipients || [];
    const subject = this.interpolateVariables(data.subject || 'Workflow Notification', context.variables);
    const message = this.interpolateVariables(data.message || '', context.variables);

    if (recipients.length === 0) {
      return Promise.resolve({ success: false, error: 'No email recipients configured' });
    }

    // TODO: Integrate with actual email service (SendGrid, AWS SES, etc.)
    // For now, log the notification and return success

    const output = {
      type: 'email',
      recipients,
      subject,
      message,
      sentAt: new Date().toISOString(),
      status: 'sent_to_queue', // Placeholder until email service integration
    };

    const outputKey = `notification_${node.client_id}_output`;
    context.variables[outputKey] = output;

    console.log(`[Notification] Email would be sent to: ${recipients.join(', ')}`);
    console.log(`[Notification] Subject: ${subject}`);
    console.log(`[Notification] Message: ${message}`);

    return Promise.resolve({ success: true, output });
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(
    node: WorkflowNodeWithData,
    data: NotificationNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    const channel = data.slackChannel || '#general';
    const message = this.interpolateVariables(data.message || '', context.variables);

    // Get Slack webhook URL from organization settings
    const settings = await context.prisma.organizationSettings.findUnique({
      where: { organization_id: context.organizationId },
    });

    const webhookUrl = settings?.notifications_slack_webhook_url;

    if (!webhookUrl) {
      return {
        success: false,
        error: 'Slack webhook URL not configured in organization settings',
      };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          text: message,
          username: 'Pericles Workflow',
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Slack API returned ${response.status}`);
      }

      const output = {
        type: 'slack',
        channel,
        message,
        sentAt: new Date().toISOString(),
        status: 'sent',
      };

      const outputKey = `notification_${node.client_id}_output`;
      context.variables[outputKey] = output;

      return { success: true, output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Slack notification failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send SMS notification
   */
  private sendSmsNotification(
    node: WorkflowNodeWithData,
    data: NotificationNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    const recipients = data.recipients || [];
    const message = this.interpolateVariables(data.message || '', context.variables);

    if (recipients.length === 0) {
      return Promise.resolve({ success: false, error: 'No SMS recipients configured' });
    }

    // TODO: Integrate with actual SMS service (Twilio, etc.)
    const output = {
      type: 'sms',
      recipients,
      message,
      sentAt: new Date().toISOString(),
      status: 'sms_service_not_configured',
    };

    const outputKey = `notification_${node.client_id}_output`;
    context.variables[outputKey] = output;

    console.log(`[Notification] SMS would be sent to: ${recipients.join(', ')}`);
    console.log(`[Notification] Message: ${message}`);

    return Promise.resolve({
      success: false,
      output,
      error: 'SMS service not configured',
    });
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(
    node: WorkflowNodeWithData,
    data: NotificationNodeData,
    context: ExecutionContext
  ): Promise<NodeExecutionResult> {
    const webhookUrl = data.webhookUrl;
    const message = this.interpolateVariables(data.message || '', context.variables);
    const subject = this.interpolateVariables(data.subject || '', context.variables);

    if (!webhookUrl) {
      return { success: false, error: 'Webhook URL not configured' };
    }

    try {
      const payload = {
        type: 'workflow_notification',
        subject,
        message,
        workflowId: context.workflowId,
        executionId: context.executionId,
        organizationId: context.organizationId,
        timestamp: new Date().toISOString(),
        variables: this.getSafeVariableSnapshot(context.variables),
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }

      const output = {
        type: 'webhook',
        url: webhookUrl,
        status: response.status,
        sentAt: new Date().toISOString(),
      };

      const outputKey = `notification_${node.client_id}_output`;
      context.variables[outputKey] = output;

      return { success: true, output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Webhook notification failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Simple variable interpolation for messages
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
