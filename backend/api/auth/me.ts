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
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

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

    // Check if user is a member of the root organization (pericles.cloud users)
    const rootMembership = user.memberships.find((m) => m.organization.is_root);

    // Root org users can see and switch to ALL organizations
    let organizations: Array<{ id: string; name: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST' }>;

    if (rootMembership) {
      const allOrganizations = await prisma.organization.findMany({
        orderBy: [{ is_root: 'desc' }, { name: 'asc' }],
      });

      // Root org users get their root org role for all organizations they can access
      organizations = allOrganizations.map((org) => ({
        id: org.id,
        name: org.name,
        role: rootMembership.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
      }));
    } else {
      // Regular users only see their own memberships
      organizations = user.memberships.map((m) => ({
        id: m.organization_id,
        name: m.organization.name,
        role: m.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
      }));
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
        organizations,
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
