/**
 * Event Validation API Endpoint
 *
 * PATCH /api/events/:id/validation - Update event validation status
 * Auth: Bearer token required (OWNER or ADMIN)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../_cors.js';

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

  if (req.method !== 'PATCH') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only PATCH requests are supported' },
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
    const { validationStatus } = req.body;

    if (!eventId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Event ID is required' },
      });
      return;
    }

    if (!validationStatus || !['pending', 'validated', 'rejected', 'duplicate'].includes(validationStatus)) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid validation status' },
      });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Event not found' },
      });
      return;
    }

    // Verify user has write access
    const membership = await prisma.userOrganization.findUnique({
      where: {
        user_id_organization_id: {
          user_id: tokenPayload.userId,
          organization_id: event.organization_id,
        },
      },
    });

    if (membership?.status !== 'active' || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      });
      return;
    }

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        validation_status: validationStatus,
        validated_at: validationStatus !== 'pending' ? new Date() : null,
      },
      include: { incident: true },
    });

    res.status(200).json({
      success: true,
      data: formatEvent(updated),
    });
  } catch (error) {
    console.error('Event validation endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
