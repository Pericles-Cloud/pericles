/**
 * CORS Utility for Vercel Serverless Functions
 *
 * Provides CORS headers and preflight handling for API endpoints.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://pericles.cloud',
  'https://www.pericles.cloud',
  'http://localhost:3000',
  'http://localhost:4111',
];

/**
 * Get the CORS origin header value based on the request origin.
 */
function getAllowedOrigin(req: VercelRequest): string {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }

  // Also check FRONTEND_URL env var
  const frontendUrl = process.env.FRONTEND_URL;
  if (origin && frontendUrl && origin === frontendUrl) {
    return origin;
  }

  // Default to the first allowed origin (for non-browser requests)
  return ALLOWED_ORIGINS[0];
}

/**
 * Set CORS headers on the response.
 */
export function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = getAllowedOrigin(req);

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, Origin'
  );
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
}

/**
 * Handle CORS preflight (OPTIONS) request.
 * Returns true if this was a preflight request and was handled.
 */
export function handleCorsPreflightAndSetHeaders(
  req: VercelRequest,
  res: VercelResponse
): boolean {
  // Always set CORS headers
  setCorsHeaders(req, res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }

  return false;
}
