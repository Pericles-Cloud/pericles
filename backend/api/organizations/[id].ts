/**
 * Single Organization API Endpoint
 *
 * GET /api/organizations/:id - Get organization details
 * PATCH /api/organizations/:id - Update organization
 * DELETE /api/organizations/:id - Delete organization
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';
import { z } from 'zod';

const prisma = new PrismaClient();

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  emailDomains: z.array(z.string()).optional(),
  parentOrganizationId: z.string().uuid().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zipCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  website: z.string().url().nullable().optional(),
});

function formatOrganization(org: {
  id: string;
  name: string;
  email_domains: string[];
  is_root: boolean;
  parent_organization_id: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  phone_number: string | null;
  website: string | null;
  created_at: Date;
  updated_at: Date;
  _count: { users: number };
}, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST') {
  return {
    id: org.id,
    name: org.name,
    role,
    emailDomains: org.email_domains,
    isRoot: org.is_root,
    parentOrganizationId: org.parent_organization_id,
    addressLine1: org.address_line1,
    city: org.city,
    state: org.state,
    zipCode: org.zip_code,
    country: org.country,
    phoneNumber: org.phone_number,
    website: org.website,
    createdAt: org.created_at.toISOString(),
    updatedAt: org.updated_at.toISOString(),
    memberCount: org._count.users,
  };
}

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

    const userRole = accessResult.membership.role;

    if (req.method === 'GET') {
      const organization = await prisma.organization.findUnique({
        where: { id: orgId },
        include: {
          _count: {
            select: {
              users: { where: { status: 'active' } },
            },
          },
        },
      });

      if (!organization) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Organization not found' },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: formatOrganization(organization, userRole),
      });
      return;
    }

    if (req.method === 'PATCH') {
      // Only OWNER and ADMIN can update
      if (!['OWNER', 'ADMIN'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        });
        return;
      }

      const parseResult = UpdateOrgSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
        });
        return;
      }

      const { name, emailDomains, parentOrganizationId, addressLine1, city, state, zipCode, country, phoneNumber, website } = parseResult.data;

      const organization = await prisma.organization.update({
        where: { id: orgId },
        data: {
          ...(name !== undefined && { name }),
          ...(emailDomains !== undefined && { email_domains: emailDomains }),
          ...(parentOrganizationId !== undefined && { parent_organization_id: parentOrganizationId }),
          ...(addressLine1 !== undefined && { address_line1: addressLine1 }),
          ...(city !== undefined && { city }),
          ...(state !== undefined && { state }),
          ...(zipCode !== undefined && { zip_code: zipCode }),
          ...(country !== undefined && { country }),
          ...(phoneNumber !== undefined && { phone_number: phoneNumber }),
          ...(website !== undefined && { website }),
        },
        include: {
          _count: {
            select: {
              users: { where: { status: 'active' } },
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        data: formatOrganization(organization, userRole),
      });
      return;
    }

    if (req.method === 'DELETE') {
      // Only OWNER can delete
      if (userRole !== 'OWNER') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only owners can delete organizations' },
        });
        return;
      }

      // Delete all related data (cascading delete via Prisma)
      await prisma.organization.delete({
        where: { id: orgId },
      });

      res.status(200).json({
        success: true,
        data: { message: 'Organization deleted successfully' },
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET, PATCH, and DELETE requests are supported' },
    });
  } catch (error) {
    console.error('Organization endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
