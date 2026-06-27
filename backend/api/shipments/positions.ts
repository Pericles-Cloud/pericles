/**
 * Shipment Positions API Endpoint
 *
 * GET /api/shipments/positions?organizationId=xxx
 *   → current PositionUpdate[] for the org's shipments, from the configured
 *     ShipmentPositionFeed (mock today; Terminal49+AISstream when TRACKING_MODE=live).
 * Auth: Bearer token required. Tenant-scoped via checkOrganizationAccess.
 *
 * Atlas polls this to animate moving vessel dots along their sea-routes. The
 * shape is feed-agnostic, so swapping mock→live changes nothing here or in the UI.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';
import { getPositionFeed, getOrganizationPositions } from '../../src/integrations/tracking/index.js';

const prisma = new PrismaClient();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported' },
      });
      return;
    }

    const organizationId = req.query.organizationId as string;
    if (!organizationId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'organizationId query parameter is required' },
      });
      return;
    }

    const accessResult = await checkOrganizationAccess(tokenPayload.userId, organizationId);
    if (!accessResult.hasAccess) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied to this organization' },
      });
      return;
    }

    // Roll up across branded subsidiaries when requested (?includeSubsidiaries=true).
    const includeSubsidiaries = req.query.includeSubsidiaries === 'true';
    const positions = await getOrganizationPositions(prisma, organizationId, { includeSubsidiaries });

    res.status(200).json({
      success: true,
      data: positions,
      meta: { source: getPositionFeed().source, count: positions.length },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to compute positions',
      },
    });
  }
}
