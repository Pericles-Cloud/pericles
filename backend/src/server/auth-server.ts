/**
 * Auth API Server
 *
 * Express server for authentication endpoints.
 * Runs alongside the Mastra dev server on port 4112.
 * Includes WebSocket server for workflow collaboration.
 */

// Load .env.local from project root, overriding any system environment variables
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true });

import express, { type Request, type Response } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initializeWorkflowSocket } from './workflow-socket.js';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import type { Prisma, ExecutionMode, NodeType } from '@prisma/client';
import {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
  UpdateProfileSchema,
  UpdatePasswordSchema,
  hashPassword,
  verifyPassword,
  generateTokenPair,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
  logAuthEvent,
  authenticateRequest,
  checkOrganizationAccess,
} from '../auth/index.js';
import { getPositionFeed, getOrganizationPositions } from '../integrations/tracking/index.js';
import { OAuth2Client } from 'google-auth-library';
import { createWorkflowExecutionService, type ExecutionMode as WorkflowExecutionMode } from '../workflow/index.js';
import { mastra } from '../mastra/index.js';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.AUTH_PORT || 4112;

// Parse CORS origins from environment variable (comma-separated)
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:3000', 'http://localhost:4111'];

// Middleware
app.use(cors({
  origin: CORS_ORIGINS,
  credentials: true,
}));
app.use(express.json());

// Constants
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// =============================================================================
// Rate Limiting (In-Memory)
// For production, consider using Redis-backed rate limiting
// =============================================================================
interface RateLimitEntry {
  count: number;
  firstRequest: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 20; // 20 requests per window for auth endpoints
const RATE_LIMIT_STRICT_MAX = 5; // 5 requests per window for login/register

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.firstRequest > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

function getRateLimitKey(req: Request, routeKey?: string): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]).trim()
    : req.ip || 'unknown';
  // req.path is the RESOLVED request path (e.g. /api/events/abc123/ask), not
  // the route pattern (/api/events/:id/ask) — every existing caller of this
  // function is a static path, so that's harmless there, but a route with a
  // dynamic segment gets a separate bucket PER segment value, not one bucket
  // per client. routeKey lets a caller with a dynamic path opt into a fixed
  // logical name instead (see eventQaRateLimit below).
  return `rate:${ip}:${routeKey ?? req.path}`;
}

function checkRateLimit(req: Request, res: Response, maxRequests: number, routeKey?: string): boolean {
  const key = getRateLimitKey(req, routeKey);
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.firstRequest > RATE_LIMIT_WINDOW_MS) {
    // Start new window
    rateLimitStore.set(key, { count: 1, firstRequest: now });
    return true;
  }

  if (entry.count >= maxRequests) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.firstRequest)) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
      },
    });
    return false;
  }

  entry.count++;
  return true;
}

// Rate limit middleware for strict endpoints (login, register)
function strictRateLimit(req: Request, res: Response, next: () => void): void {
  if (checkRateLimit(req, res, RATE_LIMIT_STRICT_MAX)) {
    next();
  }
}

// Rate limit middleware for general auth endpoints
function authRateLimit(req: Request, res: Response, next: () => void): void {
  if (checkRateLimit(req, res, RATE_LIMIT_MAX_REQUESTS)) {
    next();
  }
}

// Rate limit for the event Q&A endpoint (#23) — every request triggers a
// real LLM call, unlike most other routes in this file which are plain DB
// reads/writes with no per-request external cost. Fixed routeKey ('event-qa'),
// NOT the default req.path: this route has a dynamic :id segment, and without
// a fixed key each distinct event id gets its own independent 10-request
// bucket — trivially bypassing the cap by round-robining event ids.
const RATE_LIMIT_EVENT_QA_MAX = 10;
function eventQaRateLimit(req: Request, res: Response, next: () => void): void {
  if (checkRateLimit(req, res, RATE_LIMIT_EVENT_QA_MAX, 'event-qa')) {
    next();
  }
}

// Google OAuth config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

const oauth2Client = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
  ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
  : null;

// Helper to extract request info
function getRequestInfo(req: Request) {
  const forwarded = req.headers['x-forwarded-for'];
  const ipAddress = forwarded
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]).trim()
    : req.ip;
  const userAgent = req.headers['user-agent'];
  return { ipAddress, userAgent };
}

// =============================================================================
// CSRF Protection Middleware
// Validates Origin/Referer header for state-changing requests
// =============================================================================
function csrfProtection(req: Request, res: Response, next: () => void): void {
  // Skip CSRF check for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // Check if origin or referer is from an allowed domain
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);

  if (!checkOrigin) {
    // For API clients without browser origin, require Authorization header
    if (req.headers.authorization) {
      next();
      return;
    }
    res.status(403).json({
      success: false,
      error: { code: 'CSRF_VALIDATION_FAILED', message: 'Missing origin header' },
    });
    return;
  }

  // Verify origin is in our allowed list
  if (!CORS_ORIGINS.includes(checkOrigin)) {
    console.warn(`[CSRF] Blocked request from unauthorized origin: ${checkOrigin}`);
    res.status(403).json({
      success: false,
      error: { code: 'CSRF_VALIDATION_FAILED', message: 'Invalid origin' },
    });
    return;
  }

  next();
}

// Apply CSRF protection to all routes
app.use(csrfProtection);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'auth-server' });
});

// Register (with strict rate limiting)
app.post('/api/auth/register', strictRateLimit, async (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getRequestInfo(req);

  try {
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

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password_hash: passwordHash,
        name: name || null,
        email_verified: false,
      },
    });

    const { accessToken, refreshToken, refreshTokenId: _refreshTokenId } = generateTokenPair({
      id: user.id,
      email: user.email,
      role: 'MEMBER',
      organizationId: '',
    });

    await prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: hashToken(refreshToken),
        device_info: userAgent,
        ip_address: ipAddress,
        expires_at: getRefreshTokenExpiry(),
      },
    });

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
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
});

// Login (with strict rate limiting)
app.post('/api/auth/login', strictRateLimit, async (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getRequestInfo(req);

  try {
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

      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }

    // Check if user is from a pericles domain - they must use SSO
    const periclesDomains = ['pericles.cloud', 'pericles.ai'];
    const userDomain = user.email.split('@')[1]?.toLowerCase();
    if (periclesDomains.includes(userDomain)) {
      await logAuthEvent({
        userId: user.id,
        eventType: 'LOGIN_FAILED',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        errorMessage: 'Pericles domain users must use Google SSO',
      });

      res.status(401).json({
        success: false,
        error: {
          code: 'SSO_REQUIRED',
          message: 'Pericles users must sign in with Google. Please use the "Sign in with Google" button.',
        },
      });
      return;
    }

    if (user.locked_until && user.locked_until > new Date()) {
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

    if (!user.password_hash) {
      res.status(401).json({
        success: false,
        error: {
          code: 'SSO_ONLY',
          message: 'This account uses Google Sign-In. Please login with Google.',
        },
      });
      return;
    }

    const passwordValid = await verifyPassword(password, user.password_hash);

    if (!passwordValid) {
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

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date(),
      },
    });

    const primaryMembership = user.memberships[0];

    const { accessToken, refreshToken, refreshTokenId: _refreshTokenId } = generateTokenPair({
      id: user.id,
      email: user.email,
      role: (primaryMembership?.role || 'MEMBER') as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
      organizationId: primaryMembership?.organization_id || '',
    });

    await prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: hashToken(refreshToken),
        device_info: userAgent,
        ip_address: ipAddress,
        expires_at: getRefreshTokenExpiry(),
      },
    });

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
              role: primaryMembership.role,
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
});

// Logout
app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getRequestInfo(req);

  try {
    const user = authenticateRequest(req);

    if (!user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

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
});

// Refresh token (with auth rate limiting)
app.post('/api/auth/refresh', authRateLimit, async (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getRequestInfo(req);

  try {
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

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired refresh token' },
      });
      return;
    }

    const tokenHash = hashToken(refreshToken);
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!storedToken) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
      });
      return;
    }

    if (storedToken.revoked_at) {
      await prisma.refreshToken.updateMany({
        where: { user_id: payload.userId },
        data: {
          revoked_at: new Date(),
          revoked_reason: 'security_revocation_token_reuse',
        },
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

    if (storedToken.expires_at < new Date()) {
      res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Refresh token has expired' },
      });
      return;
    }

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

    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: {
        revoked_at: new Date(),
        revoked_reason: 'rotation',
      },
    });

    const primaryMembership = user.memberships[0];

    const { accessToken, refreshToken: newRefreshToken, refreshTokenId: _refreshTokenId } = generateTokenPair({
      id: user.id,
      email: user.email,
      role: (primaryMembership?.role || 'MEMBER') as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
      organizationId: primaryMembership?.organization_id || '',
    });

    await prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: hashToken(newRefreshToken),
        device_info: userAgent,
        ip_address: ipAddress,
        expires_at: getRefreshTokenExpiry(),
      },
    });

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
});

// Get current user
app.get('/api/auth/me', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);

    if (!tokenPayload) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: tokenPayload.userId },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { organization: true },
        },
      },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({
        success: false,
        error: { code: 'USER_INACTIVE', message: 'User account is not active' },
      });
      return;
    }

    // Check if user is a member of the root organization (pericles.cloud users)
    const rootMembership = user.memberships.find((m) => m.organization.is_root);

    // Root org users can see and switch to ALL organizations
    let organizations: Array<{ id: string; name: string; role: string }>;

    if (rootMembership) {
      const allOrganizations = await prisma.organization.findMany({
        orderBy: [{ is_root: 'desc' }, { name: 'asc' }],
      });

      // Root org users get their root org role for all organizations they can access
      organizations = allOrganizations.map((org) => ({
        id: org.id,
        name: org.name,
        role: rootMembership.role,
      }));
    } else {
      // Regular users only see their own memberships
      organizations = user.memberships.map((m) => ({
        id: m.organization_id,
        name: m.organization.name,
        role: m.role,
      }));
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatar_url || user.google_avatar_url,
          emailVerified: user.email_verified,
        },
        organizations,
      },
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
});

// Update profile (name / avatar URL)
app.patch('/api/auth/profile', async (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getRequestInfo(req);

  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const validationResult = UpdateProfileSchema.safeParse(req.body);
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

    const { name, avatarUrl } = validationResult.data;

    const existing = await prisma.user.findUnique({
      where: { id: tokenPayload.userId },
    });
    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
      return;
    }
    if (existing.status !== 'active') {
      res.status(403).json({
        success: false,
        error: { code: 'USER_INACTIVE', message: 'User account is not active' },
      });
      return;
    }

    const updateData: Prisma.UserUpdateInput = {};
    if (name !== undefined) updateData.name = name;
    if (avatarUrl !== undefined) updateData.avatar_url = avatarUrl;

    const user = await prisma.user.update({
      where: { id: tokenPayload.userId },
      data: updateData,
    });

    await logAuthEvent({
      userId: user.id,
      organizationId: tokenPayload.organizationId || undefined,
      eventType: 'PROFILE_UPDATE',
      eventStatus: 'SUCCESS',
      ipAddress,
      userAgent,
      metadata: { fields: Object.keys(updateData) },
    });

    res.status(200).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url || user.google_avatar_url,
        emailVerified: user.email_verified,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
});

// Update password (authenticated change - requires current password)
app.post('/api/auth/password', async (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getRequestInfo(req);

  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const validationResult = UpdatePasswordSchema.safeParse(req.body);
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

    const { currentPassword, newPassword } = validationResult.data;

    const user = await prisma.user.findUnique({
      where: { id: tokenPayload.userId },
    });
    if (!user) {
      res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
      return;
    }
    if (user.status !== 'active') {
      res.status(403).json({
        success: false,
        error: { code: 'USER_INACTIVE', message: 'User account is not active' },
      });
      return;
    }

    // OAuth-only accounts have no password to change
    if (!user.password_hash) {
      res.status(400).json({
        success: false,
        error: {
          code: 'NO_PASSWORD_SET',
          message: 'Password change is not available for accounts without a password (e.g. Google sign-in)',
        },
      });
      return;
    }

    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
      await logAuthEvent({
        userId: user.id,
        organizationId: tokenPayload.organizationId || undefined,
        eventType: 'PASSWORD_CHANGE',
        eventStatus: 'FAILURE',
        ipAddress,
        userAgent,
        errorMessage: 'Incorrect current password',
      });
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' },
      });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({
        success: false,
        error: {
          code: 'SAME_PASSWORD',
          message: 'New password must be different from the current password',
        },
      });
      return;
    }

    const newHash = await hashPassword(newPassword);

    // Update the hash and revoke all refresh tokens so every session must re-authenticate.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password_hash: newHash },
      }),
      prisma.refreshToken.updateMany({
        where: { user_id: user.id, revoked_at: null },
        data: { revoked_at: new Date(), revoked_reason: 'password_change' },
      }),
    ]);

    await logAuthEvent({
      userId: user.id,
      organizationId: tokenPayload.organizationId || undefined,
      eventType: 'PASSWORD_CHANGE',
      eventStatus: 'SUCCESS',
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      success: true,
      data: { message: 'Password updated successfully' },
    });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
});

// Delete account (soft delete - preserves audit trail)
app.delete('/api/auth/account', async (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getRequestInfo(req);

  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: tokenPayload.userId },
      include: {
        memberships: { where: { status: 'active', role: 'OWNER' } },
      },
    });

    if (!user || user.status === 'deleted') {
      res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
      return;
    }

    // Fail secure: block deletion if the user is the sole active OWNER of any
    // organization, which would otherwise orphan that tenant.
    for (const membership of user.memberships) {
      const otherOwners = await prisma.userOrganization.count({
        where: {
          organization_id: membership.organization_id,
          role: 'OWNER',
          status: 'active',
          user_id: { not: user.id },
        },
      });
      if (otherOwners === 0) {
        res.status(409).json({
          success: false,
          error: {
            code: 'SOLE_OWNER',
            message:
              'You are the sole owner of one or more organizations. Transfer ownership before deleting your account.',
          },
        });
        return;
      }
    }

    // Soft delete: mark the user deleted, suspend memberships, and revoke all
    // refresh tokens. The User row is retained so the audit trail stays intact.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { status: 'deleted' },
      }),
      prisma.userOrganization.updateMany({
        where: { user_id: user.id, status: 'active' },
        data: { status: 'suspended' },
      }),
      prisma.refreshToken.updateMany({
        where: { user_id: user.id, revoked_at: null },
        data: { revoked_at: new Date(), revoked_reason: 'account_deleted' },
      }),
    ]);

    await logAuthEvent({
      userId: user.id,
      organizationId: tokenPayload.organizationId || undefined,
      eventType: 'ACCOUNT_DELETED',
      eventStatus: 'SUCCESS',
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      success: true,
      data: { message: 'Account deleted successfully' },
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
});

// Google OAuth - Initiate
app.get('/api/auth/google', (req: Request, res: Response) => {
  if (!GOOGLE_CLIENT_ID) {
    res.status(500).json({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Google OAuth is not configured' },
    });
    return;
  }

  const state = Buffer.from(JSON.stringify({
    timestamp: Date.now(),
    redirect: req.query.redirect || '/dashboard',
  })).toString('base64url');

  // Note: We don't use the 'hd' parameter here because we want to allow multiple
  // domains (pericles.cloud and pericles.ai). Domain validation is done in the callback.
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account', // Allow selecting account instead of forcing consent every time
    state,
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  res.redirect(302, authUrl);
});

// Google OAuth - Callback
app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getRequestInfo(req);
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  if (error) {
    console.error('Google OAuth error:', error);
    res.redirect(`${FRONTEND_URL}/login?error=oauth_denied`);
    return;
  }

  if (!code) {
    res.redirect(`${FRONTEND_URL}/login?error=missing_code`);
    return;
  }

  if (!oauth2Client) {
    res.redirect(`${FRONTEND_URL}/login?error=oauth_not_configured`);
    return;
  }

  try {
    let redirectPath = '/dashboard';
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
        const requestedPath = stateData.redirect || '/dashboard';
        // SECURITY: Validate redirect is a relative path only (prevent open redirect)
        if (typeof requestedPath === 'string' &&
            requestedPath.startsWith('/') &&
            !requestedPath.startsWith('//') &&
            !requestedPath.includes('://')) {
          redirectPath = requestedPath;
        }
      } catch {
        // Invalid state, use default redirect
      }
    }

    console.log('[Google OAuth] Exchanging code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);
    console.log('[Google OAuth] Token exchange successful, got tokens:', {
      hasAccessToken: !!tokens.access_token,
      hasIdToken: !!tokens.id_token,
      hasRefreshToken: !!tokens.refresh_token,
    });

    if (!tokens.id_token) {
      throw new Error('No ID token received from Google');
    }

    console.log('[Google OAuth] Verifying ID token...');
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error('Invalid ID token payload');
    }

    const googleUser = {
      sub: payload.sub,
      email: payload.email || '',
      email_verified: payload.email_verified || false,
      name: payload.name,
      picture: payload.picture,
      hd: payload.hd,
    };
    console.log('[Google OAuth] Verified user:', {
      email: googleUser.email,
      domain: googleUser.hd,
      name: googleUser.name,
    });

    // Pericles domains that get auto-assigned to root organization
    const periclesDomains = ['pericles.cloud', 'pericles.ai'];
    const isPericlesDomain = periclesDomains.includes(googleUser.hd || '');

    if (!isPericlesDomain) {
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
      if (!user.google_id || user.google_avatar_url !== googleUser.picture) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            google_id: googleUser.sub,
            google_avatar_url: googleUser.picture,
            email_verified: true,
            last_login_at: new Date(),
            name: user.name || googleUser.name,
          },
        });
      } else {
        await prisma.user.update({
          where: { id: user.id },
          data: { last_login_at: new Date() },
        });
      }

      // Auto-assign pericles domain users to root organization if not already a member
      // Pericles domain users get OWNER role for full platform access
      if (isPericlesDomain && user.memberships.length === 0) {
        const rootOrg = await prisma.organization.findFirst({
          where: { is_root: true },
        });
        if (rootOrg) {
          await prisma.userOrganization.create({
            data: {
              user_id: user.id,
              organization_id: rootOrg.id,
              role: 'OWNER',
              status: 'active',
              accepted_at: new Date(),
            },
          });
          // Reload memberships
          const updatedUser = await prisma.user.findUnique({
            where: { id: user.id },
            include: {
              memberships: {
                where: { status: 'active' },
                include: { organization: true },
              },
            },
          });
          if (updatedUser) {
            user = updatedUser;
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

      // Auto-assign pericles domain users to root organization
      // Pericles domain users get OWNER role for full platform access
      if (isPericlesDomain) {
        const rootOrg = await prisma.organization.findFirst({
          where: { is_root: true },
        });
        if (rootOrg) {
          await prisma.userOrganization.create({
            data: {
              user_id: user.id,
              organization_id: rootOrg.id,
              role: 'OWNER',
              status: 'active',
              accepted_at: new Date(),
            },
          });
          // Reload user with memberships
          const updatedUser = await prisma.user.findUnique({
            where: { id: user.id },
            include: {
              memberships: {
                where: { status: 'active' },
                include: { organization: true },
              },
            },
          });
          if (updatedUser) {
            user = updatedUser;
          }
        }
      }

      await logAuthEvent({
        userId: user.id,
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

    const primaryMembership = user.memberships[0];

    const { accessToken, refreshToken, refreshTokenId: _refreshTokenId } = generateTokenPair({
      id: user.id,
      email: user.email,
      role: (primaryMembership?.role || 'MEMBER') as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
      organizationId: primaryMembership?.organization_id || '',
    });

    await prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: hashToken(refreshToken),
        device_info: userAgent,
        ip_address: ipAddress,
        expires_at: getRefreshTokenExpiry(),
      },
    });

    const redirectUrl = new URL(`${FRONTEND_URL}/auth/callback`);
    redirectUrl.searchParams.set('accessToken', accessToken);
    redirectUrl.searchParams.set('refreshToken', refreshToken);
    redirectUrl.searchParams.set('redirect', redirectPath);

    res.redirect(302, redirectUrl.toString());
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('Google OAuth callback error:', {
      message: errorMessage,
      stack: errorStack,
      error,
    });

    await logAuthEvent({
      eventType: 'GOOGLE_SSO_LOGIN',
      eventStatus: 'FAILURE',
      ipAddress,
      userAgent,
      errorMessage: errorMessage,
      metadata: { stack: errorStack?.substring(0, 500) },
    });

    // Provide more specific error message in redirect
    const errorCode = errorMessage.includes('token') ? 'token_error'
      : errorMessage.includes('ID') ? 'id_error'
      : 'oauth_failed';
    res.redirect(`${FRONTEND_URL}/login?error=${errorCode}`);
  }
});

// =============================================================================
// ORGANIZATION ROUTES
// =============================================================================

import { z } from 'zod';

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
  emailDomains: z.array(z.string()).optional(),
  parentOrganizationId: z.string().uuid().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
  phoneNumber: z.string().optional(),
  website: z.string().url().optional(),
});

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  emailDomains: z.array(z.string()).optional(),
  parentOrganizationId: z.string().uuid().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zipCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  website: z.string().url().nullable().optional(),
});

const UpdateMemberSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
});

const CreateInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER', 'GUEST']),
});

interface OrgWithCount {
  id: string;
  name: string;
  email_domains: string[];
  is_root: boolean;
  parent_organization_id: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  phone_number: string | null;
  website: string | null;
  created_at: Date;
  updated_at: Date;
  _count: { users: number };
}

// Helper to get string from Express params
function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0];
  return param || '';
}

function formatOrganization(org: OrgWithCount, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST') {
  return {
    id: org.id,
    name: org.name,
    role,
    emailDomains: org.email_domains,
    isRoot: org.is_root,
    parentOrganizationId: org.parent_organization_id,
    addressLine1: org.address_line1,
    city: org.city,
    state: org.state,
    zipCode: org.zip_code,
    country: org.country,
    phoneNumber: org.phone_number,
    website: org.website,
    createdAt: org.created_at.toISOString(),
    updatedAt: org.updated_at.toISOString(),
    memberCount: org._count.users,
  };
}

// List organizations
app.get('/api/organizations', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    // Check if user is a member of the root organization (pericles.cloud users)
    const rootMembership = await prisma.userOrganization.findFirst({
      where: {
        user_id: tokenPayload.userId,
        status: 'active',
        organization: { is_root: true },
      },
    });

    // Root org users can see and switch to ALL organizations
    if (rootMembership) {
      const allOrganizations = await prisma.organization.findMany({
        include: { _count: { select: { users: { where: { status: 'active' } } } } },
        orderBy: [{ is_root: 'desc' }, { name: 'asc' }],
      });

      const organizations = allOrganizations.map((org) =>
        formatOrganization(org, rootMembership.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST')
      );

      res.status(200).json({ success: true, data: organizations });
      return;
    }

    // Regular users only see their own memberships
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active' },
      include: {
        organization: {
          include: { _count: { select: { users: { where: { status: 'active' } } } } },
        },
      },
    });

    const organizations = memberships.map((m) =>
      formatOrganization(m.organization, m.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST')
    );

    res.status(200).json({ success: true, data: organizations });
  } catch (error) {
    console.error('List organizations error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Create organization
app.post('/api/organizations', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const parseResult = CreateOrgSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message } });
      return;
    }

    const { name, emailDomains, parentOrganizationId, addressLine1, city, state, zipCode, country, phoneNumber, website } = parseResult.data;

    const organization = await prisma.organization.create({
      data: {
        name,
        email_domains: emailDomains || [],
        parent_organization_id: parentOrganizationId,
        address_line1: addressLine1,
        city,
        state,
        zip_code: zipCode,
        country,
        phone_number: phoneNumber,
        website,
        users: {
          create: { user_id: tokenPayload.userId, role: 'OWNER', status: 'active', accepted_at: new Date() },
        },
      },
      include: { _count: { select: { users: { where: { status: 'active' } } } } },
    });

    res.status(201).json({ success: true, data: formatOrganization(organization, 'OWNER') });
  } catch (error) {
    console.error('Create organization error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Get single organization
app.get('/api/organizations/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    const organization = await prisma.organization.findUnique({
      where: { id: getParam(req.params.id) },
      include: { _count: { select: { users: { where: { status: 'active' } } } } },
    });

    if (!organization) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    res.status(200).json({ success: true, data: formatOrganization(organization, membership.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST') });
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Update organization
app.patch('/api/organizations/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const parseResult = UpdateOrgSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message } });
      return;
    }

    const { name, emailDomains, parentOrganizationId, addressLine1, city, state, zipCode, country, phoneNumber, website } = parseResult.data;

    const organization = await prisma.organization.update({
      where: { id: getParam(req.params.id) },
      data: {
        ...(name !== undefined && { name }),
        ...(emailDomains !== undefined && { email_domains: emailDomains }),
        ...(parentOrganizationId !== undefined && { parent_organization_id: parentOrganizationId }),
        ...(addressLine1 !== undefined && { address_line1: addressLine1 }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(zipCode !== undefined && { zip_code: zipCode }),
        ...(country !== undefined && { country }),
        ...(phoneNumber !== undefined && { phone_number: phoneNumber }),
        ...(website !== undefined && { website }),
      },
      include: { _count: { select: { users: { where: { status: 'active' } } } } },
    });

    res.status(200).json({ success: true, data: formatOrganization(organization, membership.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST') });
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Delete organization
app.delete('/api/organizations/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    if (membership.role !== 'OWNER') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only owners can delete organizations' } });
      return;
    }

    await prisma.organization.delete({ where: { id: getParam(req.params.id) } });

    res.status(200).json({ success: true, data: { message: 'Organization deleted successfully' } });
  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// List organization members
app.get('/api/organizations/:id/members', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    const members = await prisma.userOrganization.findMany({
      where: { organization_id: getParam(req.params.id), status: 'active' },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: [{ role: 'asc' }, { accepted_at: 'asc' }],
    });

    const formattedMembers = members.map((m) => ({
      id: m.id,
      userId: m.user_id,
      user: { id: m.user.id, email: m.user.email, name: m.user.name },
      role: m.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
      joinedAt: (m.accepted_at || m.created_at).toISOString(),
    }));

    res.status(200).json({ success: true, data: formattedMembers });
  } catch (error) {
    console.error('List members error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Update member role
app.patch('/api/organizations/:id/members/:memberId', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const userMembership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (userMembership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    if (!['OWNER', 'ADMIN'].includes(userMembership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const targetMember = await prisma.userOrganization.findUnique({
      where: { id: getParam(req.params.memberId) },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    if (!targetMember || targetMember.organization_id !== getParam(req.params.id)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Member not found' } });
      return;
    }

    // Fetch organization to check if it's the root org (pericles.cloud)
    const organization = await prisma.organization.findUnique({
      where: { id: getParam(req.params.id) },
      select: { is_root: true },
    });

    // In non-root orgs, cannot modify existing OWNER
    if (targetMember.role === 'OWNER' && !organization?.is_root) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot modify organization owner' } });
      return;
    }

    const parseResult = UpdateMemberSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message } });
      return;
    }

    // Only OWNER can promote to OWNER, and only in root org (pericles.cloud)
    if (parseResult.data.role === 'OWNER') {
      if (userMembership.role !== 'OWNER') {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only owners can promote to owner' } });
        return;
      }
      if (!organization?.is_root) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Owner promotion only allowed in root organization' } });
        return;
      }
    }

    if (userMembership.role === 'ADMIN' && parseResult.data.role === 'ADMIN') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only owners can create admins' } });
      return;
    }

    const updatedMember = await prisma.userOrganization.update({
      where: { id: getParam(req.params.memberId) },
      data: { role: parseResult.data.role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    res.status(200).json({
      success: true,
      data: {
        id: updatedMember.id,
        userId: updatedMember.user_id,
        user: { id: updatedMember.user.id, email: updatedMember.user.email, name: updatedMember.user.name },
        role: updatedMember.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
        joinedAt: (updatedMember.accepted_at || updatedMember.created_at).toISOString(),
      },
    });
  } catch (error) {
    console.error('Update member error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Remove member
app.delete('/api/organizations/:id/members/:memberId', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const userMembership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (userMembership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    if (!['OWNER', 'ADMIN'].includes(userMembership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const targetMember = await prisma.userOrganization.findUnique({ where: { id: getParam(req.params.memberId) } });

    if (targetMember?.organization_id !== getParam(req.params.id)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Member not found' } });
      return;
    }

    if (targetMember.role === 'OWNER') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot remove organization owner' } });
      return;
    }

    await prisma.userOrganization.delete({ where: { id: getParam(req.params.memberId) } });

    res.status(200).json({ success: true, data: { message: 'Member removed successfully' } });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// List invites
app.get('/api/organizations/:id/invites', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const userMembership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (userMembership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    if (!['OWNER', 'ADMIN'].includes(userMembership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const pendingInvites = await prisma.userOrganization.findMany({
      where: { organization_id: getParam(req.params.id), status: 'pending' },
      include: { user: { select: { email: true } } },
      orderBy: { created_at: 'desc' },
    });

    const formattedInvites = pendingInvites.map((invite) => ({
      id: invite.id,
      email: invite.user.email,
      role: invite.role as 'ADMIN' | 'MEMBER' | 'GUEST',
      status: 'PENDING' as const,
      expiresAt: new Date(invite.created_at.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: invite.created_at.toISOString(),
    }));

    res.status(200).json({ success: true, data: formattedInvites });
  } catch (error) {
    console.error('List invites error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Send invite
app.post('/api/organizations/:id/invites', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const userMembership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (userMembership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    if (!['OWNER', 'ADMIN'].includes(userMembership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const parseResult = CreateInviteSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message } });
      return;
    }

    const { email, role } = parseResult.data;

    if (userMembership.role === 'ADMIN' && role === 'ADMIN') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only owners can invite admins' } });
      return;
    }

    let invitedUser = await prisma.user.findUnique({ where: { email } });

    if (!invitedUser) {
      invitedUser = await prisma.user.create({ data: { email, status: 'active' } });
    }

    const existingMembership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: invitedUser.id, organization_id: getParam(req.params.id) } },
    });

    if (existingMembership) {
      if (existingMembership.status === 'active') {
        res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'User is already a member' } });
        return;
      }
      if (existingMembership.status === 'pending') {
        res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'User already has a pending invite' } });
        return;
      }
    }

    const invite = await prisma.userOrganization.create({
      data: {
        user_id: invitedUser.id,
        organization_id: getParam(req.params.id),
        role,
        status: 'pending',
        invited_by: tokenPayload.userId,
        invited_at: new Date(),
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: invite.id,
        email,
        role: invite.role as 'ADMIN' | 'MEMBER' | 'GUEST',
        status: 'PENDING' as const,
        expiresAt: new Date(invite.created_at.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: invite.created_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Send invite error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Cancel invite
app.delete('/api/organizations/:id/invites/:inviteId', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const userMembership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (userMembership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    if (!['OWNER', 'ADMIN'].includes(userMembership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const invite = await prisma.userOrganization.findUnique({ where: { id: getParam(req.params.inviteId) } });

    if (invite?.organization_id !== getParam(req.params.id) || invite.status !== 'pending') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invite not found' } });
      return;
    }

    await prisma.userOrganization.delete({ where: { id: getParam(req.params.inviteId) } });

    res.status(200).json({ success: true, data: { message: 'Invite cancelled successfully' } });
  } catch (error) {
    console.error('Cancel invite error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Leave organization
app.post('/api/organizations/:id/leave', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found or you are not a member' } });
      return;
    }

    if (membership.role === 'OWNER') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Owners cannot leave. Transfer ownership or delete the organization.' } });
      return;
    }

    await prisma.userOrganization.delete({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: getParam(req.params.id) } },
    });

    res.status(200).json({ success: true, data: { message: 'Successfully left the organization' } });
  } catch (error) {
    console.error('Leave organization error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// ============================================
// SUPPLIER ENDPOINTS
// ============================================

// List suppliers for user's organizations
app.get('/api/suppliers', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    // Scope to a specific org (honoring root access + optional subsidiary rollup)
    // when organizationId is given; otherwise fall back to all of the user's orgs.
    const organizationId = req.query.organizationId as string | undefined;
    let orgIds: string[];
    if (organizationId) {
      const access = await checkOrganizationAccess(tokenPayload.userId, organizationId);
      if (!access.hasAccess) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied to this organization' } });
        return;
      }
      orgIds = [organizationId];
      if (req.query.includeSubsidiaries === 'true') {
        const children = await prisma.organization.findMany({
          where: { parent_organization_id: organizationId },
          select: { id: true },
        });
        orgIds.push(...children.map((c) => c.id));
      }
    } else {
      const memberships = await prisma.userOrganization.findMany({
        where: { user_id: tokenPayload.userId, status: 'active' },
        select: { organization_id: true },
      });
      orgIds = memberships.map((m) => m.organization_id);
    }

    const suppliers = await prisma.supplier.findMany({
      where: { organization_id: { in: orgIds } },
      orderBy: { name: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: suppliers.map(s => ({
        id: s.id,
        organizationId: s.organization_id,
        name: s.name,
        address: s.address,
        website: s.website,
        contactInfo: s.contact_info,
        country: s.country,
        countryCode: s.country_code,
        latitude: s.latitude,
        longitude: s.longitude,
        totalShipments: s.total_shipments,
        destinationPorts: s.destination_ports,
        departurePorts: s.departure_ports,
        hsCodes: s.hs_codes,
        notifyPartyName: s.notify_party_name,
        notifyPartyAddress: s.notify_party_address,
        createdAt: s.created_at.toISOString(),
        updatedAt: s.updated_at.toISOString(),
      })),
    });
  } catch (error) {
    console.error('List suppliers error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Create supplier
app.post('/api/suppliers', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const { organizationId, name, address, website, contactInfo, country, countryCode, latitude, longitude, notifyPartyName, notifyPartyAddress } = req.body;

    if (!organizationId || !name) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'organizationId and name are required' } });
      return;
    }

    // Verify user has access to this organization
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: organizationId } },
    });

    if (membership?.status !== 'active' || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const supplier = await prisma.supplier.create({
      data: {
        id: crypto.randomUUID(),
        organization: { connect: { id: organizationId } },
        name,
        address,
        website,
        contact_info: contactInfo,
        country,
        country_code: countryCode,
        latitude,
        longitude,
        notify_party_name: notifyPartyName,
        notify_party_address: notifyPartyAddress,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: supplier.id,
        organizationId: supplier.organization_id,
        name: supplier.name,
        address: supplier.address,
        website: supplier.website,
        contactInfo: supplier.contact_info,
        country: supplier.country,
        countryCode: supplier.country_code,
        latitude: supplier.latitude,
        longitude: supplier.longitude,
        totalShipments: supplier.total_shipments,
        destinationPorts: supplier.destination_ports,
        departurePorts: supplier.departure_ports,
        hsCodes: supplier.hs_codes,
        notifyPartyName: supplier.notify_party_name,
        notifyPartyAddress: supplier.notify_party_address,
        createdAt: supplier.created_at.toISOString(),
        updatedAt: supplier.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create supplier error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Get single supplier
app.get('/api/suppliers/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const supplierId = getParam(req.params.id);

    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });

    if (!supplier) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Supplier not found' } });
      return;
    }

    // Verify user has access to this organization
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: supplier.organization_id } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Supplier not found' } });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: supplier.id,
        organizationId: supplier.organization_id,
        name: supplier.name,
        address: supplier.address,
        website: supplier.website,
        contactInfo: supplier.contact_info,
        country: supplier.country,
        countryCode: supplier.country_code,
        latitude: supplier.latitude,
        longitude: supplier.longitude,
        totalShipments: supplier.total_shipments,
        destinationPorts: supplier.destination_ports,
        departurePorts: supplier.departure_ports,
        hsCodes: supplier.hs_codes,
        notifyPartyName: supplier.notify_party_name,
        notifyPartyAddress: supplier.notify_party_address,
        createdAt: supplier.created_at.toISOString(),
        updatedAt: supplier.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Update supplier
app.patch('/api/suppliers/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const supplierId = getParam(req.params.id);

    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });

    if (!supplier) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Supplier not found' } });
      return;
    }

    // Verify user has write access
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: supplier.organization_id } },
    });

    if (membership?.status !== 'active' || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const { name, address, website, contactInfo, country, countryCode, latitude, longitude, notifyPartyName, notifyPartyAddress } = req.body;

    const updated = await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(website !== undefined && { website }),
        ...(contactInfo !== undefined && { contact_info: contactInfo }),
        ...(country !== undefined && { country }),
        ...(countryCode !== undefined && { country_code: countryCode }),
        ...(latitude !== undefined && { latitude }),
        ...(longitude !== undefined && { longitude }),
        ...(notifyPartyName !== undefined && { notify_party_name: notifyPartyName }),
        ...(notifyPartyAddress !== undefined && { notify_party_address: notifyPartyAddress }),
      },
    });

    res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        organizationId: updated.organization_id,
        name: updated.name,
        address: updated.address,
        website: updated.website,
        contactInfo: updated.contact_info,
        country: updated.country,
        countryCode: updated.country_code,
        latitude: updated.latitude,
        longitude: updated.longitude,
        totalShipments: updated.total_shipments,
        destinationPorts: updated.destination_ports,
        departurePorts: updated.departure_ports,
        hsCodes: updated.hs_codes,
        notifyPartyName: updated.notify_party_name,
        notifyPartyAddress: updated.notify_party_address,
        createdAt: updated.created_at.toISOString(),
        updatedAt: updated.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Update supplier error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Delete supplier
app.delete('/api/suppliers/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const supplierId = getParam(req.params.id);

    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });

    if (!supplier) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Supplier not found' } });
      return;
    }

    // Verify user has write access
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: supplier.organization_id } },
    });

    if (membership?.status !== 'active' || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    await prisma.supplier.delete({ where: { id: supplierId } });

    res.status(200).json({ success: true, data: { message: 'Supplier deleted successfully' } });
  } catch (error) {
    console.error('Delete supplier error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// ============================================
// CARRIER ENDPOINTS
// ============================================

// List all carriers (carriers are global, not org-specific)
app.get('/api/carriers', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const carriers = await prisma.carrier.findMany({
      orderBy: { name: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: carriers.map(c => ({
        id: c.id,
        scacCode: c.scac_code,
        name: c.name,
        totalShipments: c.total_shipments,
        createdAt: c.created_at.toISOString(),
        updatedAt: c.updated_at.toISOString(),
      })),
    });
  } catch (error) {
    console.error('List carriers error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Create carrier
app.post('/api/carriers', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    // Check user is admin of at least one org
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active', role: { in: ['OWNER', 'ADMIN'] } },
    });

    if (memberships.length === 0) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const { scacCode, name } = req.body;

    if (!scacCode || !name) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'scacCode and name are required' } });
      return;
    }

    // Check if SCAC code already exists
    const existing = await prisma.carrier.findUnique({ where: { scac_code: scacCode } });
    if (existing) {
      res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'A carrier with this SCAC code already exists' } });
      return;
    }

    const carrier = await prisma.carrier.create({
      data: { id: crypto.randomUUID(), scac_code: scacCode, name },
    });

    res.status(201).json({
      success: true,
      data: {
        id: carrier.id,
        scacCode: carrier.scac_code,
        name: carrier.name,
        totalShipments: carrier.total_shipments,
        createdAt: carrier.created_at.toISOString(),
        updatedAt: carrier.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create carrier error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Get single carrier
app.get('/api/carriers/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const carrierId = getParam(req.params.id);
    const carrier = await prisma.carrier.findUnique({ where: { id: carrierId } });

    if (!carrier) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Carrier not found' } });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: carrier.id,
        scacCode: carrier.scac_code,
        name: carrier.name,
        totalShipments: carrier.total_shipments,
        createdAt: carrier.created_at.toISOString(),
        updatedAt: carrier.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Get carrier error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Update carrier
app.patch('/api/carriers/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    // Check user is admin of at least one org
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active', role: { in: ['OWNER', 'ADMIN'] } },
    });

    if (memberships.length === 0) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const carrierId = getParam(req.params.id);
    const carrier = await prisma.carrier.findUnique({ where: { id: carrierId } });

    if (!carrier) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Carrier not found' } });
      return;
    }

    const { scacCode, name } = req.body;

    // If changing SCAC code, check it doesn't conflict
    if (scacCode && scacCode !== carrier.scac_code) {
      const existing = await prisma.carrier.findUnique({ where: { scac_code: scacCode } });
      if (existing) {
        res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'A carrier with this SCAC code already exists' } });
        return;
      }
    }

    const updated = await prisma.carrier.update({
      where: { id: carrierId },
      data: {
        ...(scacCode !== undefined && { scac_code: scacCode }),
        ...(name !== undefined && { name }),
      },
    });

    res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        scacCode: updated.scac_code,
        name: updated.name,
        totalShipments: updated.total_shipments,
        createdAt: updated.created_at.toISOString(),
        updatedAt: updated.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Update carrier error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Delete carrier
app.delete('/api/carriers/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    // Check user is admin of at least one org
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active', role: { in: ['OWNER', 'ADMIN'] } },
    });

    if (memberships.length === 0) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const carrierId = getParam(req.params.id);
    const carrier = await prisma.carrier.findUnique({ where: { id: carrierId } });

    if (!carrier) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Carrier not found' } });
      return;
    }

    await prisma.carrier.delete({ where: { id: carrierId } });

    res.status(200).json({ success: true, data: { message: 'Carrier deleted successfully' } });
  } catch (error) {
    console.error('Delete carrier error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// ============================================
// SHIPMENT ENDPOINTS
// ============================================

// List shipments for a specific organization
app.get('/api/shipments', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const organizationId = req.query.organizationId as string;

    if (!organizationId) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'organizationId query parameter is required' } });
      return;
    }

    // Honor root-org global access + org hierarchy (mirrors /api/shipments/positions).
    const access = await checkOrganizationAccess(tokenPayload.userId, organizationId);
    if (!access.hasAccess) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied to this organization' } });
      return;
    }

    // Roll up across branded subsidiaries when requested (?includeSubsidiaries=true)
    // so a parent org's stats/lines reflect its whole fleet, like the live layer.
    const orgIds = [organizationId];
    if (req.query.includeSubsidiaries === 'true') {
      const children = await prisma.organization.findMany({
        where: { parent_organization_id: organizationId },
        select: { id: true },
      });
      orgIds.push(...children.map((c) => c.id));
    }

    const shipments = await prisma.shipment.findMany({
      where: { organization_id: { in: orgIds } },
      include: {
        supplier: { select: { id: true, name: true, country: true } },
        carrier: { select: { id: true, name: true, scac_code: true } },
      },
      orderBy: { arrival_date: 'desc' },
    });

    res.status(200).json({
      success: true,
      data: shipments.map(s => ({
        id: s.id,
        organizationId: s.organization_id,
        supplierId: s.supplier_id,
        carrierId: s.carrier_id,
        supplier: s.supplier ? { id: s.supplier.id, name: s.supplier.name, country: s.supplier.country } : null,
        carrier: s.carrier ? { id: s.carrier.id, name: s.carrier.name, scacCode: s.carrier.scac_code } : null,
        bolNumber: s.bol_number,
        masterBolNumber: s.master_bol_number,
        containersCount: s.containers_count,
        shippingRoute: s.shipping_route,
        valueUsd: s.value_usd,
        arrivalDate: s.arrival_date?.toISOString() || null,
        estimatedArrivalDate: s.estimated_arrival_date?.toISOString() || null,
        destinationPort: s.destination_port,
        destinationPortCode: s.destination_port_code,
        departurePort: s.departure_port,
        departurePortCode: s.departure_port_code,
        lastVisitForeignPort: s.last_visit_foreign_port,
        vesselName: s.vessel_name,
        vesselCode: s.vessel_code,
        voyage: s.voyage,
        containerIds: s.container_ids,
        containerSizes: s.container_sizes,
        containerTypes: s.container_types,
        hsCodes: s.hs_codes,
        hsCodeDescriptions: s.hs_code_descriptions,
        productDescription: s.product_description,
        quantity: s.quantity,
        quantityUnit: s.quantity_unit,
        teu: s.teu,
        weight: s.weight,
        marksNumbers: s.marks_numbers,
        notifyPartyName: s.notify_party_name,
        notifyPartyAddress: s.notify_party_address,
        notifyPartyCountryCode: s.notify_party_country_code,
        createdAt: s.created_at.toISOString(),
        updatedAt: s.updated_at.toISOString(),
      })),
    });
  } catch (error) {
    console.error('List shipments error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Live vessel positions for the org's shipments (Atlas live layer). Registered
// BEFORE '/api/shipments/:id' so the literal path isn't captured as :id.
app.get('/api/shipments/positions', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const organizationId = (req.query.organizationId as string | undefined) ?? '';
    if (!organizationId) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'organizationId query parameter is required' } });
      return;
    }

    const access = await checkOrganizationAccess(tokenPayload.userId, organizationId);
    if (!access.hasAccess) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied to this organization' } });
      return;
    }

    // Roll up across branded subsidiaries when requested (?includeSubsidiaries=true)
    // so Atlas can show a parent's whole fleet, colored per subsidiary.
    const includeSubsidiaries = req.query.includeSubsidiaries === 'true';
    const positions = await getOrganizationPositions(prisma, organizationId, { includeSubsidiaries });

    res.status(200).json({
      success: true,
      data: positions,
      meta: { source: getPositionFeed().source, count: positions.length },
    });
  } catch (error) {
    console.error('Get shipment positions error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to compute positions' } });
  }
});

// Get single shipment
app.get('/api/shipments/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const shipmentId = getParam(req.params.id);

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        supplier: { select: { id: true, name: true, country: true, address: true } },
        carrier: { select: { id: true, name: true, scac_code: true } },
      },
    });

    if (!shipment) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Shipment not found' } });
      return;
    }

    // Verify user has access to this organization
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: shipment.organization_id } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Shipment not found' } });
      return;
    }

    const s = shipment;
    res.status(200).json({
      success: true,
      data: {
        id: s.id,
        organizationId: s.organization_id,
        supplierId: s.supplier_id,
        carrierId: s.carrier_id,
        supplier: s.supplier ? { id: s.supplier.id, name: s.supplier.name, country: s.supplier.country, address: s.supplier.address } : null,
        carrier: s.carrier ? { id: s.carrier.id, name: s.carrier.name, scacCode: s.carrier.scac_code } : null,
        bolNumber: s.bol_number,
        masterBolNumber: s.master_bol_number,
        containersCount: s.containers_count,
        shippingRoute: s.shipping_route,
        valueUsd: s.value_usd,
        arrivalDate: s.arrival_date?.toISOString() || null,
        estimatedArrivalDate: s.estimated_arrival_date?.toISOString() || null,
        destinationPort: s.destination_port,
        destinationPortCode: s.destination_port_code,
        departurePort: s.departure_port,
        departurePortCode: s.departure_port_code,
        lastVisitForeignPort: s.last_visit_foreign_port,
        vesselName: s.vessel_name,
        vesselCode: s.vessel_code,
        voyage: s.voyage,
        containerIds: s.container_ids,
        containerSizes: s.container_sizes,
        containerTypes: s.container_types,
        hsCodes: s.hs_codes,
        hsCodeDescriptions: s.hs_code_descriptions,
        productDescription: s.product_description,
        productDescriptionRaw: s.product_description_raw,
        quantity: s.quantity,
        quantityUnit: s.quantity_unit,
        teu: s.teu,
        weight: s.weight,
        marksNumbers: s.marks_numbers,
        marksNumbersRaw: s.marks_numbers_raw,
        notifyPartyName: s.notify_party_name,
        notifyPartyAddress: s.notify_party_address,
        notifyPartyCountryCode: s.notify_party_country_code,
        createdAt: s.created_at.toISOString(),
        updatedAt: s.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Get shipment error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Create shipment
app.post('/api/shipments', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const { organizationId, bolNumber, ...shipmentData } = req.body;

    if (!organizationId || !bolNumber) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'organizationId and bolNumber are required' } });
      return;
    }

    // Verify user has write access
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: organizationId } },
    });

    if (membership?.status !== 'active' || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const shipment = await prisma.shipment.create({
      data: {
        id: crypto.randomUUID(),
        organization: { connect: { id: organizationId } },
        bol_number: bolNumber,
        master_bol_number: shipmentData.masterBolNumber,
        supplier: shipmentData.supplierId ? { connect: { id: shipmentData.supplierId } } : undefined,
        carrier: shipmentData.carrierId ? { connect: { id: shipmentData.carrierId } } : undefined,
        containers_count: shipmentData.containersCount,
        shipping_route: shipmentData.shippingRoute,
        value_usd: shipmentData.valueUsd,
        arrival_date: shipmentData.arrivalDate ? new Date(shipmentData.arrivalDate) : undefined,
        estimated_arrival_date: shipmentData.estimatedArrivalDate ? new Date(shipmentData.estimatedArrivalDate) : undefined,
        destination_port: shipmentData.destinationPort,
        destination_port_code: shipmentData.destinationPortCode,
        departure_port: shipmentData.departurePort,
        departure_port_code: shipmentData.departurePortCode,
        vessel_name: shipmentData.vesselName,
        vessel_code: shipmentData.vesselCode,
        voyage: shipmentData.voyage,
        container_ids: shipmentData.containerIds,
        container_sizes: shipmentData.containerSizes,
        container_types: shipmentData.containerTypes,
        hs_codes: shipmentData.hsCodes,
        hs_code_descriptions: shipmentData.hsCodeDescriptions,
        product_description: shipmentData.productDescription,
        quantity: shipmentData.quantity,
        quantity_unit: shipmentData.quantityUnit,
        teu: shipmentData.teu,
        weight: shipmentData.weight,
        notify_party_name: shipmentData.notifyPartyName,
        notify_party_address: shipmentData.notifyPartyAddress,
        notify_party_country_code: shipmentData.notifyPartyCountryCode,
      },
      include: {
        supplier: { select: { id: true, name: true, country: true } },
        carrier: { select: { id: true, name: true, scac_code: true } },
      },
    });

    const s = shipment;
    res.status(201).json({
      success: true,
      data: {
        id: s.id,
        organizationId: s.organization_id,
        supplierId: s.supplier_id,
        carrierId: s.carrier_id,
        supplier: s.supplier ? { id: s.supplier.id, name: s.supplier.name, country: s.supplier.country } : null,
        carrier: s.carrier ? { id: s.carrier.id, name: s.carrier.name, scacCode: s.carrier.scac_code } : null,
        bolNumber: s.bol_number,
        masterBolNumber: s.master_bol_number,
        containersCount: s.containers_count,
        shippingRoute: s.shipping_route,
        valueUsd: s.value_usd,
        arrivalDate: s.arrival_date?.toISOString() || null,
        estimatedArrivalDate: s.estimated_arrival_date?.toISOString() || null,
        destinationPort: s.destination_port,
        destinationPortCode: s.destination_port_code,
        departurePort: s.departure_port,
        departurePortCode: s.departure_port_code,
        vesselName: s.vessel_name,
        vesselCode: s.vessel_code,
        voyage: s.voyage,
        containerIds: s.container_ids,
        containerSizes: s.container_sizes,
        containerTypes: s.container_types,
        hsCodes: s.hs_codes,
        hsCodeDescriptions: s.hs_code_descriptions,
        productDescription: s.product_description,
        quantity: s.quantity,
        quantityUnit: s.quantity_unit,
        teu: s.teu,
        weight: s.weight,
        notifyPartyName: s.notify_party_name,
        notifyPartyAddress: s.notify_party_address,
        notifyPartyCountryCode: s.notify_party_country_code,
        createdAt: s.created_at.toISOString(),
        updatedAt: s.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create shipment error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Update shipment
app.patch('/api/shipments/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const shipmentId = getParam(req.params.id);

    const existingShipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });

    if (!existingShipment) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Shipment not found' } });
      return;
    }

    // Verify user has write access
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: existingShipment.organization_id } },
    });

    if (membership?.status !== 'active' || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const data = req.body;

    const shipment = await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        ...(data.bolNumber !== undefined && { bol_number: data.bolNumber }),
        ...(data.masterBolNumber !== undefined && { master_bol_number: data.masterBolNumber }),
        ...(data.supplierId !== undefined && { supplier_id: data.supplierId }),
        ...(data.carrierId !== undefined && { carrier_id: data.carrierId }),
        ...(data.containersCount !== undefined && { containers_count: data.containersCount }),
        ...(data.shippingRoute !== undefined && { shipping_route: data.shippingRoute }),
        ...(data.valueUsd !== undefined && { value_usd: data.valueUsd }),
        ...(data.arrivalDate !== undefined && { arrival_date: data.arrivalDate ? new Date(data.arrivalDate) : null }),
        ...(data.estimatedArrivalDate !== undefined && { estimated_arrival_date: data.estimatedArrivalDate ? new Date(data.estimatedArrivalDate) : null }),
        ...(data.destinationPort !== undefined && { destination_port: data.destinationPort }),
        ...(data.destinationPortCode !== undefined && { destination_port_code: data.destinationPortCode }),
        ...(data.departurePort !== undefined && { departure_port: data.departurePort }),
        ...(data.departurePortCode !== undefined && { departure_port_code: data.departurePortCode }),
        ...(data.vesselName !== undefined && { vessel_name: data.vesselName }),
        ...(data.vesselCode !== undefined && { vessel_code: data.vesselCode }),
        ...(data.voyage !== undefined && { voyage: data.voyage }),
        ...(data.containerIds !== undefined && { container_ids: data.containerIds }),
        ...(data.containerSizes !== undefined && { container_sizes: data.containerSizes }),
        ...(data.containerTypes !== undefined && { container_types: data.containerTypes }),
        ...(data.hsCodes !== undefined && { hs_codes: data.hsCodes }),
        ...(data.hsCodeDescriptions !== undefined && { hs_code_descriptions: data.hsCodeDescriptions }),
        ...(data.productDescription !== undefined && { product_description: data.productDescription }),
        ...(data.quantity !== undefined && { quantity: data.quantity }),
        ...(data.quantityUnit !== undefined && { quantity_unit: data.quantityUnit }),
        ...(data.teu !== undefined && { teu: data.teu }),
        ...(data.weight !== undefined && { weight: data.weight }),
        ...(data.notifyPartyName !== undefined && { notify_party_name: data.notifyPartyName }),
        ...(data.notifyPartyAddress !== undefined && { notify_party_address: data.notifyPartyAddress }),
        ...(data.notifyPartyCountryCode !== undefined && { notify_party_country_code: data.notifyPartyCountryCode }),
      },
      include: {
        supplier: { select: { id: true, name: true, country: true } },
        carrier: { select: { id: true, name: true, scac_code: true } },
      },
    });

    const s = shipment;
    res.status(200).json({
      success: true,
      data: {
        id: s.id,
        organizationId: s.organization_id,
        supplierId: s.supplier_id,
        carrierId: s.carrier_id,
        supplier: s.supplier ? { id: s.supplier.id, name: s.supplier.name, country: s.supplier.country } : null,
        carrier: s.carrier ? { id: s.carrier.id, name: s.carrier.name, scacCode: s.carrier.scac_code } : null,
        bolNumber: s.bol_number,
        masterBolNumber: s.master_bol_number,
        containersCount: s.containers_count,
        shippingRoute: s.shipping_route,
        valueUsd: s.value_usd,
        arrivalDate: s.arrival_date?.toISOString() || null,
        estimatedArrivalDate: s.estimated_arrival_date?.toISOString() || null,
        destinationPort: s.destination_port,
        destinationPortCode: s.destination_port_code,
        departurePort: s.departure_port,
        departurePortCode: s.departure_port_code,
        vesselName: s.vessel_name,
        vesselCode: s.vessel_code,
        voyage: s.voyage,
        containerIds: s.container_ids,
        containerSizes: s.container_sizes,
        containerTypes: s.container_types,
        hsCodes: s.hs_codes,
        hsCodeDescriptions: s.hs_code_descriptions,
        productDescription: s.product_description,
        quantity: s.quantity,
        quantityUnit: s.quantity_unit,
        teu: s.teu,
        weight: s.weight,
        notifyPartyName: s.notify_party_name,
        notifyPartyAddress: s.notify_party_address,
        notifyPartyCountryCode: s.notify_party_country_code,
        createdAt: s.created_at.toISOString(),
        updatedAt: s.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Update shipment error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Delete shipment
app.delete('/api/shipments/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const shipmentId = getParam(req.params.id);

    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });

    if (!shipment) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Shipment not found' } });
      return;
    }

    // Verify user has write access
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: shipment.organization_id } },
    });

    if (membership?.status !== 'active' || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    await prisma.shipment.delete({ where: { id: shipmentId } });

    res.status(200).json({ success: true, data: { message: 'Shipment deleted successfully' } });
  } catch (error) {
    console.error('Delete shipment error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// ============================================
// EVENT API ENDPOINTS
// ============================================

// Get events for organization
app.get('/api/events', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const organizationId = getParam(req.query.organizationId as string);
    const validationStatus = getParam(req.query.validationStatus as string);
    const type = getParam(req.query.type as string);
    const source = getParam(req.query.source as string);
    const limit = parseInt(getParam(req.query.limit as string) || '50', 10);
    const offset = parseInt(getParam(req.query.offset as string) || '0', 10);

    if (!organizationId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'organizationId is required' } });
      return;
    }

    // Honour root access and ancestor rollup, exactly as /api/suppliers and
    // /api/shipments do. A direct-membership-only check 403s a root-org user or
    // a parent-org member viewing a subsidiary, even though the sibling
    // endpoints on the same page let them through.
    const access = await checkOrganizationAccess(tokenPayload.userId, organizationId);
    if (!access.hasAccess) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied to this organization' } });
      return;
    }

    // Optional subsidiary rollup, matching the sibling endpoints. Atlas draws
    // suppliers and shipments rolled up across subsidiaries; without this the
    // events feed beside them would be scoped to the parent org alone and read
    // as empty.
    //
    // Known limitation, shared verbatim with /api/suppliers and /api/shipments:
    // this is ONE level (direct children only), while checkOrganizationAccess
    // above grants access across the full ancestor chain. In an org tree deeper
    // than two levels a grandparent-org user is authorised to read a
    // grandchild's events but will not see them rolled up here. Fixing it means
    // a shared descendant-walk used by all three endpoints, not a change here.
    const orgIds = [organizationId];
    if (req.query.includeSubsidiaries === 'true') {
      const children = await prisma.organization.findMany({
        where: { parent_organization_id: organizationId },
        select: { id: true },
      });
      orgIds.push(...children.map((c) => c.id));
    }

    // Build query filters
    const where: Prisma.EventWhereInput = { organization_id: { in: orgIds } };
    if (validationStatus) where.validation_status = validationStatus;
    if (type) where.type = type;
    if (source) where.source = source;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          incident: true,
        },
        orderBy: { event_timestamp: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
      }),
      prisma.event.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        events: events.map((e) => ({
          id: e.id,
          organizationId: e.organization_id,
          eventHash: e.event_hash,
          type: e.type,
          source: e.source,
          title: e.title,
          description: e.description,
          locationName: e.location_name,
          latitude: e.latitude,
          longitude: e.longitude,
          detectedAt: e.detected_at.toISOString(),
          eventTimestamp: e.event_timestamp.toISOString(),
          severity: e.severity,
          confidence: e.confidence,
          riskFactors: e.risk_factors,
          affectedDomains: e.affected_domains,
          validationStatus: e.validation_status,
          validatedAt: e.validated_at?.toISOString() || null,
          incident: e.incident
            ? {
                id: e.incident.id,
                incidentNumber: e.incident.incident_number,
                status: e.incident.status,
                priority: e.incident.priority,
                assignedTo: e.incident.assigned_to,
                resolvedAt: e.incident.resolved_at?.toISOString() || null,
                responsePlanId: e.incident.response_plan_id,
              }
            : null,
          createdAt: e.created_at.toISOString(),
          updatedAt: e.updated_at.toISOString(),
        })),
        total,
      },
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Get single event
app.get('/api/events/:id', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const eventId = getParam(req.params.id);

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { incident: true },
    });

    if (!event) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Event not found' } });
      return;
    }

    // Same access model as the collection endpoint above: root and ancestor
    // members can read a descendant org's events.
    const access = await checkOrganizationAccess(tokenPayload.userId, event.organization_id);
    if (!access.hasAccess) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied to this event' } });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: event.id,
        organizationId: event.organization_id,
        eventHash: event.event_hash,
        type: event.type,
        source: event.source,
        title: event.title,
        description: event.description,
        locationName: event.location_name,
        latitude: event.latitude,
        longitude: event.longitude,
        detectedAt: event.detected_at.toISOString(),
        eventTimestamp: event.event_timestamp.toISOString(),
        severity: event.severity,
        confidence: event.confidence,
        riskFactors: event.risk_factors,
        affectedDomains: event.affected_domains,
        validationStatus: event.validation_status,
        validatedAt: event.validated_at?.toISOString() || null,
        incident: event.incident
          ? {
              id: event.incident.id,
              incidentNumber: event.incident.incident_number,
              status: event.incident.status,
              priority: event.incident.priority,
              assignedTo: event.incident.assigned_to,
              resolvedAt: event.incident.resolved_at?.toISOString() || null,
              responsePlanId: event.incident.response_plan_id,
            }
          : null,
        createdAt: event.created_at.toISOString(),
        updatedAt: event.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Ask a question about one specific event (#23) — the per-event Q&A box
// under Intelligence's Analysis tab.
const AskEventQuestionSchema = z.object({
  question: z.string().min(1).max(1000),
});
const EventQaAnswerSchema = z.object({
  answer: z.string(),
});
const EVENT_QA_TIMEOUT_MS = 20000;

app.post('/api/events/:id/ask', eventQaRateLimit, async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const parseResult = AskEventQuestionSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message } });
      return;
    }
    const { question } = parseResult.data;

    const eventId = getParam(req.params.id);
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { incident: true },
    });

    if (!event) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Event not found' } });
      return;
    }

    // Same read-access model as GET /api/events/:id above: a question about
    // an event a user can already see shouldn't be gated more strictly than
    // viewing the event itself.
    const access = await checkOrganizationAccess(tokenPayload.userId, event.organization_id);
    if (!access.hasAccess) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied to this event' } });
      return;
    }

    // The event's own fields originate from external monitored feeds and
    // are untrusted per pericles-prompts — boundary-marked here, and the
    // agent's own instructions (event-qa-agent.ts) tell it to treat this
    // block as data, never as instructions. Angle brackets are neutralized
    // so a feed item can't break out of <event_context> with a crafted
    // "</event_context>" (or similar) sequence in its title/description.
    const escapeForPromptContext = (value: string): string =>
      value.replace(/</g, '‹').replace(/>/g, '›');

    const contextLines = [
      `Title: ${escapeForPromptContext(event.title)}`,
      `Description: ${escapeForPromptContext(event.description)}`,
      `Type: ${escapeForPromptContext(event.type)}`,
      `Severity: ${event.severity.toFixed(2)} (0-1 scale)`,
      `Confidence: ${event.confidence.toFixed(2)} (0-1 scale)`,
      event.location_name ? `Location: ${escapeForPromptContext(event.location_name)}` : null,
      `Risk factors: ${event.risk_factors.length ? escapeForPromptContext(event.risk_factors.join(', ')) : 'none recorded'}`,
      `Affected domains: ${event.affected_domains.length ? escapeForPromptContext(event.affected_domains.join(', ')) : 'none recorded'}`,
      `Event occurred: ${event.event_timestamp.toISOString()}`,
      `Detected by Pericles: ${event.detected_at.toISOString()}`,
      `Validation status: ${event.validation_status}`,
      event.incident
        ? `Linked incident: ${event.incident.incident_number}, status ${event.incident.status}, priority ${event.incident.priority}`
        : null,
    ].filter((line): line is string => line !== null);

    // The question itself sits right next to the closing tag, so it needs
    // the same escaping as the feed-derived fields above — otherwise a
    // question containing a literal "</event_context>" reopens the exact
    // boundary-break this function's escaping exists to prevent, just from
    // the other side of the tag instead of from inside it.
    const prompt =
      `<event_context>\n${contextLines.join('\n')}\n</event_context>\n\n` +
      `User question: ${escapeForPromptContext(question)}`;

    const agent = mastra.getAgent('eventQaAgent');
    if (!agent) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Q&A agent unavailable' } });
      return;
    }

    let result;
    try {
      result = await agent.generate(prompt, {
        structuredOutput: { schema: EventQaAnswerSchema },
        abortSignal: AbortSignal.timeout(EVENT_QA_TIMEOUT_MS),
      });
    } catch (err) {
      console.error('Event Q&A agent error:', err);
      res.status(502).json({ success: false, error: { code: 'UPSTREAM_ERROR', message: 'Failed to generate an answer. Please try again.' } });
      return;
    }

    // result.object is typed optional by the SDK (a resolved call can still
    // fail structured-output extraction, e.g. the model's response doesn't
    // parse against EventQaAnswerSchema) — that's a real failure to report
    // as 502, not a TypeError to let fall through to the generic 500 below.
    if (!result.object) {
      console.error('Event Q&A agent error: structured output missing from a resolved call');
      res.status(502).json({ success: false, error: { code: 'UPSTREAM_ERROR', message: 'Failed to generate an answer. Please try again.' } });
      return;
    }

    res.status(200).json({ success: true, data: { answer: result.object.answer } });
  } catch (error) {
    console.error('Event Q&A error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Update event validation status
app.patch('/api/events/:id/validation', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const eventId = getParam(req.params.id);
    const { validationStatus } = req.body;

    if (!validationStatus || !['pending', 'validated', 'rejected', 'duplicate'].includes(validationStatus)) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid validation status' } });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Event not found' } });
      return;
    }

    // Writes deliberately require DIRECT membership, unlike the reads above.
    // checkOrganizationAccess flows access ancestor → descendant, which is the
    // documented model for reading; granting it here would let any root-org or
    // parent-org MEMBER mutate a descendant tenant's events. Every other
    // mutating endpoint in this file gates on direct membership too — widening
    // that is a deliberate product decision, not a side effect of fixing a read.
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: event.organization_id } },
    });

    if (membership?.status !== 'active' || !['OWNER', 'ADMIN', 'MEMBER'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        validation_status: validationStatus,
        validated_at: validationStatus === 'validated' ? new Date() : null,
      },
      include: { incident: true },
    });

    res.status(200).json({
      success: true,
      data: {
        id: updatedEvent.id,
        organizationId: updatedEvent.organization_id,
        eventHash: updatedEvent.event_hash,
        type: updatedEvent.type,
        source: updatedEvent.source,
        title: updatedEvent.title,
        description: updatedEvent.description,
        locationName: updatedEvent.location_name,
        latitude: updatedEvent.latitude,
        longitude: updatedEvent.longitude,
        detectedAt: updatedEvent.detected_at.toISOString(),
        eventTimestamp: updatedEvent.event_timestamp.toISOString(),
        severity: updatedEvent.severity,
        confidence: updatedEvent.confidence,
        riskFactors: updatedEvent.risk_factors,
        affectedDomains: updatedEvent.affected_domains,
        validationStatus: updatedEvent.validation_status,
        validatedAt: updatedEvent.validated_at?.toISOString() || null,
        incident: updatedEvent.incident
          ? {
              id: updatedEvent.incident.id,
              incidentNumber: updatedEvent.incident.incident_number,
              status: updatedEvent.incident.status,
              priority: updatedEvent.incident.priority,
              assignedTo: updatedEvent.incident.assigned_to,
              resolvedAt: updatedEvent.incident.resolved_at?.toISOString() || null,
              responsePlanId: updatedEvent.incident.response_plan_id,
            }
          : null,
        createdAt: updatedEvent.created_at.toISOString(),
        updatedAt: updatedEvent.updated_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Update event validation error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// ============================================================================
// MONITORING AGENT API
// ============================================================================

/**
 * Get monitoring configuration for an organization
 */
app.get('/api/monitoring/config', async (req: Request, res: Response) => {
  try {
     
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const { organizationId } = req.query;

    if (!organizationId || typeof organizationId !== 'string') {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'organizationId is required' } });
      return;
    }

    // Check user has access to organization
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active' },
    });
    const membership = memberships.find((m: { organization_id: string }) => m.organization_id === organizationId);
    if (!membership) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied to organization' } });
      return;
    }

    // Get organization context (contains some config)
    const orgContext = await prisma.organizationContext.findUnique({
      where: { organization_id: organizationId },
    });

    // Return config with defaults
    const config = {
      organizationId,
      pollingIntervalMs: parseInt(process.env.MONITORING_DEFAULT_INTERVAL_MS || '15000', 10),
      enabledSources: {
        weather: true,
        political: true,
        cybersecurity: true,
        economic: true,
        news: true,
        maritime: true,
        labor: true,
        regulatory: true,
        pandemic: true,
        geopolitical: true,
      },
      geographicFilter: {
        radiusKm: orgContext?.geographic_radius_km || 100,
        strictMode: false,
      },
      riskFilter: {
        severityThreshold: orgContext?.severity_threshold || 0.5,
        confidenceThreshold: 0.3,
        monitoredRiskTypes: orgContext?.monitored_risk_types || [],
      },
      deduplication: {
        lookbackWindowHours: 168,
        enabled: true,
      },
      errorHandling: {
        maxBackoffMs: 60000,
        maxRetries: 3,
        stopOnFatalError: true,
      },
      observability: {
        enableMetrics: true,
        enableAuditLog: true,
        logLevel: process.env.LOG_LEVEL || 'info',
      },
    };

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error('Get monitoring config error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get config' } });
  }
});

/**
 * Update monitoring configuration for an organization
 */
app.patch('/api/monitoring/config', async (req: Request, res: Response) => {
  try {
     
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const { organizationId, geographicFilter, riskFilter } = req.body;

    if (!organizationId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'organizationId is required' } });
      return;
    }

    // Check user has admin access to organization
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active' },
    });
    const membership = memberships.find((m: { organization_id: string; role: string }) => m.organization_id === organizationId);
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
      return;
    }

    // Update organization context with config values
    const updateData: Prisma.OrganizationContextUpdateInput = {};

    if (geographicFilter?.radiusKm !== undefined) {
      updateData.geographic_radius_km = geographicFilter.radiusKm;
    }
    if (riskFilter?.severityThreshold !== undefined) {
      updateData.severity_threshold = riskFilter.severityThreshold;
    }
    if (riskFilter?.monitoredRiskTypes !== undefined) {
      updateData.monitored_risk_types = riskFilter.monitoredRiskTypes;
    }

    // Upsert organization context
    const updatedContext = await prisma.organizationContext.upsert({
      where: { organization_id: organizationId },
      create: {
        organization: { connect: { id: organizationId } },
        geographic_radius_km: geographicFilter?.radiusKm || 100,
        severity_threshold: riskFilter?.severityThreshold || 0.5,
        monitored_risk_types: riskFilter?.monitoredRiskTypes || [],
        plants: [],
        warehouses: [],
        suppliers: [],
        shipping_lanes: [],
      },
      update: updateData,
    });

    // Return full config
    const config = {
      organizationId,
      pollingIntervalMs: parseInt(process.env.MONITORING_DEFAULT_INTERVAL_MS || '15000', 10),
      enabledSources: {
        weather: true,
        political: true,
        cybersecurity: true,
        economic: true,
        news: true,
        maritime: true,
        labor: true,
        regulatory: true,
        pandemic: true,
        geopolitical: true,
      },
      geographicFilter: {
        radiusKm: updatedContext.geographic_radius_km,
        strictMode: false,
      },
      riskFilter: {
        severityThreshold: updatedContext.severity_threshold,
        confidenceThreshold: 0.3,
        monitoredRiskTypes: updatedContext.monitored_risk_types,
      },
      deduplication: {
        lookbackWindowHours: 168,
        enabled: true,
      },
      errorHandling: {
        maxBackoffMs: 60000,
        maxRetries: 3,
        stopOnFatalError: true,
      },
      observability: {
        enableMetrics: true,
        enableAuditLog: true,
        logLevel: process.env.LOG_LEVEL || 'info',
      },
    };

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error('Update monitoring config error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update config' } });
  }
});

/**
 * Get monitoring agent status for an organization
 */
app.get('/api/monitoring/status', async (req: Request, res: Response) => {
  try {
     
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const { organizationId } = req.query;

    if (!organizationId || typeof organizationId !== 'string') {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'organizationId is required' } });
      return;
    }

    // Check user has access to organization
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active' },
    });
    const membership = memberships.find((m: { organization_id: string }) => m.organization_id === organizationId);
    if (!membership) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied to organization' } });
      return;
    }

    // Get organization context for config
    const orgContext = await prisma.organizationContext.findUnique({
      where: { organization_id: organizationId },
    });

    // Get recent audit logs to determine status
    const recentLogs = await prisma.monitoringAuditLog.findMany({
      where: { organization_id: organizationId },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    // Aggregate statistics
    const allLogs = await prisma.monitoringAuditLog.aggregate({
      where: { organization_id: organizationId },
      _count: true,
      _sum: {
        events_detected: true,
        events_published: true,
      },
    });

    // Determine status from recent logs
    let status: 'active' | 'idle' | 'error' | 'stopped' = 'idle';
    let consecutiveErrors = 0;

    if (recentLogs.length > 0) {
      const lastLog = recentLogs[0];
      const lastRunTime = lastLog.created_at.getTime();
      const now = Date.now();
      const timeSinceLastRun = now - lastRunTime;

      // If last run was within 2 minutes, consider active
      if (timeSinceLastRun < 120000) {
        status = lastLog.status === 'failure' ? 'error' : 'active';
      }

      // Count consecutive errors
      for (const log of recentLogs) {
        if (log.status === 'failure') {
          consecutiveErrors++;
        } else {
          break;
        }
      }
    }

    const lastSuccessLog = recentLogs.find(l => l.status === 'success' || l.status === 'partial_success');

    const agentStatus = {
      name: 'Monitoring Agent',
      status,
      lastRunAt: recentLogs[0]?.created_at.toISOString() || null,
      lastSuccessAt: lastSuccessLog?.created_at.toISOString() || null,
      consecutiveErrors,
      totalCycles: allLogs._count || 0,
      totalEventsDetected: allLogs._sum.events_detected || 0,
      totalEventsPublished: allLogs._sum.events_published || 0,
      config: {
        organizationId,
        pollingIntervalMs: parseInt(process.env.MONITORING_DEFAULT_INTERVAL_MS || '15000', 10),
        geographicFilter: {
          radiusKm: orgContext?.geographic_radius_km || 100,
          strictMode: false,
        },
        riskFilter: {
          severityThreshold: orgContext?.severity_threshold || 0.5,
          monitoredRiskTypes: orgContext?.monitored_risk_types || [],
        },
      },
    };

    res.status(200).json({ success: true, data: agentStatus });
  } catch (error) {
    console.error('Get agent status error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get status' } });
  }
});

/**
 * Get monitoring audit logs for an organization
 */
app.get('/api/monitoring/logs', async (req: Request, res: Response) => {
  try {
     
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const { organizationId, limit: limitStr } = req.query;

    if (!organizationId || typeof organizationId !== 'string') {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'organizationId is required' } });
      return;
    }

    const limit = Math.min(parseInt(limitStr as string, 10) || 50, 100);

    // Check user has access to organization
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active' },
    });
    const membership = memberships.find((m: { organization_id: string }) => m.organization_id === organizationId);
    if (!membership) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied to organization' } });
      return;
    }

    const logs = await prisma.monitoringAuditLog.findMany({
      where: { organization_id: organizationId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    const formattedLogs = logs.map(log => ({
      id: log.id,
      organizationId: log.organization_id,
      eventType: log.event_type,
      status: log.status,
      eventsDetected: log.events_detected,
      eventsFiltered: log.events_filtered,
      eventsPublished: log.events_published,
      duplicatesFound: log.duplicates_found,
      durationMs: log.duration_ms,
      metadata: log.metadata as {
        toolsExecuted: number;
        toolsSucceeded: number;
        toolsFailed: number;
        errors: Array<{ tool: string; error: string; timestamp: string }>;
      },
      createdAt: log.created_at.toISOString(),
    }));

    res.status(200).json({ success: true, data: formattedLogs });
  } catch (error) {
    console.error('Get monitoring logs error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get logs' } });
  }
});

/**
 * Trigger a single monitoring cycle (for testing)
 */
app.post('/api/monitoring/trigger', async (req: Request, res: Response) => {
  try {
     
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const { organization_id } = req.body;

    if (!organization_id) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'organization_id is required' } });
      return;
    }

    // Check user has admin access to organization
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active' },
    });
    const membership = memberships.find((m: { organization_id: string; role: string }) => m.organization_id === organization_id);
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required to trigger monitoring' } });
      return;
    }

    // Dynamic import to avoid circular dependencies
    const { loadMonitoringConfig, getEnvironmentOverrides } = await import('../monitoring/config');
    const { runMonitoringCycle } = await import('../monitoring/index');

    // Load config and run cycle
    const envOverrides = getEnvironmentOverrides();
    const config = await loadMonitoringConfig(organization_id, envOverrides);
    const metrics = await runMonitoringCycle(config);

    res.status(200).json({
      success: true,
      data: {
        organizationId: organization_id,
        metrics: {
          durationMs: metrics.durationMs,
          eventsDetected: metrics.eventsDetected,
          eventsPublished: metrics.eventsPublished,
          duplicatesFiltered: metrics.duplicatesFiltered,
          geographyFiltered: metrics.geographyFiltered,
          severityFiltered: metrics.severityFiltered,
          toolsExecuted: metrics.toolsExecuted,
          toolsSucceeded: metrics.toolsSucceeded,
          toolsFailed: metrics.toolsFailed,
          errorCount: metrics.errors.length,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Trigger monitoring error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: (error as Error).message || 'Failed to trigger monitoring cycle',
      },
    });
  }
});

/**
 * Trigger monitoring cycle with SSE progress streaming
 */
app.get('/api/monitoring/trigger-stream', async (req: Request, res: Response) => {
  try {
     
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const organizationId = req.query.organizationId as string;

    if (!organizationId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'organizationId is required' } });
      return;
    }

    // Check user has admin access to organization
    const memberships = await prisma.userOrganization.findMany({
      where: { user_id: tokenPayload.userId, status: 'active' },
    });
    const membership = memberships.find((m: { organization_id: string; role: string }) => m.organization_id === organizationId);
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required to trigger monitoring' } });
      return;
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Stream connected' })}\n\n`);

    // Run cycle with progress updates - all errors handled inside to ensure proper SSE response
    try {
      // Dynamic import to avoid circular dependencies
      const { loadMonitoringConfig, getEnvironmentOverrides } = await import('../monitoring/config');
      const { runMonitoringCycle } = await import('../monitoring/index');

      // Progress callback - generic since type is imported dynamically
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onProgress = (update: any) => {
        try {
          res.write(`data: ${JSON.stringify({ type: 'progress', ...update })}\n\n`);
        } catch {
          // Client may have disconnected
        }
      };

      // Load config
      const envOverrides = getEnvironmentOverrides();
      const config = await loadMonitoringConfig(organizationId, envOverrides);

      const metrics = await runMonitoringCycle(config, onProgress);

      // Send final metrics
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        metrics: {
          durationMs: metrics.durationMs,
          eventsDetected: metrics.eventsDetected,
          eventsPublished: metrics.eventsPublished,
          duplicatesFiltered: metrics.duplicatesFiltered,
          geographyFiltered: metrics.geographyFiltered,
          severityFiltered: metrics.severityFiltered,
          toolsExecuted: metrics.toolsExecuted,
          toolsSucceeded: metrics.toolsSucceeded,
          toolsFailed: metrics.toolsFailed,
          errorCount: metrics.errors.length,
        },
        timestamp: new Date().toISOString(),
      })}\n\n`);
    } catch (error) {
      console.error('Monitoring cycle error:', error);
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: (error as Error).message || 'Monitoring cycle failed',
        timestamp: new Date().toISOString(),
      })}\n\n`);
    }

    // Close the stream
    res.end();
  } catch (error) {
    console.error('Trigger monitoring stream error:', error);
    // If headers not sent yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: (error as Error).message || 'Failed to start monitoring stream',
        },
      });
    } else {
      res.end();
    }
  }
});

// ============================================
// ORGANIZATION SETTINGS ENDPOINTS
// ============================================

// Helper to format settings for API response
function formatOrganizationSettings(settings: {
  id: string;
  organization_id: string;
  monitoring_agent_enabled: boolean;
  monitoring_polling_interval_ms: number;
  monitoring_enabled_sources: Prisma.JsonValue;
  ai_model_provider: string;
  ai_model_name: string;
  ai_model_temperature: number;
  ai_max_tokens: number;
  notifications_email_enabled: boolean;
  notifications_email_recipients: Prisma.JsonValue;
  notifications_severity_threshold: number;
  notifications_slack_enabled: boolean;
  notifications_slack_webhook_url: string | null;
  notifications_digest_enabled: boolean;
  notifications_digest_frequency: string;
  integration_sap_configured: boolean;
  integration_sap_last_sync: Date | null;
  integration_sap_sync_frequency: string;
  retention_events_days: number;
  retention_audit_logs_days: number;
  retention_incidents_days: number;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: settings.id,
    organizationId: settings.organization_id,
    // Agent Settings
    monitoringAgentEnabled: settings.monitoring_agent_enabled,
    monitoringPollingIntervalMs: settings.monitoring_polling_interval_ms,
    monitoringEnabledSources: settings.monitoring_enabled_sources,
    // AI Settings
    aiModelProvider: settings.ai_model_provider,
    aiModelName: settings.ai_model_name,
    aiModelTemperature: settings.ai_model_temperature,
    aiMaxTokens: settings.ai_max_tokens,
    // Notification Settings
    notificationsEmailEnabled: settings.notifications_email_enabled,
    notificationsEmailRecipients: settings.notifications_email_recipients,
    notificationsSeverityThreshold: settings.notifications_severity_threshold,
    notificationsSlackEnabled: settings.notifications_slack_enabled,
    notificationsSlackWebhookUrl: settings.notifications_slack_webhook_url,
    notificationsDigestEnabled: settings.notifications_digest_enabled,
    notificationsDigestFrequency: settings.notifications_digest_frequency,
    // Integration Status
    integrationSapConfigured: settings.integration_sap_configured,
    integrationSapLastSync: settings.integration_sap_last_sync?.toISOString() ?? null,
    integrationSapSyncFrequency: settings.integration_sap_sync_frequency,
    // Data Retention
    retentionEventsDays: settings.retention_events_days,
    retentionAuditLogsDays: settings.retention_audit_logs_days,
    retentionIncidentsDays: settings.retention_incidents_days,
    // Timestamps
    createdAt: settings.created_at.toISOString(),
    updatedAt: settings.updated_at.toISOString(),
  };
}

// Get organization settings
app.get('/api/organizations/:orgId/settings', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    // Get or create settings for this organization
    let settings = await prisma.organizationSettings.findUnique({
      where: { organization_id: orgId },
    });

    // If no settings exist, create with defaults
    if (!settings) {
      settings = await prisma.organizationSettings.create({
        data: { organization_id: orgId },
      });
    }

    res.status(200).json({ success: true, data: formatOrganizationSettings(settings) });
  } catch (error) {
    console.error('Get organization settings error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Update organization settings (partial update)
app.patch('/api/organizations/:orgId/settings', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    // Require ADMIN or OWNER for settings updates
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required to update settings' } });
      return;
    }

    // Extract allowed fields from body
    const {
      // Agent Settings
      monitoringAgentEnabled,
      monitoringPollingIntervalMs,
      monitoringEnabledSources,
      // AI Settings
      aiModelProvider,
      aiModelName,
      aiModelTemperature,
      aiMaxTokens,
      // Notification Settings
      notificationsEmailEnabled,
      notificationsEmailRecipients,
      notificationsSeverityThreshold,
      notificationsSlackEnabled,
      notificationsSlackWebhookUrl,
      notificationsDigestEnabled,
      notificationsDigestFrequency,
      // Integration Status
      integrationSapConfigured,
      integrationSapSyncFrequency,
      // Data Retention
      retentionEventsDays,
      retentionAuditLogsDays,
      retentionIncidentsDays,
    } = req.body;

    // Build update data only with provided fields (plain object for both create and update)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    // Agent Settings
    if (monitoringAgentEnabled !== undefined) updateData.monitoring_agent_enabled = monitoringAgentEnabled;
    if (monitoringPollingIntervalMs !== undefined) updateData.monitoring_polling_interval_ms = monitoringPollingIntervalMs;
    if (monitoringEnabledSources !== undefined) updateData.monitoring_enabled_sources = monitoringEnabledSources;

    // AI Settings
    if (aiModelProvider !== undefined) updateData.ai_model_provider = aiModelProvider;
    if (aiModelName !== undefined) updateData.ai_model_name = aiModelName;
    if (aiModelTemperature !== undefined) updateData.ai_model_temperature = aiModelTemperature;
    if (aiMaxTokens !== undefined) updateData.ai_max_tokens = aiMaxTokens;

    // Notification Settings
    if (notificationsEmailEnabled !== undefined) updateData.notifications_email_enabled = notificationsEmailEnabled;
    if (notificationsEmailRecipients !== undefined) updateData.notifications_email_recipients = notificationsEmailRecipients;
    if (notificationsSeverityThreshold !== undefined) updateData.notifications_severity_threshold = notificationsSeverityThreshold;
    if (notificationsSlackEnabled !== undefined) updateData.notifications_slack_enabled = notificationsSlackEnabled;
    if (notificationsSlackWebhookUrl !== undefined) updateData.notifications_slack_webhook_url = notificationsSlackWebhookUrl;
    if (notificationsDigestEnabled !== undefined) updateData.notifications_digest_enabled = notificationsDigestEnabled;
    if (notificationsDigestFrequency !== undefined) updateData.notifications_digest_frequency = notificationsDigestFrequency;

    // Integration Status
    if (integrationSapConfigured !== undefined) updateData.integration_sap_configured = integrationSapConfigured;
    if (integrationSapSyncFrequency !== undefined) updateData.integration_sap_sync_frequency = integrationSapSyncFrequency;

    // Data Retention
    if (retentionEventsDays !== undefined) updateData.retention_events_days = retentionEventsDays;
    if (retentionAuditLogsDays !== undefined) updateData.retention_audit_logs_days = retentionAuditLogsDays;
    if (retentionIncidentsDays !== undefined) updateData.retention_incidents_days = retentionIncidentsDays;

    // Upsert settings
    const settings = await prisma.organizationSettings.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId, ...updateData } as Prisma.OrganizationSettingsUncheckedCreateInput,
      update: updateData as Prisma.OrganizationSettingsUncheckedUpdateInput,
    });

    res.status(200).json({ success: true, data: formatOrganizationSettings(settings) });
  } catch (error) {
    console.error('Update organization settings error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Test notification endpoint
app.post('/api/organizations/:orgId/settings/notifications/test', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required to test notifications' } });
      return;
    }

    const { type } = req.body; // 'email' or 'slack'
    const settings = await prisma.organizationSettings.findUnique({
      where: { organization_id: orgId },
    });

    if (!settings) {
      res.status(400).json({ success: false, error: { code: 'NO_SETTINGS', message: 'Organization settings not configured' } });
      return;
    }

    if (type === 'slack') {
      if (!settings.notifications_slack_enabled || !settings.notifications_slack_webhook_url) {
        res.status(400).json({ success: false, error: { code: 'SLACK_NOT_CONFIGURED', message: 'Slack notifications are not configured' } });
        return;
      }

      // Send test Slack message
      const slackResponse = await fetch(settings.notifications_slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ':bell: *Pericles Test Notification*\nThis is a test notification from Pericles Supply Chain Risk Management.',
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!slackResponse.ok) {
        res.status(400).json({ success: false, error: { code: 'SLACK_FAILED', message: 'Failed to send Slack notification' } });
        return;
      }

      res.status(200).json({ success: true, data: { message: 'Test Slack notification sent successfully' } });
    } else if (type === 'email') {
      // For now, just validate that email is configured
      if (!settings.notifications_email_enabled) {
        res.status(400).json({ success: false, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email notifications are not enabled' } });
        return;
      }

      const recipients = settings.notifications_email_recipients as string[];
      if (!recipients || recipients.length === 0) {
        res.status(400).json({ success: false, error: { code: 'NO_RECIPIENTS', message: 'No email recipients configured' } });
        return;
      }

      // Email sending would be implemented here with a service like SendGrid/Resend
      // For now, return success indicating the configuration is valid
      res.status(200).json({
        success: true,
        data: {
          message: 'Email configuration validated. Email sending is not yet implemented.',
          recipients: recipients,
        },
      });
    } else {
      res.status(400).json({ success: false, error: { code: 'INVALID_TYPE', message: 'Notification type must be "email" or "slack"' } });
    }
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// ============================================================================
// DATA SOURCE TOOL CONFIGURATION ENDPOINTS
// ============================================================================

import {
  DATA_SOURCE_DEFINITIONS,
  getToolDefinition,
  getDefaultToolConfig,
  validateToolConfig,
  type DataSourceCategory,
} from '../monitoring/tool-configs.js';

// Format tool config for API response
function formatToolConfig(config: {
  id: string;
  organization_id: string;
  data_source: string;
  tool_id: string;
  tool_name: string;
  enabled: boolean;
  api_timeout_ms: number;
  severity_threshold: number;
  lookback_hours: number;
  config: unknown;
  api_key_encrypted: string | null;
  api_key_env_var: string | null;
  description: string | null;
  documentation_url: string | null;
  last_success_at: Date | null;
  last_error_at: Date | null;
  last_error_message: string | null;
  total_events_fetched: number;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: config.id,
    organizationId: config.organization_id,
    dataSource: config.data_source,
    toolId: config.tool_id,
    toolName: config.tool_name,
    enabled: config.enabled,
    apiTimeoutMs: config.api_timeout_ms,
    severityThreshold: config.severity_threshold,
    lookbackHours: config.lookback_hours,
    config: config.config,
    apiKeyConfigured: !!config.api_key_encrypted || !!config.api_key_env_var,
    apiKeyEnvVar: config.api_key_env_var,
    description: config.description,
    documentationUrl: config.documentation_url,
    lastSuccessAt: config.last_success_at?.toISOString() ?? null,
    lastErrorAt: config.last_error_at?.toISOString() ?? null,
    lastErrorMessage: config.last_error_message,
    totalEventsFetched: config.total_events_fetched,
    createdAt: config.created_at.toISOString(),
    updatedAt: config.updated_at.toISOString(),
  };
}

// GET /api/data-sources - Get available data source definitions (public, no auth)
app.get('/api/data-sources', (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: DATA_SOURCE_DEFINITIONS });
});

// GET /api/organizations/:orgId/tool-configs - Get all tool configs for an organization
app.get('/api/organizations/:orgId/tool-configs', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    const configs = await prisma.dataSourceToolConfig.findMany({
      where: { organization_id: orgId },
      orderBy: [{ data_source: 'asc' }, { tool_id: 'asc' }],
    });

    res.status(200).json({ success: true, data: configs.map(formatToolConfig) });
  } catch (error) {
    console.error('Get tool configs error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// GET /api/organizations/:orgId/tool-configs/:dataSource - Get configs for a specific data source
app.get('/api/organizations/:orgId/tool-configs/:dataSource', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const dataSource = getParam(req.params.dataSource);

    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    // Validate data source
    const sourceDefinition = DATA_SOURCE_DEFINITIONS.find(ds => ds.id === dataSource);
    if (!sourceDefinition) {
      res.status(400).json({ success: false, error: { code: 'INVALID_DATA_SOURCE', message: `Invalid data source: ${dataSource}` } });
      return;
    }

    const configs = await prisma.dataSourceToolConfig.findMany({
      where: { organization_id: orgId, data_source: dataSource },
      orderBy: { tool_id: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: {
        dataSource: sourceDefinition,
        configs: configs.map(formatToolConfig),
      },
    });
  } catch (error) {
    console.error('Get data source configs error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// GET /api/organizations/:orgId/tool-configs/:dataSource/:toolId - Get a specific tool config
app.get('/api/organizations/:orgId/tool-configs/:dataSource/:toolId', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const dataSource = getParam(req.params.dataSource) as DataSourceCategory;
    const toolId = getParam(req.params.toolId);

    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    // Get tool definition for validation and defaults
    const toolDef = getToolDefinition(dataSource, toolId);
    if (!toolDef) {
      res.status(400).json({ success: false, error: { code: 'INVALID_TOOL', message: `Invalid tool: ${dataSource}/${toolId}` } });
      return;
    }

    const config = await prisma.dataSourceToolConfig.findUnique({
      where: {
        organization_id_data_source_tool_id: {
          organization_id: orgId,
          data_source: dataSource,
          tool_id: toolId,
        },
      },
    });

    if (!config) {
      // Return default config if not yet customized
      res.status(200).json({
        success: true,
        data: {
          id: null,
          organizationId: orgId,
          dataSource,
          toolId,
          toolName: toolDef.name,
          enabled: toolDef.defaultEnabled,
          apiTimeoutMs: toolDef.defaultTimeoutMs,
          severityThreshold: toolDef.defaultSeverityThreshold,
          lookbackHours: toolDef.defaultLookbackHours,
          config: getDefaultToolConfig(toolDef),
          apiKeyConfigured: false,
          apiKeyEnvVar: toolDef.apiKeyEnvVar ?? null,
          description: toolDef.description,
          documentationUrl: toolDef.documentationUrl ?? null,
          lastSuccessAt: null,
          lastErrorAt: null,
          lastErrorMessage: null,
          totalEventsFetched: 0,
          createdAt: null,
          updatedAt: null,
          isDefault: true,
          toolDefinition: toolDef,
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        ...formatToolConfig(config),
        isDefault: false,
        toolDefinition: toolDef,
      },
    });
  } catch (error) {
    console.error('Get tool config error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// PUT /api/organizations/:orgId/tool-configs/:dataSource/:toolId - Create or update a tool config
app.put('/api/organizations/:orgId/tool-configs/:dataSource/:toolId', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const dataSource = getParam(req.params.dataSource) as DataSourceCategory;
    const toolId = getParam(req.params.toolId);

    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    // Require ADMIN or OWNER for tool config updates
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required to update tool configurations' } });
      return;
    }

    // Get tool definition for validation
    const toolDef = getToolDefinition(dataSource, toolId);
    if (!toolDef) {
      res.status(400).json({ success: false, error: { code: 'INVALID_TOOL', message: `Invalid tool: ${dataSource}/${toolId}` } });
      return;
    }

    const {
      enabled,
      apiTimeoutMs,
      severityThreshold,
      lookbackHours,
      config,
      apiKeyEnvVar,
      description,
    } = req.body;

    // Validate tool-specific config if provided
    if (config !== undefined) {
      const validation = validateToolConfig(toolDef, config);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIG', message: 'Invalid tool configuration', details: validation.errors },
        });
        return;
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (enabled !== undefined) updateData.enabled = enabled;
    if (apiTimeoutMs !== undefined) updateData.api_timeout_ms = apiTimeoutMs;
    if (severityThreshold !== undefined) updateData.severity_threshold = severityThreshold;
    if (lookbackHours !== undefined) updateData.lookback_hours = lookbackHours;
    if (config !== undefined) updateData.config = config;
    if (apiKeyEnvVar !== undefined) updateData.api_key_env_var = apiKeyEnvVar;
    if (description !== undefined) updateData.description = description;

    const updatedConfig = await prisma.dataSourceToolConfig.upsert({
      where: {
        organization_id_data_source_tool_id: {
          organization_id: orgId,
          data_source: dataSource,
          tool_id: toolId,
        },
      },
      create: {
        organization_id: orgId,
        data_source: dataSource,
        tool_id: toolId,
        tool_name: toolDef.name,
        enabled: enabled ?? toolDef.defaultEnabled,
        api_timeout_ms: apiTimeoutMs ?? toolDef.defaultTimeoutMs,
        severity_threshold: severityThreshold ?? toolDef.defaultSeverityThreshold,
        lookback_hours: lookbackHours ?? toolDef.defaultLookbackHours,
        config: config ?? getDefaultToolConfig(toolDef),
        api_key_env_var: apiKeyEnvVar ?? toolDef.apiKeyEnvVar ?? null,
        description: description ?? toolDef.description,
        documentation_url: toolDef.documentationUrl ?? null,
      },
      update: updateData,
    });

    res.status(200).json({
      success: true,
      data: {
        ...formatToolConfig(updatedConfig),
        toolDefinition: toolDef,
      },
    });
  } catch (error) {
    console.error('Update tool config error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// DELETE /api/organizations/:orgId/tool-configs/:dataSource/:toolId - Delete a tool config (reset to defaults)
app.delete('/api/organizations/:orgId/tool-configs/:dataSource/:toolId', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const dataSource = getParam(req.params.dataSource) as DataSourceCategory;
    const toolId = getParam(req.params.toolId);

    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    // Require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required to delete tool configurations' } });
      return;
    }

    await prisma.dataSourceToolConfig.deleteMany({
      where: {
        organization_id: orgId,
        data_source: dataSource,
        tool_id: toolId,
      },
    });

    res.status(200).json({ success: true, data: { message: 'Tool configuration reset to defaults' } });
  } catch (error) {
    console.error('Delete tool config error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// POST /api/organizations/:orgId/tool-configs/seed-defaults - Seed default configs for all tools
app.post('/api/organizations/:orgId/tool-configs/seed-defaults', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found' } });
      return;
    }

    // Require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required to seed tool configurations' } });
      return;
    }

    const { overwrite } = req.body;
    const created: string[] = [];
    const skipped: string[] = [];

    for (const dataSource of DATA_SOURCE_DEFINITIONS) {
      for (const tool of dataSource.tools) {
        const existing = await prisma.dataSourceToolConfig.findUnique({
          where: {
            organization_id_data_source_tool_id: {
              organization_id: orgId,
              data_source: dataSource.id,
              tool_id: tool.id,
            },
          },
        });

        if (existing && !overwrite) {
          skipped.push(`${dataSource.id}/${tool.id}`);
          continue;
        }

        await prisma.dataSourceToolConfig.upsert({
          where: {
            organization_id_data_source_tool_id: {
              organization_id: orgId,
              data_source: dataSource.id,
              tool_id: tool.id,
            },
          },
          create: {
            organization_id: orgId,
            data_source: dataSource.id,
            tool_id: tool.id,
            tool_name: tool.name,
            enabled: tool.defaultEnabled,
            api_timeout_ms: tool.defaultTimeoutMs,
            severity_threshold: tool.defaultSeverityThreshold,
            lookback_hours: tool.defaultLookbackHours,
            config: getDefaultToolConfig(tool),
            api_key_env_var: tool.apiKeyEnvVar ?? null,
            description: tool.description,
            documentation_url: tool.documentationUrl ?? null,
          },
          update: overwrite
            ? {
                tool_name: tool.name,
                enabled: tool.defaultEnabled,
                api_timeout_ms: tool.defaultTimeoutMs,
                severity_threshold: tool.defaultSeverityThreshold,
                lookback_hours: tool.defaultLookbackHours,
                config: getDefaultToolConfig(tool),
                api_key_env_var: tool.apiKeyEnvVar ?? null,
                description: tool.description,
                documentation_url: tool.documentationUrl ?? null,
              }
            : {},
        });

        created.push(`${dataSource.id}/${tool.id}`);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        message: 'Default tool configurations seeded',
        created: created.length,
        skipped: skipped.length,
        tools: { created, skipped },
      },
    });
  } catch (error) {
    console.error('Seed tool configs error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// PUT /api/organizations/:orgId/tool-configs/:dataSource/:toolId/api-key - Save API key for a tool
app.put('/api/organizations/:orgId/tool-configs/:dataSource/:toolId/api-key', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const orgId = getParam(req.params.orgId);
    const dataSource = getParam(req.params.dataSource);
    const toolId = getParam(req.params.toolId);
    const { apiKey, useEnvVar } = req.body;

    // Check if user has access to this organization (must be ADMIN or OWNER)
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (!membership || !['ADMIN', 'OWNER'].includes(membership.role)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }

    // Verify tool exists
    const toolDef = getToolDefinition(dataSource as DataSourceCategory, toolId);
    if (!toolDef) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tool not found' } });
    }

    // Find or create the config
    let config = await prisma.dataSourceToolConfig.findUnique({
      where: { organization_id_data_source_tool_id: { organization_id: orgId, data_source: dataSource, tool_id: toolId } },
    });

    if (useEnvVar) {
      // Use environment variable - store the env var name, clear any stored key
      const envVarName = toolDef.apiKeyEnvVar || `${toolId.toUpperCase()}_API_KEY`;

      if (config) {
        config = await prisma.dataSourceToolConfig.update({
          where: { id: config.id },
          data: {
            api_key_env_var: envVarName,
            api_key_encrypted: null,
          },
        });
      } else {
        config = await prisma.dataSourceToolConfig.create({
          data: {
            organization_id: orgId,
            data_source: dataSource,
            tool_id: toolId,
            tool_name: toolDef.name,
            enabled: toolDef.defaultEnabled,
            api_timeout_ms: toolDef.defaultTimeoutMs,
            severity_threshold: toolDef.defaultSeverityThreshold,
            lookback_hours: toolDef.defaultLookbackHours,
            config: getDefaultToolConfig(toolDef),
            api_key_env_var: envVarName,
            api_key_encrypted: null,
            description: toolDef.description,
            documentation_url: toolDef.documentationUrl ?? null,
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          message: 'API key configured to use environment variable',
          envVar: envVarName,
          isConfigured: !!process.env[envVarName],
        },
      });
    } else if (apiKey) {
      // Store the API key directly (base64 encoded for basic obfuscation - in production use proper encryption)
      const encodedKey = Buffer.from(apiKey).toString('base64');

      if (config) {
        config = await prisma.dataSourceToolConfig.update({
          where: { id: config.id },
          data: {
            api_key_encrypted: encodedKey,
            api_key_env_var: null,
          },
        });
      } else {
        config = await prisma.dataSourceToolConfig.create({
          data: {
            organization_id: orgId,
            data_source: dataSource,
            tool_id: toolId,
            tool_name: toolDef.name,
            enabled: toolDef.defaultEnabled,
            api_timeout_ms: toolDef.defaultTimeoutMs,
            severity_threshold: toolDef.defaultSeverityThreshold,
            lookback_hours: toolDef.defaultLookbackHours,
            config: getDefaultToolConfig(toolDef),
            api_key_env_var: null,
            api_key_encrypted: encodedKey,
            description: toolDef.description,
            documentation_url: toolDef.documentationUrl ?? null,
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          message: 'API key saved successfully',
          isConfigured: true,
        },
      });
    } else {
      // Clear API key
      if (config) {
        await prisma.dataSourceToolConfig.update({
          where: { id: config.id },
          data: {
            api_key_encrypted: null,
            api_key_env_var: null,
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          message: 'API key cleared',
          isConfigured: false,
        },
      });
    }
  } catch (error) {
    console.error('Save API key error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// POST /api/organizations/:orgId/tool-configs/:dataSource/:toolId/test-api-key - Test API key for a tool
app.post('/api/organizations/:orgId/tool-configs/:dataSource/:toolId/test-api-key', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const orgId = getParam(req.params.orgId);
    const dataSource = getParam(req.params.dataSource);
    const toolId = getParam(req.params.toolId);
    const { apiKey } = req.body; // Optional - if not provided, use stored key

    // Check if user has access to this organization
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    // Verify tool exists
    const toolDef = getToolDefinition(dataSource as DataSourceCategory, toolId);
    if (!toolDef) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tool not found' } });
    }

    // Get the API key to test
    let testKey = apiKey;
    if (!testKey) {
      // Try to get from stored config or environment
      const config = await prisma.dataSourceToolConfig.findUnique({
        where: { organization_id_data_source_tool_id: { organization_id: orgId, data_source: dataSource, tool_id: toolId } },
      });

      if (config?.api_key_encrypted) {
        testKey = Buffer.from(config.api_key_encrypted, 'base64').toString('utf-8');
      } else if (config?.api_key_env_var) {
        testKey = process.env[config.api_key_env_var];
      } else if (toolDef.apiKeyEnvVar) {
        testKey = process.env[toolDef.apiKeyEnvVar];
      }
    }

    if (!testKey && toolDef.requiresApiKey) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_API_KEY', message: 'No API key provided or configured' },
      });
    }

    // Test the API key based on the tool type
    let testResult: { success: boolean; message: string; details?: string };

    try {
      switch (toolId) {
        case 'thenewsapi': {
          const response = await fetch(`https://api.thenewsapi.com/v1/news/all?api_token=${testKey}&limit=1`, {
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            testResult = { success: true, message: 'TheNewsAPI key is valid' };
          } else if (response.status === 401 || response.status === 403) {
            testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        case 'twitter': {
          const response = await fetch('https://api.twitterapi.io/twitter/user/details?userName=twitter', {
            headers: { 'X-API-Key': testKey || '' },
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            testResult = { success: true, message: 'Twitter API.io key is valid' };
          } else if (response.status === 401 || response.status === 403) {
            testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        case 'openweather': {
          const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${testKey}`, {
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            testResult = { success: true, message: 'OpenWeather API key is valid' };
          } else if (response.status === 401) {
            testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        case 'nvd': {
          // NVD works without a key but is rate-limited
          const url = testKey
            ? `https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1`
            : `https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1`;
          const headers: Record<string, string> = {};
          if (testKey) {
            // eslint-disable-next-line @typescript-eslint/dot-notation -- 'apiKey' is the actual NVD API header name
            headers['apiKey'] = testKey;
          }
          const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
          if (response.ok) {
            testResult = { success: true, message: testKey ? 'NVD API key is valid' : 'NVD API is accessible (no key required)' };
          } else if (response.status === 403) {
            testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        case 'fred': {
          const response = await fetch(`https://api.stlouisfed.org/fred/series?series_id=GNPCA&api_key=${testKey}&file_type=json`, {
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            testResult = { success: true, message: 'FRED API key is valid' };
          } else if (response.status === 400) {
            const data = await response.json().catch(() => ({}));
            if (data.error_message?.includes('api_key')) {
              testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
            } else {
              testResult = { success: false, message: `API error: ${data.error_message || 'Unknown error'}` };
            }
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        default:
          // For tools without specific test endpoints, just verify the key exists
          if (!toolDef.requiresApiKey) {
            testResult = { success: true, message: 'This tool does not require an API key' };
          } else if (testKey) {
            testResult = { success: true, message: 'API key is configured (unable to verify with API)' };
          } else {
            testResult = { success: false, message: 'No API key configured' };
          }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        testResult = { success: false, message: 'API request timed out' };
      } else {
        testResult = { success: false, message: 'Failed to connect to API', details: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // Update last test status in database if we have a config
    const config = await prisma.dataSourceToolConfig.findUnique({
      where: { organization_id_data_source_tool_id: { organization_id: orgId, data_source: dataSource, tool_id: toolId } },
    });

    if (config) {
      if (testResult.success) {
        await prisma.dataSourceToolConfig.update({
          where: { id: config.id },
          data: { last_success_at: new Date(), last_error_at: null, last_error_message: null },
        });
      } else {
        await prisma.dataSourceToolConfig.update({
          where: { id: config.id },
          data: { last_error_at: new Date(), last_error_message: testResult.message },
        });
      }
    }

    res.status(200).json({
      success: true,
      data: testResult,
    });
  } catch (error) {
    console.error('Test API key error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// GET /api/organizations/:orgId/tool-configs/:dataSource/:toolId/api-key-status - Get API key status for a tool
app.get('/api/organizations/:orgId/tool-configs/:dataSource/:toolId/api-key-status', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const orgId = getParam(req.params.orgId);
    const dataSource = getParam(req.params.dataSource);
    const toolId = getParam(req.params.toolId);

    // Check if user has access to this organization
    const membership = await prisma.userOrganization.findUnique({
      where: { user_id_organization_id: { user_id: tokenPayload.userId, organization_id: orgId } },
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    // Verify tool exists
    const toolDef = getToolDefinition(dataSource as DataSourceCategory, toolId);
    if (!toolDef) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tool not found' } });
    }

    // Get config
    const config = await prisma.dataSourceToolConfig.findUnique({
      where: { organization_id_data_source_tool_id: { organization_id: orgId, data_source: dataSource, tool_id: toolId } },
    });

    // Determine API key status
    let status: 'not_required' | 'configured' | 'env_var' | 'not_configured';
    let envVarName: string | null = null;
    let envVarConfigured = false;

    if (!toolDef.requiresApiKey && !toolDef.apiKeyEnvVar) {
      status = 'not_required';
    } else if (config?.api_key_encrypted) {
      status = 'configured';
    } else if (config?.api_key_env_var || toolDef.apiKeyEnvVar) {
      envVarName = config?.api_key_env_var || toolDef.apiKeyEnvVar || null;
      envVarConfigured = envVarName ? !!process.env[envVarName] : false;
      status = envVarConfigured ? 'env_var' : 'not_configured';
    } else {
      status = 'not_configured';
    }

    res.status(200).json({
      success: true,
      data: {
        requiresApiKey: toolDef.requiresApiKey ?? false,
        apiKeyLabel: toolDef.apiKeyLabel,
        apiKeyEnvVar: toolDef.apiKeyEnvVar,
        status,
        envVarName,
        envVarConfigured,
        lastSuccessAt: config?.last_success_at ?? null,
        lastErrorAt: config?.last_error_at ?? null,
        lastErrorMessage: config?.last_error_message ?? null,
      },
    });
  } catch (error) {
    console.error('Get API key status error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// =============================================================================
// WORKFLOW ROUTES (Plans workflow builder)
// =============================================================================

const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  executionMode: z.enum(['MANUAL', 'AUTOMATIC', 'BOTH']).optional().default('MANUAL'),
});

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  executionMode: z.enum(['MANUAL', 'AUTOMATIC', 'BOTH']).optional(),
  isActive: z.boolean().optional(),
  viewportX: z.number().optional(),
  viewportY: z.number().optional(),
  viewportZoom: z.number().optional(),
});

const WorkflowNodeSchema = z.object({
  clientId: z.string(),
  type: z.enum(['TRIGGER', 'ACTION', 'CONDITION', 'NOTIFICATION', 'END']),
  label: z.string().optional(),
  positionX: z.number(),
  positionY: z.number(),
  data: z.record(z.unknown()).optional().default({}),
});

const WorkflowEdgeSchema = z.object({
  clientId: z.string(),
  sourceNodeClientId: z.string(),
  targetNodeClientId: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
  data: z.record(z.unknown()).optional().default({}),
});

const SaveWorkflowStateSchema = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  viewportX: z.number().optional(),
  viewportY: z.number().optional(),
  viewportZoom: z.number().optional(),
});

// Format workflow for API response
function formatWorkflow(
  workflow: {
    id: string;
    organization_id: string;
    name: string;
    description: string | null;
    status: string;
    version: number;
    viewport_x: number;
    viewport_y: number;
    viewport_zoom: number;
    execution_mode: string;
    is_active: boolean;
    created_by: string;
    created_at: Date;
    updated_at: Date;
    nodes?: Array<{
      id: string;
      client_id: string;
      type: string;
      label: string | null;
      position_x: number;
      position_y: number;
      data: Prisma.JsonValue;
      created_at: Date;
      updated_at: Date;
    }>;
    edges?: Array<{
      id: string;
      client_id: string;
      source_node_id: string;
      target_node_id: string;
      source_handle: string | null;
      target_handle: string | null;
      label: string | null;
      data: Prisma.JsonValue;
      created_at: Date;
      updated_at: Date;
    }>;
    _count?: { nodes: number; edges: number; executions: number };
  },
  nodeClientIdMap?: Map<string, string>
) {
  return {
    id: workflow.id,
    organizationId: workflow.organization_id,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    version: workflow.version,
    viewport: {
      x: workflow.viewport_x,
      y: workflow.viewport_y,
      zoom: workflow.viewport_zoom,
    },
    executionMode: workflow.execution_mode,
    isActive: workflow.is_active,
    createdBy: workflow.created_by,
    createdAt: workflow.created_at.toISOString(),
    updatedAt: workflow.updated_at.toISOString(),
    nodes: workflow.nodes?.map((node) => ({
      id: node.id,
      clientId: node.client_id,
      type: node.type,
      label: node.label,
      position: { x: node.position_x, y: node.position_y },
      data: node.data,
    })),
    edges: workflow.edges?.map((edge) => ({
      id: edge.id,
      clientId: edge.client_id,
      source: nodeClientIdMap?.get(edge.source_node_id) || edge.source_node_id,
      target: nodeClientIdMap?.get(edge.target_node_id) || edge.target_node_id,
      sourceHandle: edge.source_handle,
      targetHandle: edge.target_handle,
      label: edge.label,
      data: edge.data,
    })),
    counts: workflow._count,
  };
}

// Two access helpers for the workflow routes below — deliberately NOT one.
//
// A single earlier version delegated every workflow route (reads AND writes)
// to the shared checkOrganizationAccess (already used by /api/suppliers,
// /api/shipments, /api/events, etc.), fixing the read-side bug (#40: a
// root-org user, or a user whose membership is on a PARENT org viewing a
// subsidiary via the hierarchy rollup, got a bare 404 "Organization not
// found" browsing Plans while every sibling endpoint on the same page let
// them through). But checkOrganizationAccess's root/ancestor branches return
// the role from the GRANTING org, not the target org, and only check that
// grant is active — never whether the user has an explicit (e.g. suspended)
// row on the TARGET org itself. Applied uniformly, that would have let a
// parent-org ADMIN with zero membership in a subsidiary create/publish/
// **execute** workflows there (execute can have real side effects in 'run'
// mode — see pericles-execution-node), and let an active ancestor-org
// membership bypass an explicit suspension scoped to the target org. Read
// visibility rollup is the established, accepted pattern here; silently
// broadening WRITE/EXECUTE the same way is a different risk this ticket
// didn't ask for, so it's scoped out — reads get the fix, writes keep
// requiring direct membership on the target org, exactly as before.

// Reads (list/get/executions): hierarchy + root rollup, no role requirement
// (matches how the read-only sibling endpoints already use this helper).
async function checkOrgReadAccess(
  userId: string,
  orgId: string
): Promise<{ error: { status: number; code: string; message: string } | null }> {
  const access = await checkOrganizationAccess(userId, orgId);
  if (!access.hasAccess) {
    return { error: { status: 403, code: 'FORBIDDEN', message: 'Access denied to this organization' } };
  }
  return { error: null };
}

// Writes (create/update/save-state/delete/publish/archive/execute): direct
// membership on the target org only — unchanged from before this ticket,
// aside from the error code (403, not 404 — see checkOrganizationAccess's
// other callers: a 404 on an access check leaks whether the org exists).
async function checkOrgWriteMembership(
  userId: string,
  orgId: string,
  requiredRoles: string[]
): Promise<{ error: { status: number; code: string; message: string } | null }> {
  const membership = await prisma.userOrganization.findUnique({
    where: { user_id_organization_id: { user_id: userId, organization_id: orgId } },
  });

  if (membership?.status !== 'active') {
    return { error: { status: 403, code: 'FORBIDDEN', message: 'Access denied to this organization' } };
  }

  if (!requiredRoles.includes(membership.role)) {
    return { error: { status: 403, code: 'FORBIDDEN', message: 'Insufficient permissions' } };
  }

  return { error: null };
}

// List workflows for an organization
app.get('/api/organizations/:orgId/workflows', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const { error } = await checkOrgReadAccess(tokenPayload.userId, orgId);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    const status = req.query.status as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | undefined;
    const workflows = await prisma.workflow.findMany({
      where: {
        organization_id: orgId,
        ...(status && { status }),
      },
      include: {
        _count: { select: { nodes: true, edges: true, executions: true } },
      },
      orderBy: { updated_at: 'desc' },
    });

    res.status(200).json({
      success: true,
      data: workflows.map((w) => formatWorkflow(w)),
    });
  } catch (error) {
    console.error('List workflows error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Create workflow
app.post('/api/organizations/:orgId/workflows', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const { error } = await checkOrgWriteMembership(tokenPayload.userId, orgId, ['OWNER', 'ADMIN']);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    const parseResult = CreateWorkflowSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message } });
      return;
    }

    const { name, description, executionMode } = parseResult.data;

    // Check for duplicate name
    const existing = await prisma.workflow.findUnique({
      where: { organization_id_name: { organization_id: orgId, name } },
    });
    if (existing) {
      res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'A workflow with this name already exists' } });
      return;
    }

    // Create workflow with default nodes and edges in a transaction
    const workflow = await prisma.$transaction(async (tx) => {
      // Create the workflow
      const wf = await tx.workflow.create({
        data: {
          organization_id: orgId,
          name,
          description: description || null,
          execution_mode: executionMode as ExecutionMode,
          created_by: tokenPayload.userId,
          viewport_x: 0,
          viewport_y: 0,
          viewport_zoom: 1,
        },
      });

      // Default node configuration matching the visual layout:
      // Trigger -> Flow1-A -> [Flow1-B (upper)] \
      //                    -> [Flow1-C -> Flow1-D (lower)] -> Flow1-E -> Resolved
      // Spread out horizontally for better visibility
      const defaultNodes = [
        { clientId: 'trigger-1', type: 'TRIGGER' as NodeType, label: 'Trigger', x: 50, y: 150, data: { subtitle: 'Configure' } },
        { clientId: 'action-1', type: 'ACTION' as NodeType, label: 'Flow 1', x: 220, y: 150, data: { owner: '', rules: [] } },
        { clientId: 'action-2', type: 'ACTION' as NodeType, label: 'Flow 1', x: 420, y: 50, data: { owner: '', rules: [] } },
        { clientId: 'action-3', type: 'ACTION' as NodeType, label: 'Flow 1', x: 420, y: 250, data: { owner: '', rules: [] } },
        { clientId: 'action-4', type: 'ACTION' as NodeType, label: 'Flow 1', x: 620, y: 250, data: { owner: '', rules: [] } },
        { clientId: 'action-5', type: 'ACTION' as NodeType, label: 'Flow 1', x: 820, y: 150, data: { owner: '', rules: [] } },
        { clientId: 'end-1', type: 'END' as NodeType, label: 'Resolved', x: 1020, y: 150, data: {} },
      ];

      // Create nodes
      const createdNodes: Array<{ id: string; clientId: string }> = [];
      for (const node of defaultNodes) {
        const created = await tx.workflowNode.create({
          data: {
            workflow_id: wf.id,
            client_id: node.clientId,
            type: node.type,
            label: node.label,
            position_x: node.x,
            position_y: node.y,
            data: node.data,
          },
        });
        createdNodes.push({ id: created.id, clientId: node.clientId });
      }

      // Helper to get node ID by client ID
      const getNodeId = (clientId: string) => createdNodes.find(n => n.clientId === clientId)?.id || '';

      // Default edges connecting the nodes
      const defaultEdges = [
        { clientId: 'edge-1', sourceClientId: 'trigger-1', targetClientId: 'action-1' },
        { clientId: 'edge-2', sourceClientId: 'action-1', targetClientId: 'action-2' },
        { clientId: 'edge-3', sourceClientId: 'action-1', targetClientId: 'action-3' },
        { clientId: 'edge-4', sourceClientId: 'action-2', targetClientId: 'action-5' },
        { clientId: 'edge-5', sourceClientId: 'action-3', targetClientId: 'action-4' },
        { clientId: 'edge-6', sourceClientId: 'action-4', targetClientId: 'action-5' },
        { clientId: 'edge-7', sourceClientId: 'action-5', targetClientId: 'end-1' },
      ];

      // Create edges
      for (const edge of defaultEdges) {
        await tx.workflowEdge.create({
          data: {
            workflow_id: wf.id,
            client_id: edge.clientId,
            source_node_id: getNodeId(edge.sourceClientId),
            target_node_id: getNodeId(edge.targetClientId),
          },
        });
      }

      // Return workflow with counts
      return tx.workflow.findUnique({
        where: { id: wf.id },
        include: {
          _count: { select: { nodes: true, edges: true, executions: true } },
        },
      });
    });

    if (!workflow) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create workflow' } });
      return;
    }

    res.status(201).json({ success: true, data: formatWorkflow(workflow) });
  } catch (error) {
    console.error('Create workflow error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Get single workflow with nodes and edges
app.get('/api/organizations/:orgId/workflows/:workflowId', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const workflowId = getParam(req.params.workflowId);
    const { error } = await checkOrgReadAccess(tokenPayload.userId, orgId);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, organization_id: orgId },
      include: {
        nodes: { orderBy: { created_at: 'asc' } },
        edges: { orderBy: { created_at: 'asc' } },
        _count: { select: { nodes: true, edges: true, executions: true } },
      },
    });

    if (!workflow) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
      return;
    }

    // Create a map from node id to client_id for edge formatting
    const nodeClientIdMap = new Map(workflow.nodes.map((n) => [n.id, n.client_id]));

    res.status(200).json({ success: true, data: formatWorkflow(workflow, nodeClientIdMap) });
  } catch (error) {
    console.error('Get workflow error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Update workflow metadata
app.patch('/api/organizations/:orgId/workflows/:workflowId', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const workflowId = getParam(req.params.workflowId);
    const { error } = await checkOrgWriteMembership(tokenPayload.userId, orgId, ['OWNER', 'ADMIN']);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    const parseResult = UpdateWorkflowSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message } });
      return;
    }

    const existing = await prisma.workflow.findFirst({ where: { id: workflowId, organization_id: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
      return;
    }

    const { name, description, executionMode, isActive, viewportX, viewportY, viewportZoom } = parseResult.data;

    // Check for duplicate name if changing
    if (name && name !== existing.name) {
      const duplicate = await prisma.workflow.findUnique({
        where: { organization_id_name: { organization_id: orgId, name } },
      });
      if (duplicate) {
        res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'A workflow with this name already exists' } });
        return;
      }
    }

    const workflow = await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(executionMode !== undefined && { execution_mode: executionMode as ExecutionMode }),
        ...(isActive !== undefined && { is_active: isActive }),
        ...(viewportX !== undefined && { viewport_x: viewportX }),
        ...(viewportY !== undefined && { viewport_y: viewportY }),
        ...(viewportZoom !== undefined && { viewport_zoom: viewportZoom }),
      },
      include: {
        _count: { select: { nodes: true, edges: true, executions: true } },
      },
    });

    res.status(200).json({ success: true, data: formatWorkflow(workflow) });
  } catch (error) {
    console.error('Update workflow error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Save workflow state (nodes and edges) - replaces all
app.put('/api/organizations/:orgId/workflows/:workflowId/state', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const workflowId = getParam(req.params.workflowId);
    const { error } = await checkOrgWriteMembership(tokenPayload.userId, orgId, ['OWNER', 'ADMIN']);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    const parseResult = SaveWorkflowStateSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message } });
      return;
    }

    const existing = await prisma.workflow.findFirst({ where: { id: workflowId, organization_id: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
      return;
    }

    const { nodes, edges, viewportX, viewportY, viewportZoom } = parseResult.data;

    // Use a transaction to replace nodes and edges
    const workflow = await prisma.$transaction(async (tx) => {
      // Delete existing edges first (due to FK constraints)
      await tx.workflowEdge.deleteMany({ where: { workflow_id: workflowId } });
      // Delete existing nodes
      await tx.workflowNode.deleteMany({ where: { workflow_id: workflowId } });

      // Create nodes
      const createdNodes = await Promise.all(
        nodes.map((node) =>
          tx.workflowNode.create({
            data: {
              workflow_id: workflowId,
              client_id: node.clientId,
              type: node.type,
              label: node.label || null,
              position_x: node.positionX,
              position_y: node.positionY,
              data: (node.data || {}) as Prisma.InputJsonValue,
            },
          })
        )
      );

      // Map client_id to node id for edges
      const clientIdToNodeId = new Map(createdNodes.map((n) => [n.client_id, n.id]));

      // Create edges
      for (const edge of edges) {
        const sourceNodeId = clientIdToNodeId.get(edge.sourceNodeClientId);
        const targetNodeId = clientIdToNodeId.get(edge.targetNodeClientId);

        if (!sourceNodeId || !targetNodeId) {
          throw new Error(`Invalid edge: source or target node not found (${edge.sourceNodeClientId} -> ${edge.targetNodeClientId})`);
        }

        await tx.workflowEdge.create({
          data: {
            workflow_id: workflowId,
            client_id: edge.clientId,
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            source_handle: edge.sourceHandle || null,
            target_handle: edge.targetHandle || null,
            label: edge.label || null,
            data: (edge.data || {}) as Prisma.InputJsonValue,
          },
        });
      }

      // Update workflow with viewport and increment version
      return tx.workflow.update({
        where: { id: workflowId },
        data: {
          version: { increment: 1 },
          ...(viewportX !== undefined && { viewport_x: viewportX }),
          ...(viewportY !== undefined && { viewport_y: viewportY }),
          ...(viewportZoom !== undefined && { viewport_zoom: viewportZoom }),
        },
        include: {
          nodes: { orderBy: { created_at: 'asc' } },
          edges: { orderBy: { created_at: 'asc' } },
          _count: { select: { nodes: true, edges: true, executions: true } },
        },
      });
    });

    // Create a map from node id to client_id for edge formatting
    const nodeClientIdMap = new Map(workflow.nodes.map((n) => [n.id, n.client_id]));

    res.status(200).json({ success: true, data: formatWorkflow(workflow, nodeClientIdMap) });
  } catch (error) {
    console.error('Save workflow state error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
  }
});

// Delete workflow
app.delete('/api/organizations/:orgId/workflows/:workflowId', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const workflowId = getParam(req.params.workflowId);
    const { error } = await checkOrgWriteMembership(tokenPayload.userId, orgId, ['OWNER', 'ADMIN']);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    const existing = await prisma.workflow.findFirst({ where: { id: workflowId, organization_id: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
      return;
    }

    await prisma.workflow.delete({ where: { id: workflowId } });

    res.status(200).json({ success: true, data: { message: 'Workflow deleted successfully' } });
  } catch (error) {
    console.error('Delete workflow error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Publish workflow
app.post('/api/organizations/:orgId/workflows/:workflowId/publish', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const workflowId = getParam(req.params.workflowId);
    const { error } = await checkOrgWriteMembership(tokenPayload.userId, orgId, ['OWNER', 'ADMIN']);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    const existing = await prisma.workflow.findFirst({
      where: { id: workflowId, organization_id: orgId },
      include: { nodes: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
      return;
    }

    // Validate workflow has at least a trigger and an end node
    const hasTrigger = existing.nodes.some((n) => n.type === 'TRIGGER');
    const hasEnd = existing.nodes.some((n) => n.type === 'END');

    if (!hasTrigger || !hasEnd) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Workflow must have at least one Trigger and one End node to publish' },
      });
      return;
    }

    const workflow = await prisma.workflow.update({
      where: { id: workflowId },
      data: { status: 'PUBLISHED', is_active: true },
      include: {
        _count: { select: { nodes: true, edges: true, executions: true } },
      },
    });

    res.status(200).json({ success: true, data: formatWorkflow(workflow) });
  } catch (error) {
    console.error('Publish workflow error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Archive workflow
app.post('/api/organizations/:orgId/workflows/:workflowId/archive', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const workflowId = getParam(req.params.workflowId);
    const { error } = await checkOrgWriteMembership(tokenPayload.userId, orgId, ['OWNER', 'ADMIN']);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    const existing = await prisma.workflow.findFirst({ where: { id: workflowId, organization_id: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
      return;
    }

    const workflow = await prisma.workflow.update({
      where: { id: workflowId },
      data: { status: 'ARCHIVED', is_active: false },
      include: {
        _count: { select: { nodes: true, edges: true, executions: true } },
      },
    });

    res.status(200).json({ success: true, data: formatWorkflow(workflow) });
  } catch (error) {
    console.error('Archive workflow error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Execute workflow (manual trigger with mode: 'trial' | 'run')
app.post('/api/organizations/:orgId/workflows/:workflowId/execute', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const workflowId = getParam(req.params.workflowId);
    const { error } = await checkOrgWriteMembership(tokenPayload.userId, orgId, ['OWNER', 'ADMIN']);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    // Parse execution mode from request body
    const { mode = 'run', initialVariables } = req.body as {
      mode?: 'trial' | 'run';
      initialVariables?: Record<string, unknown>;
    };

    // Validate mode
    if (mode !== 'trial' && mode !== 'run') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Mode must be "trial" or "run"' },
      });
      return;
    }

    // Create execution service and execute workflow
    const executionService = createWorkflowExecutionService(prisma);

    try {
      const result = await executionService.execute(workflowId, orgId, {
        mode: mode as WorkflowExecutionMode,
        triggeredBy: `user:${tokenPayload.userId}`,
        initialVariables,
      });

      res.status(200).json({
        success: true,
        data: {
          id: result.id,
          status: result.status,
          executionLog: result.executionLog,
          error: result.error,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          durationMs: result.durationMs,
          mode,
        },
      });
    } catch (execError) {
      const errorMessage = execError instanceof Error ? execError.message : 'Execution failed';
      res.status(400).json({
        success: false,
        error: { code: 'EXECUTION_ERROR', message: errorMessage },
      });
    }
  } catch (error) {
    console.error('Execute workflow error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Get workflow executions
app.get('/api/organizations/:orgId/workflows/:workflowId/executions', async (req: Request, res: Response) => {
  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const orgId = getParam(req.params.orgId);
    const workflowId = getParam(req.params.workflowId);
    const { error } = await checkOrgReadAccess(tokenPayload.userId, orgId);
    if (error) {
      res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }

    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, organization_id: orgId },
    });

    if (!workflow) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const executions = await prisma.workflowExecution.findMany({
      where: { workflow_id: workflowId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    res.status(200).json({
      success: true,
      data: executions.map((e) => ({
        id: e.id,
        status: e.status,
        triggeredBy: e.triggered_by,
        startedAt: e.started_at?.toISOString(),
        completedAt: e.completed_at?.toISOString(),
        error: e.error,
        executionLog: e.execution_log,
        createdAt: e.created_at.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Get workflow executions error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
});

// Create HTTP server and initialize WebSocket
const httpServer = createServer(app);
const io = initializeWorkflowSocket(httpServer);

// Start server
httpServer.listen(PORT, () => {
  console.log(`Auth server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws/workflow`);
});

export { app, io };
export default app;
