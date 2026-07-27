import { verifyAccessToken, type AccessTokenPayload } from './jwt.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Minimal request interface for authentication — structural, so it accepts an
 * Express `Request` without coupling this module to a transport.
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

/*
 * `withAuth` / `requireRole` used to live here as Vercel serverless handler
 * wrappers. They were removed with the `backend/api/**` serverless tree — the
 * deployed API is the Express server in `src/server/auth-server.ts`, which
 * calls `authenticateRequest` and `checkOrganizationAccess` directly per route.
 */

/**
 * Result of organization access check.
 */
export interface OrganizationAccess {
  hasAccess: true;
  membership: {
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
    isRootOrgMember: boolean;
    /**
     * True when access is granted through an ancestor organization (parent
     * rollup) rather than direct membership or root-org global access.
     */
    viaHierarchy: boolean;
  };
}

export interface OrganizationAccessDenied {
  hasAccess: false;
  reason: 'not_found' | 'not_member';
}

export type OrganizationAccessResult = OrganizationAccess | OrganizationAccessDenied;

type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';

/** Bounds the ancestor walk against a malformed/cyclic hierarchy. */
const MAX_HIERARCHY_DEPTH = 16;

/**
 * Check if a user has access to an organization. Returns access if:
 * 1. The user has a direct active membership to the organization, OR
 * 2. The user is a member of the root organization (pericles.cloud users have
 *    global access), OR
 * 3. The user has an active membership in an ANCESTOR organization — a parent
 *    holding company rolls up to its branded subsidiaries (`pericles-data-model`,
 *    `pericles-tenant-isolation`).
 *
 * Access flows ancestor → descendant ONLY: a child- or sibling-org member never
 * gains access to a parent or sibling. The role returned for root/hierarchy
 * access is the user's role in the granting (root/ancestor) org.
 *
 * `client` is injectable for tests; it defaults to the module Prisma client.
 */
export async function checkOrganizationAccess(
  userId: string,
  organizationId: string,
  client: PrismaClient = prisma
): Promise<OrganizationAccessResult> {
  // 1. Direct membership.
  const directMembership = await client.userOrganization.findUnique({
    where: {
      user_id_organization_id: { user_id: userId, organization_id: organizationId },
    },
    include: { organization: { select: { is_root: true } } },
  });

  if (directMembership?.status === 'active') {
    return {
      hasAccess: true,
      membership: {
        role: directMembership.role as OrgRole,
        isRootOrgMember: directMembership.organization.is_root,
        viaHierarchy: false,
      },
    };
  }

  // 2. Root-org global access.
  const rootMembership = await client.userOrganization.findFirst({
    where: { user_id: userId, status: 'active', organization: { is_root: true } },
  });

  if (rootMembership) {
    const targetOrg = await client.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!targetOrg) {
      return { hasAccess: false, reason: 'not_found' };
    }
    return {
      hasAccess: true,
      membership: {
        role: rootMembership.role as OrgRole,
        isRootOrgMember: true,
        viaHierarchy: false,
      },
    };
  }

  // 3. Hierarchy rollup: an active membership in any ancestor org grants access
  //    to this (descendant) org. Walk up `parent_organization_id` from the target.
  const target = await client.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, parent_organization_id: true },
  });
  if (!target) {
    return { hasAccess: false, reason: 'not_found' };
  }

  const visited = new Set<string>([organizationId]);
  let parentId = target.parent_organization_id;
  for (let depth = 0; parentId && depth < MAX_HIERARCHY_DEPTH; depth++) {
    if (visited.has(parentId)) break; // cycle guard
    visited.add(parentId);

    const ancestorMembership = await client.userOrganization.findUnique({
      where: {
        user_id_organization_id: { user_id: userId, organization_id: parentId },
      },
    });
    if (ancestorMembership?.status === 'active') {
      return {
        hasAccess: true,
        membership: {
          role: ancestorMembership.role as OrgRole,
          isRootOrgMember: false,
          viaHierarchy: true,
        },
      };
    }

    const ancestor = await client.organization.findUnique({
      where: { id: parentId },
      select: { parent_organization_id: true },
    });
    parentId = ancestor?.parent_organization_id ?? null;
  }

  return { hasAccess: false, reason: 'not_member' };
}
