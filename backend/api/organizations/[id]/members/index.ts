/**
 * Organization Members API Endpoint
 *
 * GET /api/organizations/:id/members - List organization members
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../../../src/auth/index.js';
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

    if (req.method === 'GET') {
      const members = await prisma.userOrganization.findMany({
        where: {
          organization_id: orgId,
          status: 'active',
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: [
          { role: 'asc' },
          { accepted_at: 'asc' },
        ],
      });

      const formattedMembers = members.map((m) => ({
        id: m.id,
        userId: m.user_id,
        user: {
          id: m.user.id,
          email: m.user.email,
          name: m.user.name,
        },
        role: m.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
        joinedAt: (m.accepted_at || m.created_at).toISOString(),
      }));

      res.status(200).json({
        success: true,
        data: formattedMembers,
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported' },
    });
  } catch (error) {
    console.error('Organization members endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
