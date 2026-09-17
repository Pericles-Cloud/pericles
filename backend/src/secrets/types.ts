/**
 * Secrets Manager Types
 * 
 * Core type definitions for the Pericles secrets management system.
 * Supports two types: SECRET (sensitive credentials) and VARIABLE (non-sensitive config).
 */

import type { Prisma } from '@prisma/client';

// ============================================================================
// Secret Type Enums
// ============================================================================

export const SecretScope = {
  ORGANIZATION: 'ORGANIZATION' as const,
  INTEGRATION: 'INTEGRATION' as const,
  TOOL: 'TOOL' as const,
} as const;

export type SecretScope = typeof SecretScope[keyof typeof SecretScope];

export const SecretType = {
  SECRET: 'SECRET' as const,      // API keys, tokens, client secrets, passwords
  VARIABLE: 'VARIABLE' as const,  // URLs, endpoints, timeouts, config values
} as const;

export type SecretType = typeof SecretType[keyof typeof SecretType];

export const SecretAction = {
  CREATE: 'CREATE' as const,
  READ: 'READ' as const,
  UPDATE: 'UPDATE' as const,
  DELETE: 'DELETE' as const,
  ROTATE: 'ROTATE' as const,
  REVEAL: 'REVEAL' as const,
} as const;

export type SecretAction = typeof SecretAction[keyof typeof SecretAction];

// ============================================================================
// Backend Interface
// ============================================================================

export interface SecretMetadata {
  id: string;
  name: string;
  scope: SecretScope;
  scopeRef: string | null;
  secretType: SecretType;
  version: number;
  description: string | null;
  isRequired: boolean;
  tags: string[];
  rotatedAt: Date | null;
  expiresAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSecretInput {
  organizationId: string;
  name: string;
  scope: SecretScope;
  scopeRef?: string;
  secretType: SecretType;
  value: string;
  description?: string;
  isRequired?: boolean;
  tags?: string[];
  expiresAt?: Date;
  createdBy: string;
}

export interface UpdateSecretInput {
  value?: string;
  description?: string;
  isRequired?: boolean;
  tags?: string[];
  expiresAt?: Date | null;
}

export interface SecretResolutionContext {
  organizationId: string;
  integrationId?: string;
  toolId?: string;
  skillId?: string;
  required: boolean;
  defaultValue?: string;
}

export interface SecretResolutionResult {
  value: string;
  source: {
    scope: SecretScope;
    scopeRef: string | null;
    name: string;
  };
  metadata: SecretMetadata;
}

export type SecretErrorCode = 
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID_SCOPE'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'VAULT_UNAVAILABLE'
  | 'VAULT_AUTH_FAILED'
  | 'VALIDATION_ERROR';

export class SecretError extends Error {
  constructor(
    public readonly code: SecretErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SecretError';
  }
}

export interface SecretsBackend {
  get(scopePath: string, name: string): Promise<Result<string, SecretError>>;
  put(scopePath: string, name: string, value: string, secretType: SecretType): Promise<Result<void, SecretError>>;
  delete(scopePath: string, name: string): Promise<Result<void, SecretError>>;
  list(scopePath: string): Promise<Result<SecretMetadata[], SecretError>>;
  rotate(scopePath: string, name: string, newValue: string): Promise<Result<void, SecretError>>;
}

export interface Result<T, E> {
  ok: boolean;
  value?: T;
  error?: E;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ============================================================================
// Audit Log Types
// ============================================================================

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  userId: string;
  action: SecretAction;
  secretName: string;
  secretScope: SecretScope;
  secretScopeRef: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: Date;
}

// ============================================================================
// Prisma Type Helpers
// ============================================================================

export type OrganizationSecretRecord = Prisma.OrganizationSecretGetPayload<{}>;
export type SecretAuditLogRecord = Prisma.SecretAuditLogGetPayload<{}>;

// ============================================================================
// Validation Helpers
// ============================================================================

export function parseSecretRef(ref: string): { namespace: string; name: string } | null {
  const firstDot = ref.indexOf('.');
  if (firstDot <= 0 || firstDot === ref.length - 1) {
    return null;
  }
  return {
    namespace: ref.substring(0, firstDot),
    name: ref.substring(firstDot + 1),
  };
}

export function buildScopePath(namespace: string, name: string, scopeRef?: string): string {
  switch (namespace) {
    case 'org':
      return `org/${name}`;
    case 'integration':
      return scopeRef ? `integration/${scopeRef}/${name}` : `integration/${name}`;
    case 'tool':
      return scopeRef ? `tool/${scopeRef}/${name}` : `tool/${name}`;
    default:
      return `${namespace}/${name}`;
  }
}

export function validateSecretName(name: string): string | null {
  if (!name || name.length > 256) {
    return 'Secret name must be 1-256 characters';
  }
  // Allow alphanumeric, underscore, hyphen, dot
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    return 'Secret name can only contain alphanumeric characters, underscore, hyphen, and dot';
  }
  return null;
}

export function validateSecretRef(ref: string): string | null {
  const parsed = parseSecretRef(ref);
  if (!parsed) {
    return 'Secret reference must be in format "namespace.name" (e.g., "org.openrouter_api_key")';
  }
  const validNamespaces = ['org', 'integration', 'tool'];
  if (!validNamespaces.includes(parsed.namespace)) {
    return `Invalid namespace "${parsed.namespace}". Must be one of: ${validNamespaces.join(', ')}`;
  }
  const nameError = validateSecretName(parsed.name);
  if (nameError) return nameError;
  return null;
}