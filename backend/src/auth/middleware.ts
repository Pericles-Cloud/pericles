import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAccessToken, type AccessTokenPayload } from './jwt';

/**
 * Minimal request interface for authentication.
 * Compatible with both Express Request and VercelRequest.
 */
interface AuthenticatableRequest {
  headers: {
    authorization?: string;
  };
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Authentication middleware for protected endpoints.
 * Verifies JWT access token and returns the decoded payload.
 * Works with both Express Request and VercelRequest.
 */
export function authenticateRequest(
  req: AuthenticatableRequest
): AccessTokenPayload | null {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return null;
  }

  return verifyAccessToken(token);
}

type AuthHandler = (
  req: VercelRequest,
  res: VercelResponse,
  user: AccessTokenPayload
) => Promise<void>;

/**
 * Higher-order function to wrap handlers with authentication.
 * Returns 401 if not authenticated.
 */
export function withAuth(handler: AuthHandler) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    const user = authenticateRequest(req);

    if (!user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    await handler(req, res, user);
  };
}

/**
 * Require specific roles for an endpoint.
 */
export function requireRole(
  allowedRoles: Array<'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST'>
) {
  return (handler: AuthHandler) => {
    return withAuth(async (req, res, user) => {
      if (!allowedRoles.includes(user.role)) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions',
          },
        });
        return;
      }

      await handler(req, res, user);
    });
  };
}
