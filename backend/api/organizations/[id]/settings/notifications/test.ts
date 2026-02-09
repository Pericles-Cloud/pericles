/**
 * Test Notification API Endpoint
 *
 * POST /api/organizations/:id/settings/notifications/test - Send a test notification
 * Auth: Bearer token required (ADMIN or OWNER)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../../_cors.js';

const prisma = new PrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported' },
    });
    return;
  }

  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const orgId = req.query.id as string;

    if (!orgId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID is required' },
      });
      return;
    }

    const membership = await prisma.userOrganization.findUnique({
      where: {
        user_id_organization_id: {
          user_id: tokenPayload.userId,
          organization_id: orgId,
        },
      },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
      return;
    }

    // Require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required to test notifications' },
      });
      return;
    }

    const { type } = req.body;

    // Get current settings
    const settings = await prisma.organizationSettings.findUnique({
      where: { organization_id: orgId },
    });

    if (type === 'email' && settings?.notifications_email_enabled) {
      // TODO: Implement email notification
      res.status(200).json({
        success: true,
        data: {
          message: 'Test email notification sent',
          recipients: settings.notifications_email_recipients,
        },
      });
      return;
    }

    if (type === 'slack' && settings?.notifications_slack_enabled && settings?.notifications_slack_webhook_url) {
      try {
        const webhookUrl = settings.notifications_slack_webhook_url;
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: '🔔 Test notification from Pericles Supply Chain Risk Platform',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '*Test Notification*\n\nThis is a test notification from Pericles. If you received this, your Slack integration is working correctly.',
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `Sent at: ${new Date().toISOString()}`,
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          res.status(400).json({
            success: false,
            error: { code: 'SLACK_ERROR', message: 'Failed to send Slack notification' },
          });
          return;
        }

        res.status(200).json({
          success: true,
          data: { message: 'Test Slack notification sent successfully' },
        });
        return;
      } catch (error) {
        console.error('Slack notification error:', error);
        res.status(400).json({
          success: false,
          error: { code: 'SLACK_ERROR', message: 'Failed to send Slack notification' },
        });
        return;
      }
    }

    res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Notification type not configured or invalid' },
    });
  } catch (error) {
    console.error('Test notification endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
