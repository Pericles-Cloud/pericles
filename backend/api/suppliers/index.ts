/**
 * Suppliers API Endpoint
 *
 * GET /api/suppliers - List suppliers for user's organizations
 * POST /api/suppliers - Create a new supplier
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

function formatSupplier(s: {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  website: string | null;
  contact_info: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  total_shipments: number;
  destination_ports: string[] | null;
  departure_ports: string[] | null;
  hs_codes: string[] | null;
  notify_party_name: string | null;
  notify_party_address: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: s.id,
    organizationId: s.organization_id,
    name: s.name,
    address: s.address,
    website: s.website,
    contactInfo: s.contact_info,
    country: s.country,
    countryCode: s.country_code,
    latitude: s.latitude,
    longitude: s.longitude,
    totalShipments: s.total_shipments,
    destinationPorts: s.destination_ports,
    departurePorts: s.departure_ports,
    hsCodes: s.hs_codes,
    notifyPartyName: s.notify_party_name,
    notifyPartyAddress: s.notify_party_address,
    createdAt: s.created_at.toISOString(),
    updatedAt: s.updated_at.toISOString(),
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

    if (req.method === 'GET') {
      // Check if user is a member of the root organization
      const rootMembership = await prisma.userOrganization.findFirst({
        where: {
          user_id: tokenPayload.userId,
          status: 'active',
          organization: { is_root: true },
        },
      });

      let orgIds: string[];

      if (rootMembership) {
        // Root org members can see all suppliers
        const allOrgs = await prisma.organization.findMany({ select: { id: true } });
        orgIds = allOrgs.map(o => o.id);
      } else {
        // Regular users only see suppliers from their orgs
        const memberships = await prisma.userOrganization.findMany({
          where: { user_id: tokenPayload.userId, status: 'active' },
          select: { organization_id: true },
        });
        orgIds = memberships.map(m => m.organization_id);
      }

      const suppliers = await prisma.supplier.findMany({
        where: { organization_id: { in: orgIds } },
        orderBy: { name: 'asc' },
      });

      res.status(200).json({
        success: true,
        data: suppliers.map(formatSupplier),
      });
      return;
    }

    if (req.method === 'POST') {
      const {
        organizationId,
        name,
        address,
        website,
        contactInfo,
        country,
        countryCode,
        latitude,
        longitude,
        notifyPartyName,
        notifyPartyAddress,
      } = req.body;

      if (!organizationId || !name) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'organizationId and name are required' },
        });
        return;
      }

      // Verify user has access to this organization (direct membership or root org member)
      const accessResult = await checkOrganizationAccess(tokenPayload.userId, organizationId);

      if (!accessResult.hasAccess || !['OWNER', 'ADMIN'].includes(accessResult.membership.role)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        });
        return;
      }

      const supplier = await prisma.supplier.create({
        data: {
          id: crypto.randomUUID(),
          organization: { connect: { id: organizationId } },
          name,
          address,
          website,
          contact_info: contactInfo,
          country,
          country_code: countryCode,
          latitude,
          longitude,
          notify_party_name: notifyPartyName,
          notify_party_address: notifyPartyAddress,
        },
      });

      res.status(201).json({
        success: true,
        data: formatSupplier(supplier),
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported' },
    });
  } catch (error) {
    console.error('Suppliers endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
