/**
 * Organization Member Management API Endpoint
 *
 * PATCH /api/organizations/:id/members/:memberId - Update member role
 * DELETE /api/organizations/:id/members/:memberId - Remove member
 * Auth: Bearer token required (OWNER or ADMIN)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../../../src/auth/index.js';
import { z } from 'zod';

const prisma = new PrismaClient();

const UpdateMemberSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER', 'GUEST']),
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
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
    const memberId = req.query.memberId as string;

    if (!orgId || !memberId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID and Member ID are required' },
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

    // Only OWNER and ADMIN can manage members
    if (!['OWNER', 'ADMIN'].includes(userMembership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      });
      return;
    }

    // Get target member
    const targetMember = await prisma.userOrganization.findUnique({
      where: { id: memberId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!targetMember || targetMember.organization_id !== orgId) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Member not found' },
      });
      return;
    }

    // Cannot modify OWNER
    if (targetMember.role === 'OWNER') {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Cannot modify organization owner' },
      });
      return;
    }

    // ADMIN cannot modify other ADMINs
    if (userMembership.role === 'ADMIN' && targetMember.role === 'ADMIN') {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admins cannot modify other admins' },
      });
      return;
    }

    if (req.method === 'PATCH') {
      const parseResult = UpdateMemberSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
        });
        return;
      }

      // ADMIN cannot promote to ADMIN
      if (userMembership.role === 'ADMIN' && parseResult.data.role === 'ADMIN') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only owners can create admins' },
        });
        return;
      }

      const updatedMember = await prisma.userOrganization.update({
        where: { id: memberId },
        data: { role: parseResult.data.role },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        data: {
          id: updatedMember.id,
          userId: updatedMember.user_id,
          user: {
            id: updatedMember.user.id,
            email: updatedMember.user.email,
            name: updatedMember.user.name,
          },
          role: updatedMember.role as 'ADMIN' | 'MEMBER' | 'GUEST',
          joinedAt: (updatedMember.accepted_at || updatedMember.created_at).toISOString(),
        },
      });
      return;
    }

    if (req.method === 'DELETE') {
      await prisma.userOrganization.delete({
        where: { id: memberId },
      });

      res.status(200).json({
        success: true,
        data: { message: 'Member removed successfully' },
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only PATCH and DELETE requests are supported' },
    });
  } catch (error) {
    console.error('Member management endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
