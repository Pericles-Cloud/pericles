/**
 * Leave Organization API Endpoint
 *
 * POST /api/organizations/:id/leave - Leave an organization
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../_cors.js';

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
    // Authenticate request
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

    // Check user has access to this organization (for proper error messages)
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, orgId);

    if (!accessResult.hasAccess) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
      return;
    }

    // Check for direct membership (you can only leave an org you're actually a member of)
    const directMembership = await prisma.userOrganization.findUnique({
      where: {
        user_id_organization_id: {
          user_id: tokenPayload.userId,
          organization_id: orgId,
        },
      },
    });

    if (directMembership?.status !== 'active') {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'You are not a direct member of this organization' },
      });
      return;
    }

    // Owners cannot leave - they must transfer ownership or delete the org
    if (directMembership.role === 'OWNER') {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Owners cannot leave. Transfer ownership or delete the organization.' },
      });
      return;
    }

    // Remove membership
    await prisma.userOrganization.delete({
      where: {
        user_id_organization_id: {
          user_id: tokenPayload.userId,
          organization_id: orgId,
        },
      },
    });

    res.status(200).json({
      success: true,
      data: { message: 'Successfully left the organization' },
    });
  } catch (error) {
    console.error('Leave organization endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
