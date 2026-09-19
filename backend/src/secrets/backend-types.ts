/**
 * Backend-specific type definitions
 * Separate file to avoid mastra CLI analyzer issues with the main types.ts
 */

import type { SecretScope, SecretType, SecretAction } from './types.js';

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