/**
 * Secrets Resolver
 * 
 * Resolves secret references using a three-tier waterfall:
 * 1. Tool scope (most specific)
 * 2. Integration scope
 * 3. Organization scope (least specific)
 * 
 * Supports both Secrets (sensitive) and Variables (non-sensitive).
 */

import type { 
  SecretsBackend, 
  SecretMetadata, 
  SecretResolutionContext,
  SecretResolutionResult,
} from './types.js';
import { SecretScope, SecretType, SecretError } from './types.js';
import { getSecretsBackend } from './backend.js';
import { parseSecretRef, validateSecretRef } from './types.js';

export class SecretsResolver {
  private backend: SecretsBackend;

  constructor(backend?: SecretsBackend) {
    this.backend = backend || getSecretsBackend();
  }

  /**
   * Resolve a secret reference through the three-tier waterfall
   * 
   * @param ref - Secret reference in format "namespace.name" (e.g., "org.openrouter_api_key")
   * @param context - Resolution context with organization, integration, tool IDs
   * @returns Resolved secret value with metadata
   */
  async resolve(ref: string, context: SecretResolutionContext): Promise<SecretResolutionResult> {
    // Validate reference format
    const validationError = validateSecretRef(ref);
    if (validationError) {
      throw new SecretError('VALIDATION_ERROR', validationError);
    }

    const parsed = parseSecretRef(ref);
    if (!parsed) {
      throw new SecretError('VALIDATION_ERROR', `Invalid secret reference format: ${ref}`);
    }

    const { namespace, name } = parsed;

    // Build scope paths in fallback order (most specific first)
    const scopePaths = this.buildScopePaths(namespace, context);

    // Try each scope in order
    for (const { scope, scopeRef, scopePath } of scopePaths) {
      const result = await this.backend.get(scopePath, name);
      
      if (result.ok) {
        // Fetch metadata for the found secret
        const metadata = await this.getMetadata(scopePath, name, scope, scopeRef);
        
        return {
          value: result.value || '',
          source: { scope, scopeRef, name },
          metadata: metadata || {
            id: '',
            name,
            scope,
            scopeRef,
            secretType: SecretType.SECRET,
            version: 1,
            description: null,
            isRequired: true,
            tags: [],
            rotatedAt: null,
            expiresAt: null,
            createdBy: 'unknown',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        };
      }
    }

    // Not found in any scope
    if (context.required) {
      throw new SecretError('NOT_FOUND', `Secret not found: ${ref} (tried scopes: ${scopePaths.map(p => p.scopePath).join(', ')})`);
    }

    return {
      value: context.defaultValue || '',
      source: { scope: SecretScope.ORGANIZATION, scopeRef: null, name },
      metadata: {
        id: '',
        name,
        scope: SecretScope.ORGANIZATION,
        scopeRef: null,
        secretType: SecretType.SECRET,
        version: 1,
        description: null,
        isRequired: false,
        tags: [],
        rotatedAt: null,
        expiresAt: null,
        createdBy: 'system',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  }

  /**
   * Resolve a secret without throwing on missing (returns default)
   */
  async resolveOrDefault(ref: string, context: SecretResolutionContext): Promise<string> {
    try {
      const result = await this.resolve(ref, context);
      return result.value;
    } catch (error) {
      if (error instanceof SecretError && error.code === 'NOT_FOUND') {
        return context.defaultValue || '';
      }
      throw error;
    }
  }

  /**
   * Resolve multiple secrets at once
   */
  async resolveMany(refs: string[], context: SecretResolutionContext): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    
    for (const ref of refs) {
      try {
        const result = await this.resolve(ref, context);
        results[ref] = result.value;
      } catch (error) {
        if (error instanceof SecretError && error.code === 'NOT_FOUND') {
          results[ref] = context.defaultValue || '';
        } else {
          throw error;
        }
      }
    }
    
    return results;
  }

  /**
   * Build scope paths in fallback order based on context
   * Order: Tool → Integration → Organization
   */
  private buildScopePaths(
    namespace: string,
    context: SecretResolutionContext
  ): Array<{ scope: SecretScope; scopeRef: string | null; scopePath: string }> {
    const paths: Array<{ scope: SecretScope; scopeRef: string | null; scopePath: string }> = [];

    // Both backends parse `org/{orgId}[/{scope}[/{scopeRef}]]` (cloak.ts
    // get/list, vault.ts parseScopePath): the organization id MUST be the
    // second segment. Paths were previously built without it — org scope as
    // `org/<secret-name>`, tool/integration as `tool/…`/`integration/…` with
    // no `org/` prefix — so the backends either treated the secret's name as
    // an org id or rejected the path outright (INVALID_SCOPE), and every
    // getOrgSecret call resolved to "not found" — silently skipping monitoring
    // cycles and reporting keys as unconfigured.
    const orgBase = `org/${context.organizationId}`;
    // Org-scope reads must use the same `org/{orgId}/{scope}` shape the
    // secrets routes write with (auth-server.ts POST/PUT/rotate secrets):
    // Vault embeds the scopePath verbatim in its KV key, so `org/{orgId}`
    // would read a different key than the writer created. Cloak collapses
    // both shapes to the same (ORGANIZATION, '') tuple.
    const orgScopePath = `${orgBase}/organization`;

    switch (namespace) {
      case 'tool':
        // Tool scope: try tool-specific first
        if (context.toolId) {
          paths.push({
            scope: SecretScope.TOOL,
            scopeRef: context.toolId,
            scopePath: `${orgBase}/tool/${context.toolId}`,
          });
        }
        // Fallback to integration scope if tool has integration parent
        if (context.integrationId) {
          paths.push({
            scope: SecretScope.INTEGRATION,
            scopeRef: context.integrationId,
            scopePath: `${orgBase}/integration/${context.integrationId}`,
          });
        }
        // Fallback to org scope
        paths.push({
          scope: SecretScope.ORGANIZATION,
          scopeRef: null,
          scopePath: orgScopePath,
        });
        break;

      case 'integration':
        // Integration scope: try integration-specific first
        if (context.integrationId) {
          paths.push({
            scope: SecretScope.INTEGRATION,
            scopeRef: context.integrationId,
            scopePath: `${orgBase}/integration/${context.integrationId}`,
          });
        }
        // Fallback to org scope
        paths.push({
          scope: SecretScope.ORGANIZATION,
          scopeRef: null,
          scopePath: orgScopePath,
        });
        break;

      case 'org':
        // Org scope only
        paths.push({
          scope: SecretScope.ORGANIZATION,
          scopeRef: null,
          scopePath: orgScopePath,
        });
        break;

      default:
        // Unknown namespace - try as org scope (backward compat)
        paths.push({
          scope: SecretScope.ORGANIZATION,
          scopeRef: null,
          scopePath: orgScopePath,
        });
    }

    return paths;
  }

  /**
   * Get metadata for a secret from the backend
   */
  private async getMetadata(
    scopePath: string,
    name: string,
    scope: SecretScope,
    scopeRef: string | null
  ): Promise<SecretMetadata | null> {
    try {
      const result = await this.backend.list(scopePath);
      if (!result.ok || !result.value) return null;

      const secret = result.value.find(s => s.name === name);
      if (!secret) return null;

      return {
        ...secret,
        scope,
        scopeRef,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Convenience function for one-off resolutions
 */
export async function resolveSecret(
  ref: string,
  context: SecretResolutionContext,
  backend?: SecretsBackend
): Promise<SecretResolutionResult> {
  const resolver = new SecretsResolver(backend);
  return resolver.resolve(ref, context);
}

/**
 * Batch resolve secrets for an integration
 */
export async function resolveIntegrationSecrets(
  organizationId: string,
  integrationId: string,
  secretNames: string[],
  backend?: SecretsBackend
): Promise<Record<string, string>> {
  const resolver = new SecretsResolver(backend);
  const context: SecretResolutionContext = {
    organizationId,
    integrationId,
    required: false,
  };

  const refs = secretNames.map(name => `integration.${name}`);
  return resolver.resolveMany(refs, context);
}

/**
 * Batch resolve secrets for a tool
 */
export async function resolveToolSecrets(
  organizationId: string,
  toolId: string,
  integrationId: string | undefined,
  secretNames: string[],
  backend?: SecretsBackend
): Promise<Record<string, string>> {
  const resolver = new SecretsResolver(backend);
  const context: SecretResolutionContext = {
    organizationId,
    toolId,
    integrationId,
    required: false,
  };

  const refs = secretNames.map(name => `tool.${name}`);
  return resolver.resolveMany(refs, context);
}