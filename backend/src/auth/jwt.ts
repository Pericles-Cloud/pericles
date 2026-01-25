import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Use environment variables or defaults (longer for development convenience)
// Cast to StringValue type for jwt.sign compatibility
const ACCESS_TOKEN_EXPIRY = (process.env.JWT_ACCESS_TTL || '24h') as jwt.SignOptions['expiresIn'];
const REFRESH_TOKEN_EXPIRY = (process.env.JWT_REFRESH_TTL || '7d') as jwt.SignOptions['expiresIn'];

export interface AccessTokenPayload {
  userId: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  organizationId: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
  type: 'refresh';
}

interface TokenSecrets {
  accessSecret: string;
  refreshSecret: string;
}

function getSecrets(): TokenSecrets {
  const accessSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;

  if (!accessSecret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  if (!refreshSecret) {
    throw new Error('JWT_REFRESH_SECRET environment variable is not set');
  }

  return { accessSecret, refreshSecret };
}

/**
 * Generate an access token (default 24h, configurable via JWT_ACCESS_TTL).
 */
export function generateAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  const { accessSecret } = getSecrets();

  return jwt.sign(
    { ...payload, type: 'access' } as AccessTokenPayload,
    accessSecret,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Generate a refresh token (7 day expiry).
 * Returns both the token and its ID for database storage.
 */
export function generateRefreshToken(
  userId: string
): { token: string; tokenId: string } {
  const { refreshSecret } = getSecrets();
  const tokenId = crypto.randomUUID();

  const token = jwt.sign(
    { userId, tokenId, type: 'refresh' } as RefreshTokenPayload,
    refreshSecret,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );

  return { token, tokenId };
}

/**
 * Generate a token pair (access + refresh).
 */
export function generateTokenPair(user: {
  id: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  organizationId: string;
}): { accessToken: string; refreshToken: string; refreshTokenId: string } {
  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  });

  const { token: refreshToken, tokenId: refreshTokenId } = generateRefreshToken(user.id);

  return { accessToken, refreshToken, refreshTokenId };
}

/**
 * Verify and decode an access token.
 * Returns null if invalid or expired.
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const { accessSecret } = getSecrets();
    const decoded = jwt.verify(token, accessSecret) as AccessTokenPayload;

    if (decoded.type !== 'access') {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

/**
 * Verify and decode a refresh token.
 * Returns null if invalid or expired.
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const { refreshSecret } = getSecrets();
    const decoded = jwt.verify(token, refreshSecret) as RefreshTokenPayload;

    if (decoded.type !== 'refresh') {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

/**
 * Hash a refresh token for secure database storage.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Calculate the expiration date for a refresh token (7 days from now).
 */
export function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}
