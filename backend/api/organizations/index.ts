/**
 * Organizations API Endpoint
 *
 * GET /api/organizations - List user's organizations
 * POST /api/organizations - Create a new organization
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../src/auth';
import { z } from 'zod';

const prisma = new PrismaClient();

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
  emailDomains: z.array(z.string()).optional(),
  parentOrganizationId: z.string().uuid().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
  phoneNumber: z.string().optional(),
  website: z.string().url().optional(),
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

    if (req.method === 'GET') {
      // List user's organizations with full details
      const memberships = await prisma.userOrganization.findMany({
        where: {
          user_id: tokenPayload.userId,
          status: 'active',
        },
        include: {
          organization: {
            include: {
              _count: {
                select: {
                  users: { where: { status: 'active' } },
                },
              },
            },
          },
        },
      });

      const organizations = memberships.map((m) =>
        formatOrganization(m.organization, m.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST')
      );

      res.status(200).json({
        success: true,
        data: organizations,
      });
      return;
    }

    if (req.method === 'POST') {
      // Validate input
      const parseResult = CreateOrgSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
        });
        return;
      }

      const { name, emailDomains, parentOrganizationId, addressLine1, city, state, zipCode, country, phoneNumber, website } = parseResult.data;

      // Create organization with user as owner
      const organization = await prisma.organization.create({
        data: {
          name,
          email_domains: emailDomains || [],
          parent_organization_id: parentOrganizationId,
          address_line1: addressLine1,
          city,
          state,
          zip_code: zipCode,
          country,
          phone_number: phoneNumber,
          website,
          users: {
            create: {
              user_id: tokenPayload.userId,
              role: 'OWNER',
              status: 'active',
              accepted_at: new Date(),
            },
          },
        },
        include: {
          _count: {
            select: {
              users: { where: { status: 'active' } },
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        data: formatOrganization(organization, 'OWNER'),
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported' },
    });
  } catch (error) {
    console.error('Organizations endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
