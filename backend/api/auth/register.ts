/**
 * User Registration API Endpoint
 *
 * POST /api/auth/register
 * Body: { email: string, password: string, name?: string }
 *
 * Creates a new user account with email/password authentication.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import {
  RegisterSchema,
  hashPassword,
  generateTokenPair,
  hashToken,
  getRefreshTokenExpiry,
  logAuthEvent,
  extractIpAddress,
  extractUserAgent,
} from '../../src/auth/index.js';

const prisma = new PrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
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
    const validationResult = RegisterSchema.safeParse(req.body);
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

    const { email, password, name } = validationResult.data;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      await logAuthEvent({
        eventType: 'REGISTER',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        metadata: { email: email.toLowerCase() },
        errorMessage: 'Email already registered',
      });

      res.status(409).json({
        success: false,
        error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists' },
      });
      return;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password_hash: passwordHash,
        name: name || null,
        email_verified: false,
      },
    });

    // Generate tokens
    // Note: User won't have an organization initially - they'll need to be invited or create one
    const { accessToken, refreshToken, refreshTokenId: _refreshTokenId } = generateTokenPair({
      id: user.id,
      email: user.email,
      role: 'MEMBER',
      organizationId: '', // Empty until they join an organization
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

    // Log successful registration
    await logAuthEvent({
      userId: user.id,
      eventType: 'REGISTER',
      eventStatus: 'SUCCESS',
      ipAddress,
      userAgent,
    });

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatar_url,
        },
        organization: null,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);

    await logAuthEvent({
      eventType: 'REGISTER',
      eventStatus: 'FAILURE',
      ipAddress,
      userAgent,
      errorMessage: (error as Error).message,
    });

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
