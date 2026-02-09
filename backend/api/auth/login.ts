/**
 * User Login API Endpoint
 *
 * POST /api/auth/login
 * Body: { email: string, password: string }
 *
 * Authenticates user with email/password and returns tokens.
 * Implements account lockout after 5 failed attempts (15 min lockout).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import {
  LoginSchema,
  verifyPassword,
  generateTokenPair,
  hashToken,
  getRefreshTokenExpiry,
  logAuthEvent,
  extractIpAddress,
  extractUserAgent,
} from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

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
    const validationResult = LoginSchema.safeParse(req.body);
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

    const { email, password } = validationResult.data;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { organization: true },
        },
      },
    });

    if (!user) {
      await logAuthEvent({
        eventType: 'LOGIN_FAILED',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        metadata: { email: email.toLowerCase() },
        errorMessage: 'User not found',
      });

      // Generic message to prevent user enumeration
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }

    // Check if account is locked
    if (user.locked_until && user.locked_until > new Date()) {
      await logAuthEvent({
        userId: user.id,
        eventType: 'LOGIN_FAILED',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        errorMessage: 'Account locked',
      });

      const remainingMs = user.locked_until.getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);

      res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: `Account is locked. Try again in ${remainingMin} minute(s)`,
        },
      });
      return;
    }

    // Check if user has a password (might be Google SSO only)
    if (!user.password_hash) {
      await logAuthEvent({
        userId: user.id,
        eventType: 'LOGIN_FAILED',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        errorMessage: 'No password set (SSO user)',
      });

      res.status(401).json({
        success: false,
        error: {
          code: 'SSO_ONLY',
          message: 'This account uses Google Sign-In. Please login with Google.',
        },
      });
      return;
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);

    if (!passwordValid) {
      // Increment failed attempts
      const newAttempts = user.failed_login_attempts + 1;
      const shouldLock = newAttempts >= MAX_LOGIN_ATTEMPTS;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failed_login_attempts: newAttempts,
          locked_until: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
        },
      });

      await logAuthEvent({
        userId: user.id,
        eventType: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        metadata: { attempt: newAttempts },
        errorMessage: shouldLock ? 'Account locked due to failed attempts' : 'Invalid password',
      });

      if (shouldLock) {
        res.status(403).json({
          success: false,
          error: {
            code: 'ACCOUNT_LOCKED',
            message: 'Account locked due to too many failed attempts. Try again in 15 minutes.',
          },
        });
        return;
      }

      const attemptsRemaining = MAX_LOGIN_ATTEMPTS - newAttempts;
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: `Invalid email or password. ${attemptsRemaining} attempt(s) remaining.`,
        },
      });
      return;
    }

    // Successful login - reset failed attempts
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date(),
      },
    });

    // Get primary organization (first active membership)
    const primaryMembership = user.memberships[0];

    // Generate tokens
    const { accessToken, refreshToken, refreshTokenId: _refreshTokenId } = generateTokenPair({
      id: user.id,
      email: user.email,
      role: (primaryMembership?.role || 'MEMBER') as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
      organizationId: primaryMembership?.organization_id || '',
    });

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: hashToken(refreshToken),
        device_info: userAgent,
        ip_address: ipAddress,
        expires_at: getRefreshTokenExpiry(),
      },
    });

    // Log successful login
    await logAuthEvent({
      userId: user.id,
      organizationId: primaryMembership?.organization_id,
      eventType: 'LOGIN',
      eventStatus: 'SUCCESS',
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatar_url,
        },
        organization: primaryMembership
          ? {
              id: primaryMembership.organization_id,
              name: primaryMembership.organization.name,
              role: primaryMembership.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
            }
          : null,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Login error:', error);

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
