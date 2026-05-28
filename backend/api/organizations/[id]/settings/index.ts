/**
 * Organization Settings API Endpoint
 *
 * GET /api/organizations/:id/settings - Get organization settings
 * PATCH /api/organizations/:id/settings - Update organization settings
 * Auth: Bearer token required (ADMIN or OWNER for PATCH)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient, type Prisma } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../_cors.js';

const prisma = new PrismaClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatOrganizationSettings(settings: any) {
  return {
    id: settings.id,
    organizationId: settings.organization_id,
    // Agent Settings
    monitoringAgentEnabled: settings.monitoring_agent_enabled,
    monitoringPollingIntervalMs: settings.monitoring_polling_interval_ms,
    monitoringEnabledSources: settings.monitoring_enabled_sources,
    // AI Settings
    aiModelProvider: settings.ai_model_provider,
    aiModelName: settings.ai_model_name,
    aiModelTemperature: settings.ai_model_temperature,
    aiMaxTokens: settings.ai_max_tokens,
    // Notification Settings
    notificationsEmailEnabled: settings.notifications_email_enabled,
    notificationsEmailRecipients: settings.notifications_email_recipients,
    notificationsSeverityThreshold: settings.notifications_severity_threshold,
    notificationsSlackEnabled: settings.notifications_slack_enabled,
    notificationsSlackWebhookUrl: settings.notifications_slack_webhook_url,
    notificationsDigestEnabled: settings.notifications_digest_enabled,
    notificationsDigestFrequency: settings.notifications_digest_frequency,
    // Integration Status
    integrationSapConfigured: settings.integration_sap_configured,
    integrationSapLastSync: settings.integration_sap_last_sync?.toISOString() ?? null,
    integrationSapSyncFrequency: settings.integration_sap_sync_frequency,
    // Data Retention
    retentionEventsDays: settings.retention_events_days,
    retentionAuditLogsDays: settings.retention_audit_logs_days,
    retentionIncidentsDays: settings.retention_incidents_days,
    createdAt: settings.created_at.toISOString(),
    updatedAt: settings.updated_at.toISOString(),
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and PATCH requests are supported' },
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

    // Check user has access to this organization (direct membership or root org member)
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, orgId);

    if (!accessResult.hasAccess) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
      return;
    }

    const userRole = accessResult.membership.role;

    if (req.method === 'GET') {
      // Get or create settings for this organization
      let settings = await prisma.organizationSettings.findUnique({
        where: { organization_id: orgId },
      });

      // If no settings exist, create with defaults
      if (!settings) {
        settings = await prisma.organizationSettings.create({
          data: { organization_id: orgId },
        });
      }

      res.status(200).json({ success: true, data: formatOrganizationSettings(settings) });
      return;
    }

    // PATCH - Require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required to update settings' },
      });
      return;
    }

    // Extract allowed fields from body
    const {
      // Agent Settings
      monitoringAgentEnabled,
      monitoringPollingIntervalMs,
      monitoringEnabledSources,
      // AI Settings
      aiModelProvider,
      aiModelName,
      aiModelTemperature,
      aiMaxTokens,
      // Notification Settings
      notificationsEmailEnabled,
      notificationsEmailRecipients,
      notificationsSeverityThreshold,
      notificationsSlackEnabled,
      notificationsSlackWebhookUrl,
      notificationsDigestEnabled,
      notificationsDigestFrequency,
      // Integration Status
      integrationSapConfigured,
      integrationSapSyncFrequency,
      // Data Retention
      retentionEventsDays,
      retentionAuditLogsDays,
      retentionIncidentsDays,
    } = req.body;

    // Build update data only with provided fields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    // Agent Settings
    if (monitoringAgentEnabled !== undefined) updateData.monitoring_agent_enabled = monitoringAgentEnabled;
    if (monitoringPollingIntervalMs !== undefined) updateData.monitoring_polling_interval_ms = monitoringPollingIntervalMs;
    if (monitoringEnabledSources !== undefined) updateData.monitoring_enabled_sources = monitoringEnabledSources;

    // AI Settings
    if (aiModelProvider !== undefined) updateData.ai_model_provider = aiModelProvider;
    if (aiModelName !== undefined) updateData.ai_model_name = aiModelName;
    if (aiModelTemperature !== undefined) updateData.ai_model_temperature = aiModelTemperature;
    if (aiMaxTokens !== undefined) updateData.ai_max_tokens = aiMaxTokens;

    // Notification Settings
    if (notificationsEmailEnabled !== undefined) updateData.notifications_email_enabled = notificationsEmailEnabled;
    if (notificationsEmailRecipients !== undefined) updateData.notifications_email_recipients = notificationsEmailRecipients;
    if (notificationsSeverityThreshold !== undefined) updateData.notifications_severity_threshold = notificationsSeverityThreshold;
    if (notificationsSlackEnabled !== undefined) updateData.notifications_slack_enabled = notificationsSlackEnabled;
    if (notificationsSlackWebhookUrl !== undefined) updateData.notifications_slack_webhook_url = notificationsSlackWebhookUrl;
    if (notificationsDigestEnabled !== undefined) updateData.notifications_digest_enabled = notificationsDigestEnabled;
    if (notificationsDigestFrequency !== undefined) updateData.notifications_digest_frequency = notificationsDigestFrequency;

    // Integration Status
    if (integrationSapConfigured !== undefined) updateData.integration_sap_configured = integrationSapConfigured;
    if (integrationSapSyncFrequency !== undefined) updateData.integration_sap_sync_frequency = integrationSapSyncFrequency;

    // Data Retention
    if (retentionEventsDays !== undefined) updateData.retention_events_days = retentionEventsDays;
    if (retentionAuditLogsDays !== undefined) updateData.retention_audit_logs_days = retentionAuditLogsDays;
    if (retentionIncidentsDays !== undefined) updateData.retention_incidents_days = retentionIncidentsDays;

    // Upsert settings
    const settings = await prisma.organizationSettings.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId, ...updateData } as Prisma.OrganizationSettingsUncheckedCreateInput,
      update: updateData as Prisma.OrganizationSettingsUncheckedUpdateInput,
    });

    res.status(200).json({ success: true, data: formatOrganizationSettings(settings) });
  } catch (error) {
    console.error('Organization settings endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
