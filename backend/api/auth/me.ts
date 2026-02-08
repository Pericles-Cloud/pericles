/**
 * Current User API Endpoint
 *
 * GET /api/auth/me
 * Auth: Bearer token required
 *
 * Returns the current authenticated user's profile and organizations.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../src/auth/index.js';

const prisma = new PrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only accept GET
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

    // Get user with all organizations
    const user = await prisma.user.findUnique({
      where: { id: tokenPayload.userId },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { organization: true },
        },
      },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({
        success: false,
        error: { code: 'USER_INACTIVE', message: 'User account is not active' },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatar_url || user.google_avatar_url,
          emailVerified: user.email_verified,
        },
        organizations: user.memberships.map((m) => ({
          id: m.organization_id,
          name: m.organization.name,
          role: m.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
        })),
      },
    });
  } catch (error) {
    console.error('Get current user error:', error);

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
