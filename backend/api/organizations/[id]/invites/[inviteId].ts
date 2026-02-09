/**
 * Organization Invite Management API Endpoint
 *
 * DELETE /api/organizations/:id/invites/:inviteId - Cancel invite
 * Auth: Bearer token required (OWNER or ADMIN)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../_cors.js';

const prisma = new PrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

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
    const inviteId = req.query.inviteId as string;

    if (!orgId || !inviteId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID and Invite ID are required' },
      });
      return;
    }

    // Check user membership and role
    const userMembership = await prisma.userOrganization.findUnique({
      where: {
        user_id_organization_id: {
          user_id: tokenPayload.userId,
          organization_id: orgId,
        },
      },
    });

    if (userMembership?.status !== 'active') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
      return;
    }

    // Only OWNER and ADMIN can manage invites
    if (!['OWNER', 'ADMIN'].includes(userMembership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      });
      return;
    }

    if (req.method === 'DELETE') {
      // Get the invite
      const invite = await prisma.userOrganization.findUnique({
        where: { id: inviteId },
      });

      if (invite?.organization_id !== orgId || invite.status !== 'pending') {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Invite not found' },
        });
        return;
      }

      // Delete the pending invite
      await prisma.userOrganization.delete({
        where: { id: inviteId },
      });

      res.status(200).json({
        success: true,
        data: { message: 'Invite cancelled successfully' },
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only DELETE requests are supported' },
    });
  } catch (error) {
    console.error('Invite management endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
