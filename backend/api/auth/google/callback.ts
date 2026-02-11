/**
 * Google OAuth Callback Endpoint
 *
 * GET /api/auth/google/callback
 *
 * Handles the OAuth callback from Google.
 * Verifies the ID token and creates/links user account.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuth2Client } from 'google-auth-library';
import { PrismaClient } from '@prisma/client';
import {
  generateTokenPair,
  hashToken,
  getRefreshTokenExpiry,
  logAuthEvent,
  extractIpAddress,
  extractUserAgent,
} from '../../../src/auth/index.js';

const prisma = new PrismaClient();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

interface GoogleUserInfo {
  sub: string;        // Google user ID
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  hd?: string;        // Hosted domain (pericles.cloud)
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only accept GET
  if (req.method !== 'GET') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported' },
    });
    return;
  }

  const ipAddress = extractIpAddress(req.headers as Record<string, string | undefined>);
  const userAgent = extractUserAgent(req.headers as Record<string, string | undefined>);

  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  // Handle OAuth errors
  if (error) {
    console.error('Google OAuth error:', error);
    res.redirect(`${FRONTEND_URL}/login?error=oauth_denied`);
    return;
  }

  if (!code) {
    res.redirect(`${FRONTEND_URL}/login?error=missing_code`);
    return;
  }

  try {
    // Parse state to get redirect URL
    let redirectPath = '/dashboard';
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
        redirectPath = stateData.redirect || '/dashboard';
      } catch {
        // Invalid state, use default redirect
      }
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.id_token) {
      throw new Error('No ID token received from Google');
    }

    // Verify the ID token
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error('Invalid ID token payload');
    }

    const googleUser: GoogleUserInfo = {
      sub: payload.sub,
      email: payload.email || '',
      email_verified: payload.email_verified || false,
      name: payload.name,
      picture: payload.picture,
      hd: payload.hd,
    };

    // Verify domain restriction
    if (googleUser.hd !== 'pericles.cloud') {
      await logAuthEvent({
        eventType: 'GOOGLE_SSO_LOGIN',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        metadata: { email: googleUser.email, domain: googleUser.hd },
        errorMessage: 'Domain not allowed',
      });

      res.redirect(`${FRONTEND_URL}/login?error=domain_not_allowed`);
      return;
    }

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { google_id: googleUser.sub },
          { email: googleUser.email.toLowerCase() },
        ],
      },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { organization: true },
        },
      },
    });

    if (user) {
      // Update Google info if needed
      if (!user.google_id || user.google_avatar_url !== googleUser.picture) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            google_id: googleUser.sub,
            google_avatar_url: googleUser.picture,
            email_verified: true,
            last_login_at: new Date(),
            // Update name if not set
            name: user.name || googleUser.name,
          },
        });
      } else {
        await prisma.user.update({
          where: { id: user.id },
          data: { last_login_at: new Date() },
        });
      }

      // If user has no active memberships, try to assign to matching organization
      // Pericles domain users get OWNER role for full platform access
      if (user.memberships.length === 0 && googleUser.hd) {
        const matchingOrg = await prisma.organization.findFirst({
          where: {
            email_domains: { has: googleUser.hd },
          },
        });

        if (matchingOrg) {
          await prisma.userOrganization.create({
            data: {
              user_id: user.id,
              organization_id: matchingOrg.id,
              role: 'OWNER',
              status: 'active',
            },
          });

          // Refetch user with new membership
          user = await prisma.user.findUnique({
            where: { id: user.id },
            include: {
              memberships: {
                where: { status: 'active' },
                include: { organization: true },
              },
            },
          });

          if (!user) {
            throw new Error('User not found after membership creation');
          }
        }
      }

      await logAuthEvent({
        userId: user.id,
        organizationId: user.memberships[0]?.organization_id,
        eventType: 'GOOGLE_SSO_LOGIN',
        eventStatus: 'SUCCESS',
        ipAddress,
        userAgent,
      });
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          email: googleUser.email.toLowerCase(),
          email_verified: true,
          google_id: googleUser.sub,
          google_avatar_url: googleUser.picture,
          name: googleUser.name,
          last_login_at: new Date(),
        },
        include: {
          memberships: {
            where: { status: 'active' },
            include: { organization: true },
          },
        },
      });

      // Auto-assign new user to organization matching their email domain
      // Pericles domain users get OWNER role for full platform access
      if (googleUser.hd) {
        const matchingOrg = await prisma.organization.findFirst({
          where: {
            email_domains: { has: googleUser.hd },
          },
        });

        if (matchingOrg) {
          await prisma.userOrganization.create({
            data: {
              user_id: user.id,
              organization_id: matchingOrg.id,
              role: 'OWNER',
              status: 'active',
            },
          });

          // Refetch user with new membership
          user = await prisma.user.findUnique({
            where: { id: user.id },
            include: {
              memberships: {
                where: { status: 'active' },
                include: { organization: true },
              },
            },
          });

          if (!user) {
            throw new Error('User not found after membership creation');
          }
        }
      }

      await logAuthEvent({
        userId: user.id,
        organizationId: user.memberships[0]?.organization_id,
        eventType: 'REGISTER',
        eventStatus: 'SUCCESS',
        ipAddress,
        userAgent,
        metadata: { method: 'google_sso' },
      });

      await logAuthEvent({
        userId: user.id,
        organizationId: user.memberships[0]?.organization_id,
        eventType: 'GOOGLE_SSO_LOGIN',
        eventStatus: 'SUCCESS',
        ipAddress,
        userAgent,
      });
    }

    // Get primary organization
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

    // Redirect to frontend with tokens in URL fragment
    // Note: In production, you might want to use a more secure method
    // like setting httpOnly cookies or a short-lived code exchange
    const redirectUrl = new URL(`${FRONTEND_URL}/auth/callback`);
    redirectUrl.searchParams.set('accessToken', accessToken);
    redirectUrl.searchParams.set('refreshToken', refreshToken);
    redirectUrl.searchParams.set('redirect', redirectPath);

    res.redirect(302, redirectUrl.toString());
  } catch (error) {
    console.error('Google OAuth callback error:', error);

    await logAuthEvent({
      eventType: 'GOOGLE_SSO_LOGIN',
      eventStatus: 'FAILURE',
      ipAddress,
      userAgent,
      errorMessage: (error as Error).message,
    });

    res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
  }
}
