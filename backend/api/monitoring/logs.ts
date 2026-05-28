/**
 * Monitoring Logs API Endpoint
 *
 * GET /api/monitoring/logs?organizationId=xxx&limit=50 - Get monitoring audit logs
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatLog(log: any) {
  return {
    id: log.id,
    organizationId: log.organization_id,
    cycleId: log.cycle_id,
    status: log.status,
    eventsDetected: log.events_detected,
    eventsPublished: log.events_published,
    sourceStats: log.source_stats,
    errorDetails: log.error_details,
    durationMs: log.duration_ms,
    createdAt: log.created_at.toISOString(),
  };
}

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
    const limitStr = req.query.limit as string;
    const limit = limitStr ? Math.min(parseInt(limitStr, 10), 100) : 50;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'organizationId is required' },
      });
      return;
    }

    // Check user has access to organization
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, organizationId);

    if (!accessResult.hasAccess) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied to organization' },
      });
      return;
    }

    // Get logs
    const logs = await prisma.monitoringAuditLog.findMany({
      where: { organization_id: organizationId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    res.status(200).json({
      success: true,
      data: logs.map(formatLog),
    });
  } catch (error) {
    console.error('Monitoring logs endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
