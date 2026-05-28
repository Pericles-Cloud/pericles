/**
 * Single Supplier API Endpoint
 *
 * GET /api/suppliers/:id - Get supplier details
 * PATCH /api/suppliers/:id - Update supplier
 * DELETE /api/suppliers/:id - Delete supplier
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

    const supplierId = req.query.id as string;

    if (!supplierId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Supplier ID is required' },
      });
      return;
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Supplier not found' },
      });
      return;
    }

    // Verify user has access to this organization
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, supplier.organization_id);

    if (!accessResult.hasAccess) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Supplier not found' },
      });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({
        success: true,
        data: formatSupplier(supplier),
      });
      return;
    }

    // Write operations require OWNER or ADMIN
    if (!['OWNER', 'ADMIN'].includes(accessResult.membership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      });
      return;
    }

    if (req.method === 'PATCH') {
      const {
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

      const updated = await prisma.supplier.update({
        where: { id: supplierId },
        data: {
          ...(name !== undefined && { name }),
          ...(address !== undefined && { address }),
          ...(website !== undefined && { website }),
          ...(contactInfo !== undefined && { contact_info: contactInfo }),
          ...(country !== undefined && { country }),
          ...(countryCode !== undefined && { country_code: countryCode }),
          ...(latitude !== undefined && { latitude }),
          ...(longitude !== undefined && { longitude }),
          ...(notifyPartyName !== undefined && { notify_party_name: notifyPartyName }),
          ...(notifyPartyAddress !== undefined && { notify_party_address: notifyPartyAddress }),
        },
      });

      res.status(200).json({
        success: true,
        data: formatSupplier(updated),
      });
      return;
    }

    if (req.method === 'DELETE') {
      await prisma.supplier.delete({ where: { id: supplierId } });

      res.status(200).json({
        success: true,
        data: { message: 'Supplier deleted successfully' },
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET, PATCH, and DELETE requests are supported' },
    });
  } catch (error) {
    console.error('Supplier endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
