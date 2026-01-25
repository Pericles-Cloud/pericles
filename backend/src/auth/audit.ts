import { type Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type AuthEventType =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'REGISTER'
  | 'TOKEN_REFRESH'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_RESET_COMPLETE'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_UNLOCKED'
  | 'GOOGLE_SSO_LOGIN'
  | 'GOOGLE_SSO_LINK';

export type AuthEventStatus = 'SUCCESS' | 'FAILURE';

interface AuditLogParams {
  userId?: string;
  organizationId?: string;
  eventType: AuthEventType;
  eventStatus: AuthEventStatus;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

/**
 * Log an authentication-related security event.
 * Following security best practices:
 * - No PII in logs (use user_id, not email)
 * - Capture IP and User-Agent for security analysis
 * - Store additional context in metadata
 */
export async function logAuthEvent(params: AuditLogParams): Promise<void> {
  try {
    await prisma.authAuditLog.create({
      data: {
        user_id: params.userId,
        organization_id: params.organizationId,
        event_type: params.eventType,
        event_status: params.eventStatus,
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined,
        error_message: params.errorMessage,
      },
    });
  } catch (error) {
    // Log to console but don't throw - audit failures shouldn't break auth flow
    console.error('Failed to log auth event:', error);
  }
}

/**
 * Helper to extract IP address from request headers.
 * Handles X-Forwarded-For for proxied requests.
 */
export function extractIpAddress(headers: Record<string, string | undefined>): string | undefined {
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs; take the first (client)
    return forwarded.split(',')[0].trim();
  }
  return headers['x-real-ip'] ?? undefined;
}

/**
 * Helper to extract User-Agent from request headers.
 */
export function extractUserAgent(headers: Record<string, string | undefined>): string | undefined {
  return headers['user-agent'];
}
