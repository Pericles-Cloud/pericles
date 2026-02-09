/**
 * Carriers API Endpoint
 *
 * GET /api/carriers - List all carriers
 * POST /api/carriers - Create a new carrier
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

    if (req.method === 'GET') {
      const carriers = await prisma.carrier.findMany({
        orderBy: { name: 'asc' },
      });

      res.status(200).json({
        success: true,
        data: carriers.map(formatCarrier),
      });
      return;
    }

    if (req.method === 'POST') {
      const { scacCode, name } = req.body;

      if (!scacCode || !name) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'scacCode and name are required' },
        });
        return;
      }

      // Check if SCAC code already exists
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

      const carrier = await prisma.carrier.create({
        data: {
          id: crypto.randomUUID(),
          scac_code: scacCode,
          name,
        },
      });

      res.status(201).json({
        success: true,
        data: formatCarrier(carrier),
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported' },
    });
  } catch (error) {
    console.error('Carriers endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
