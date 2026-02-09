/**
 * Single Carrier API Endpoint
 *
 * GET /api/carriers/:id - Get carrier details
 * PATCH /api/carriers/:id - Update carrier
 * DELETE /api/carriers/:id - Delete carrier
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

function formatCarrier(c: {
  id: string;
  scac_code: string;
  name: string;
  total_shipments: number;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: c.id,
    scacCode: c.scac_code,
    name: c.name,
    totalShipments: c.total_shipments,
    createdAt: c.created_at.toISOString(),
    updatedAt: c.updated_at.toISOString(),
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

    const carrierId = req.query.id as string;

    if (!carrierId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Carrier ID is required' },
      });
      return;
    }

    const carrier = await prisma.carrier.findUnique({
      where: { id: carrierId },
    });

    if (!carrier) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Carrier not found' },
      });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({
        success: true,
        data: formatCarrier(carrier),
      });
      return;
    }

    if (req.method === 'PATCH') {
      const { scacCode, name } = req.body;

      // Check for SCAC code conflict if changing
      if (scacCode && scacCode !== carrier.scac_code) {
        const existing = await prisma.carrier.findUnique({
          where: { scac_code: scacCode },
        });

        if (existing) {
          res.status(409).json({
            success: false,
            error: { code: 'CONFLICT', message: 'A carrier with this SCAC code already exists' },
          });
          return;
        }
      }

      const updated = await prisma.carrier.update({
        where: { id: carrierId },
        data: {
          ...(scacCode !== undefined && { scac_code: scacCode }),
          ...(name !== undefined && { name }),
        },
      });

      res.status(200).json({
        success: true,
        data: formatCarrier(updated),
      });
      return;
    }

    if (req.method === 'DELETE') {
      await prisma.carrier.delete({ where: { id: carrierId } });

      res.status(200).json({
        success: true,
        data: { message: 'Carrier deleted successfully' },
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET, PATCH, and DELETE requests are supported' },
    });
  } catch (error) {
    console.error('Carrier endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
