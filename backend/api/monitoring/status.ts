/**
 * Monitoring Status API Endpoint
 *
 * GET /api/monitoring/status?organizationId=xxx - Get monitoring agent status
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported' },
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

    const organizationId = req.query.organizationId as string;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'organizationId is required' },
      });
      return;
    }

    // Check user has access to organization
    const membership = await prisma.userOrganization.findUnique({
      where: {
        user_id_organization_id: {
          user_id: tokenPayload.userId,
          organization_id: organizationId,
        },
      },
    });

    if (membership?.status !== 'active') {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied to organization' },
      });
      return;
    }

    // Get organization context for config
    const orgContext = await prisma.organizationContext.findUnique({
      where: { organization_id: organizationId },
    });

    // Get recent audit logs to determine status
    const recentLogs = await prisma.monitoringAuditLog.findMany({
      where: { organization_id: organizationId },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    // Aggregate statistics
    const allLogs = await prisma.monitoringAuditLog.aggregate({
      where: { organization_id: organizationId },
      _count: true,
      _sum: {
        events_detected: true,
        events_published: true,
      },
    });

    // Determine status from recent logs
    let status: 'active' | 'idle' | 'error' | 'stopped' = 'idle';
    let consecutiveErrors = 0;

    if (recentLogs.length > 0) {
      const lastLog = recentLogs[0];
      const lastRunTime = lastLog.created_at.getTime();
      const now = Date.now();
      const timeSinceLastRun = now - lastRunTime;

      // If last run was within 2 minutes, consider active
      if (timeSinceLastRun < 120000) {
        status = lastLog.status === 'failure' ? 'error' : 'active';
      }

      // Count consecutive errors
      for (const log of recentLogs) {
        if (log.status === 'failure') {
          consecutiveErrors++;
        } else {
          break;
        }
      }
    }

    const lastSuccessLog = recentLogs.find(l => l.status === 'success' || l.status === 'partial_success');

    const agentStatus = {
      name: 'Monitoring Agent',
      status,
      lastRunAt: recentLogs[0]?.created_at.toISOString() || null,
      lastSuccessAt: lastSuccessLog?.created_at.toISOString() || null,
      consecutiveErrors,
      totalCycles: allLogs._count || 0,
      totalEventsDetected: allLogs._sum.events_detected || 0,
      totalEventsPublished: allLogs._sum.events_published || 0,
      config: {
        organizationId,
        pollingIntervalMs: parseInt(process.env.MONITORING_DEFAULT_INTERVAL_MS || '15000', 10),
        geographicFilter: {
          radiusKm: orgContext?.geographic_radius_km || 100,
          strictMode: false,
        },
        riskFilter: {
          severityThreshold: orgContext?.severity_threshold || 0.5,
          monitoredRiskTypes: orgContext?.monitored_risk_types || [],
        },
      },
    };

    res.status(200).json({ success: true, data: agentStatus });
  } catch (error) {
    console.error('Monitoring status endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
