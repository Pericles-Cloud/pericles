/**
 * Events API Endpoint
 *
 * GET /api/events?organizationId=xxx - List events for an organization
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient, type Prisma } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatEvent(e: any) {
  return {
    id: e.id,
    organizationId: e.organization_id,
    eventHash: e.event_hash,
    type: e.type,
    source: e.source,
    title: e.title,
    description: e.description,
    locationName: e.location_name,
    latitude: e.latitude,
    longitude: e.longitude,
    detectedAt: e.detected_at.toISOString(),
    eventTimestamp: e.event_timestamp.toISOString(),
    severity: e.severity,
    confidence: e.confidence,
    riskFactors: e.risk_factors,
    affectedDomains: e.affected_domains,
    validationStatus: e.validation_status,
    validatedAt: e.validated_at?.toISOString() || null,
    incident: e.incident
      ? {
          id: e.incident.id,
          incidentNumber: e.incident.incident_number,
          status: e.incident.status,
          priority: e.incident.priority,
          assignedTo: e.incident.assigned_to,
          resolvedAt: e.incident.resolved_at?.toISOString() || null,
          responsePlanId: e.incident.response_plan_id,
        }
      : null,
    createdAt: e.created_at.toISOString(),
    updatedAt: e.updated_at.toISOString(),
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
    // Authenticate request
    const tokenPayload = authenticateRequest(req);

    if (!tokenPayload) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const organizationId = req.query.organizationId as string;
    const validationStatus = req.query.validationStatus as string;
    const type = req.query.type as string;
    const source = req.query.source as string;
    const limit = parseInt(req.query.limit as string || '50', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);

    if (!organizationId) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'organizationId is required' },
      });
      return;
    }

    // Verify membership (direct membership or root org member)
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, organizationId);

    if (!accessResult.hasAccess) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied to this organization' },
      });
      return;
    }

    // Build query filters
    const where: Prisma.EventWhereInput = { organization_id: organizationId };
    if (validationStatus) where.validation_status = validationStatus;
    if (type) where.type = type;
    if (source) where.source = source;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          incident: true,
        },
        orderBy: { event_timestamp: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
      }),
      prisma.event.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        events: events.map(formatEvent),
        total,
      },
    });
  } catch (error) {
    console.error('Events endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
