/**
 * Organization Invites API Endpoint
 *
 * GET /api/organizations/:id/invites - List pending invites
 * POST /api/organizations/:id/invites - Send new invite
 * Auth: Bearer token required (OWNER or ADMIN)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../../../src/auth';
import { z } from 'zod';

const prisma = new PrismaClient();

const CreateInviteSchema = z.object({
  email: z.string().email(),
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

    if (!orgId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID is required' },
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

    if (req.method === 'GET') {
      // List pending invites (members with status 'pending')
      const pendingInvites = await prisma.userOrganization.findMany({
        where: {
          organization_id: orgId,
          status: 'pending',
        },
        include: {
          user: {
            select: {
              email: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      const formattedInvites = pendingInvites.map((invite) => ({
        id: invite.id,
        email: invite.user.email,
        role: invite.role as 'ADMIN' | 'MEMBER' | 'GUEST',
        status: 'PENDING' as const,
        expiresAt: new Date(invite.created_at.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from creation
        createdAt: invite.created_at.toISOString(),
      }));

      res.status(200).json({
        success: true,
        data: formattedInvites,
      });
      return;
    }

    if (req.method === 'POST') {
      const parseResult = CreateInviteSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
        });
        return;
      }

      const { email, role } = parseResult.data;

      // ADMIN cannot create ADMIN invites
      if (userMembership.role === 'ADMIN' && role === 'ADMIN') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only owners can invite admins' },
        });
        return;
      }

      // Check if user exists
      let invitedUser = await prisma.user.findUnique({
        where: { email },
      });

      // If user doesn't exist, create a placeholder account
      if (!invitedUser) {
        invitedUser = await prisma.user.create({
          data: {
            email,
            status: 'active', // They'll set password when they accept
          },
        });
      }

      // Check if already a member
      const existingMembership = await prisma.userOrganization.findUnique({
        where: {
          user_id_organization_id: {
            user_id: invitedUser.id,
            organization_id: orgId,
          },
        },
      });

      if (existingMembership) {
        if (existingMembership.status === 'active') {
          res.status(409).json({
            success: false,
            error: { code: 'CONFLICT', message: 'User is already a member' },
          });
          return;
        }
        if (existingMembership.status === 'pending') {
          res.status(409).json({
            success: false,
            error: { code: 'CONFLICT', message: 'User already has a pending invite' },
          });
          return;
        }
      }

      // Create invite (pending membership)
      const invite = await prisma.userOrganization.create({
        data: {
          user_id: invitedUser.id,
          organization_id: orgId,
          role,
          status: 'pending',
          invited_by: tokenPayload.userId,
          invited_at: new Date(),
        },
      });

      // TODO: Send invitation email

      res.status(201).json({
        success: true,
        data: {
          id: invite.id,
          email,
          role: invite.role as 'ADMIN' | 'MEMBER' | 'GUEST',
          status: 'PENDING' as const,
          expiresAt: new Date(invite.created_at.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdAt: invite.created_at.toISOString(),
        },
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported' },
    });
  } catch (error) {
    console.error('Organization invites endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
