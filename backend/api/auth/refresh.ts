/**
 * Token Refresh API Endpoint
 *
 * POST /api/auth/refresh
 * Body: { refreshToken: string }
 *
 * Exchanges a valid refresh token for a new token pair.
 * Implements token rotation - old refresh token is revoked.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import {
  RefreshTokenSchema,
  verifyRefreshToken,
  generateTokenPair,
  hashToken,
  getRefreshTokenExpiry,
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
    // Validate input
    const validationResult = RefreshTokenSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: validationResult.error.errors[0]?.message || 'Invalid input',
        },
      });
      return;
    }

    const { refreshToken } = validationResult.data;

    // Verify the refresh token JWT
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired refresh token' },
      });
      return;
    }

    // Find the token in database
    const tokenHash = hashToken(refreshToken);
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!storedToken) {
      // Token not in database - might be reuse attack
      await logAuthEvent({
        userId: payload.userId,
        eventType: 'TOKEN_REFRESH',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        errorMessage: 'Token not found in database (possible reuse)',
      });

      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
      });
      return;
    }

    // Check if token was revoked
    if (storedToken.revoked_at) {
      // Token was already used - this is a token reuse attack
      // Revoke ALL tokens for this user as a security measure
      await prisma.refreshToken.updateMany({
        where: { user_id: payload.userId },
        data: {
          revoked_at: new Date(),
          revoked_reason: 'security_revocation_token_reuse',
        },
      });

      await logAuthEvent({
        userId: payload.userId,
        eventType: 'TOKEN_REFRESH',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        errorMessage: 'Token reuse detected - all tokens revoked',
      });

      res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_REUSE',
          message: 'Security violation detected. Please login again.',
        },
      });
      return;
    }

    // Check if token is expired
    if (storedToken.expires_at < new Date()) {
      res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Refresh token has expired' },
      });
      return;
    }

    // Get user with organization
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { organization: true },
        },
      },
    });

    if (!user || user.status !== 'active') {
      res.status(401).json({
        success: false,
        error: { code: 'USER_INACTIVE', message: 'User account is not active' },
      });
      return;
    }

    // Revoke old token
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: {
        revoked_at: new Date(),
        revoked_reason: 'rotation',
      },
    });

    // Get primary organization
    const primaryMembership = user.memberships[0];

    // Generate new token pair
    const { accessToken, refreshToken: newRefreshToken, refreshTokenId: _refreshTokenId } = generateTokenPair({
      id: user.id,
      email: user.email,
      role: (primaryMembership?.role || 'MEMBER') as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
      organizationId: primaryMembership?.organization_id || '',
    });

    // Store new refresh token
    await prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: hashToken(newRefreshToken),
        device_info: userAgent,
        ip_address: ipAddress,
        expires_at: getRefreshTokenExpiry(),
      },
    });

    // Log successful refresh
    await logAuthEvent({
      userId: user.id,
      organizationId: primaryMembership?.organization_id,
      eventType: 'TOKEN_REFRESH',
      eventStatus: 'SUCCESS',
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    console.error('Token refresh error:', error);

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
