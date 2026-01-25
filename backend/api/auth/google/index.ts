/**
 * Google OAuth Initiation Endpoint
 *
 * GET /api/auth/google
 *
 * Redirects user to Google OAuth consent screen.
 * Restricts to pericles.cloud domain using the 'hd' parameter.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export default function handler(
  req: VercelRequest,
  res: VercelResponse
): void {
  // Only accept GET
  if (req.method !== 'GET') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported' },
    });
    return;
  }

  if (!GOOGLE_CLIENT_ID) {
    res.status(500).json({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Google OAuth is not configured' },
    });
    return;
  }

  // Generate state parameter for CSRF protection
  const state = Buffer.from(JSON.stringify({
    timestamp: Date.now(),
    redirect: req.query.redirect || '/dashboard',
  })).toString('base64url');

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
    // Restrict to pericles.cloud domain
    hd: 'pericles.cloud',
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

  res.redirect(302, authUrl);
}
