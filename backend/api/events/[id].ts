/**
 * Single Event API Endpoint
 *
 * GET /api/events/:id - Get event details
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
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

    const eventId = req.query.id as string;

    if (!eventId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Event ID is required' },
      });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { incident: true },
    });

    if (!event) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Event not found' },
      });
      return;
    }

    // Verify membership
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, event.organization_id);

    if (!accessResult.hasAccess) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied to this event' },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: formatEvent(event),
    });
  } catch (error) {
    console.error('Event endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
