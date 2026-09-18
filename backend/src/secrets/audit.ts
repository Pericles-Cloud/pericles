/**
 * Secrets Audit Logging
 * 
 * Records every secret operation for compliance and security auditing.
 * Never logs secret values - only metadata about the operation.
 */

import { PrismaClient } from '@prisma/client';
import type { 
  SecretAction, 
  SecretScope, 
  AuditLogEntry,
  SecretError,
  Result,
} from './types.js';

const prisma = new PrismaClient();

export interface AuditLogInput {
  organizationId: string;
  userId: string;
  action: SecretAction;
  secretName: string;
  secretScope: SecretScope;
  secretScopeRef?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success: boolean;
  errorMessage?: string | null;
}

export class SecretsAuditLogger {
  private static instance: SecretsAuditLogger | null = null;

  static getInstance(): SecretsAuditLogger {
    if (!SecretsAuditLogger.instance) {
      SecretsAuditLogger.instance = new SecretsAuditLogger();
    }
    return SecretsAuditLogger.instance;
  }

  /**
   * Log a secret operation
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      await prisma.secretAuditLog.create({
        data: {
          organization_id: input.organizationId,
          user_id: input.userId,
          action: input.action,
          secret_name: input.secretName,
          secret_scope: input.secretScope,
          secret_scope_ref: input.secretScopeRef || null,
          ip_address: input.ipAddress || null,
          user_agent: input.userAgent || null,
          success: input.success,
          error_message: input.errorMessage || null,
        },
      });
    } catch (error) {
      // Never throw on audit logging failure - log to console instead
      console.error('[SecretsAudit] Failed to write audit log:', error);
    }
  }

  /**
   * Log successful secret read
   */
  async logRead(
    organizationId: string,
    userId: string,
    secretName: string,
    secretScope: SecretScope,
    secretScopeRef: string | null,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'READ',
      secretName,
      secretScope,
      secretScopeRef,
      ipAddress,
      userAgent,
      success: true,
    });
  }

  /**
   * Log secret create
   */
  async logCreate(
    organizationId: string,
    userId: string,
    secretName: string,
    secretScope: SecretScope,
    secretScopeRef: string | null,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'CREATE',
      secretName,
      secretScope,
      secretScopeRef,
      ipAddress,
      userAgent,
      success: true,
    });
  }

  /**
   * Log secret update
   */
  async logUpdate(
    organizationId: string,
    userId: string,
    secretName: string,
    secretScope: SecretScope,
    secretScopeRef: string | null,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'UPDATE',
      secretName,
      secretScope,
      secretScopeRef,
      ipAddress,
      userAgent,
      success: true,
    });
  }

  /**
   * Log secret delete
   */
  async logDelete(
    organizationId: string,
    userId: string,
    secretName: string,
    secretScope: SecretScope,
    secretScopeRef: string | null,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'DELETE',
      secretName,
      secretScope,
      secretScopeRef,
      ipAddress,
      userAgent,
      success: true,
    });
  }

  /**
   * Log secret rotation
   */
  async logRotate(
    organizationId: string,
    userId: string,
    secretName: string,
    secretScope: SecretScope,
    secretScopeRef: string | null,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'ROTATE',
      secretName,
      secretScope,
      secretScopeRef,
      ipAddress,
      userAgent,
      success: true,
    });
  }

  /**
   * Log secret reveal (one-time value exposure)
   */
  async logReveal(
    organizationId: string,
    userId: string,
    secretName: string,
    secretScope: SecretScope,
    secretScopeRef: string | null,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'REVEAL',
      secretName,
      secretScope,
      secretScopeRef,
      ipAddress,
      userAgent,
      success: true,
    });
  }

  /**
   * Log failed operation
   */
  async logFailure(
    organizationId: string,
    userId: string,
    action: SecretAction,
    secretName: string,
    secretScope: SecretScope,
    secretScopeRef: string | null,
    ipAddress: string | null,
    userAgent: string | null,
    error: Error
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action,
      secretName,
      secretScope,
      secretScopeRef,
      ipAddress,
      userAgent,
      success: false,
      errorMessage: error.message,
    });
  }

  /**
   * Query audit logs with filters
   */
  async query(filters: {
    organizationId: string;
    userId?: string;
    action?: SecretAction;
    secretName?: string;
    secretScope?: SecretScope;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]> {
    const where: Record<string, unknown> = {
      organization_id: filters.organizationId,
    };

    if (filters.userId) where.user_id = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.secretName) where.secret_name = { contains: filters.secretName };
    if (filters.secretScope) where.secret_scope = filters.secretScope;
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) (where.created_at as Record<string, Date>).gte = filters.startDate;
      if (filters.endDate) (where.created_at as Record<string, Date>).lte = filters.endDate;
    }

    const logs = await prisma.secretAuditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: filters.limit || 100,
      skip: filters.offset || 0,
    });

    return logs.map(log => ({
      id: log.id,
      organizationId: log.organization_id,
      userId: log.user_id,
      action: log.action,
      secretName: log.secret_name,
      secretScope: log.secret_scope,
      secretScopeRef: log.secret_scope_ref,
      ipAddress: log.ip_address,
      userAgent: log.user_agent,
      success: log.success,
      errorMessage: log.error_message,
      createdAt: log.created_at,
    }));
  }

  /**
   * Get audit log summary for an organization
   */
  async getSummary(organizationId: string, since?: Date): Promise<{
    totalOperations: number;
    byAction: Record<SecretAction, number>;
    byScope: Record<SecretScope, number>;
    failures: number;
    uniqueUsers: number;
    uniqueSecrets: number;
  }> {
    const where: Record<string, unknown> = { organization_id: organizationId };
    if (since) where.created_at = { gte: since };

    const logs = await prisma.secretAuditLog.findMany({
      where,
      select: {
        action: true,
        secret_scope: true,
        user_id: true,
        secret_name: true,
        success: true,
      },
    });

    const byAction: Record<SecretAction, number> = {} as Record<SecretAction, number>;
    const byScope: Record<SecretScope, number> = {} as Record<SecretScope, number>;
    let failures = 0;
    const userIds = new Set<string>();
    const secretNames = new Set<string>();

    for (const log of logs) {
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      byScope[log.secret_scope] = (byScope[log.secret_scope] || 0) + 1;
      if (!log.success) failures++;
      userIds.add(log.user_id);
      secretNames.add(log.secret_name);
    }

    return {
      totalOperations: logs.length,
      byAction,
      byScope,
      failures,
      uniqueUsers: userIds.size,
      uniqueSecrets: secretNames.size,
    };
  }
}

/**
 * Convenience function for one-off audit logging
 */
export async function auditSecretOperation(input: AuditLogInput): Promise<void> {
  const logger = SecretsAuditLogger.getInstance();
  await logger.log(input);
}