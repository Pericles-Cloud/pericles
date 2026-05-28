import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAccessToken, type AccessTokenPayload } from './jwt.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Minimal request interface for authentication.
 * Compatible with both Express Request and VercelRequest.
 */
interface AuthenticatableRequest {
  headers: {
    authorization?: string;
  };
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Authentication middleware for protected endpoints.
 * Verifies JWT access token and returns the decoded payload.
 * Works with both Express Request and VercelRequest.
 */
export function authenticateRequest(
  req: AuthenticatableRequest
): AccessTokenPayload | null {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return null;
  }

  return verifyAccessToken(token);
}

type AuthHandler = (
  req: VercelRequest,
  res: VercelResponse,
  user: AccessTokenPayload
) => Promise<void>;

/**
 * Higher-order function to wrap handlers with authentication.
 * Returns 401 if not authenticated.
 */
export function withAuth(handler: AuthHandler) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    const user = authenticateRequest(req);

    if (!user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    await handler(req, res, user);
  };
}

/**
 * Require specific roles for an endpoint.
 */
export function requireRole(
  allowedRoles: Array<'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST'>
) {
  return (handler: AuthHandler) => {
    return withAuth(async (req, res, user) => {
      if (!allowedRoles.includes(user.role)) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions',
          },
        });
        return;
      }

      await handler(req, res, user);
    });
  };
}

/**
 * Result of organization access check.
 */
export interface OrganizationAccess {
  hasAccess: true;
  membership: {
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
    isRootOrgMember: boolean;
  };
}

export interface OrganizationAccessDenied {
  hasAccess: false;
  reason: 'not_found' | 'not_member';
}

export type OrganizationAccessResult = OrganizationAccess | OrganizationAccessDenied;

/**
 * Check if a user has access to an organization.
 * Returns access if:
 * 1. User has a direct active membership to the organization, OR
 * 2. User is a member of the root organization (pericles.cloud users can access all orgs)
 *
 * For root org members accessing other orgs, the role returned is their root org role.
 */
export async function checkOrganizationAccess(
  userId: string,
  organizationId: string
): Promise<OrganizationAccessResult> {
  // First check for direct membership
  const directMembership = await prisma.userOrganization.findUnique({
    where: {
      user_id_organization_id: {
        user_id: userId,
        organization_id: organizationId,
      },
    },
    include: {
      organization: {
        select: { is_root: true },
      },
    },
  });

  if (directMembership?.status === 'active') {
    return {
      hasAccess: true,
      membership: {
        role: directMembership.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
        isRootOrgMember: directMembership.organization.is_root,
      },
    };
  }

  // Check if user is a member of the root organization
  const rootMembership = await prisma.userOrganization.findFirst({
    where: {
      user_id: userId,
      status: 'active',
      organization: { is_root: true },
    },
  });

  if (rootMembership) {
    // Verify the target organization exists
    const targetOrg = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!targetOrg) {
      return { hasAccess: false, reason: 'not_found' };
    }

    // Root org members can access any organization with their root org role
    return {
      hasAccess: true,
      membership: {
        role: rootMembership.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
        isRootOrgMember: true,
      },
    };
  }

  return { hasAccess: false, reason: 'not_member' };
}
