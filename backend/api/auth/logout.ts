/**
 * User Logout API Endpoint
 *
 * POST /api/auth/logout
 * Auth: Bearer token required
 *
 * Invalidates all refresh tokens for the current user.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import {
  authenticateRequest,
  logAuthEvent,
  extractIpAddress,
  extractUserAgent,
} from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  // Only accept POST
  if (req.method !== 'POST') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported' },
    });
    return;
  }

  const ipAddress = extractIpAddress(req.headers as Record<string, string | undefined>);
  const userAgent = extractUserAgent(req.headers as Record<string, string | undefined>);

  try {
    // Authenticate request
    const user = authenticateRequest(req);

    if (!user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    // Revoke all refresh tokens for this user
    await prisma.refreshToken.updateMany({
      where: {
        user_id: user.userId,
        revoked_at: null,
      },
      data: {
        revoked_at: new Date(),
        revoked_reason: 'logout',
      },
    });

    // Log logout event
    await logAuthEvent({
      userId: user.userId,
      organizationId: user.organizationId || undefined,
      eventType: 'LOGOUT',
      eventStatus: 'SUCCESS',
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      success: true,
      data: { message: 'Successfully logged out' },
    });
  } catch (error) {
    console.error('Logout error:', error);

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
