/**
 * Pericles Secrets Manager - Main Entry Point
 * 
 * Unified secrets management for Pericles platform.
 * Provides Vault (primary) and Cloak (fallback) backends,
 * three-tier scope resolution, and audit logging.
 */

export {
  // Types
  SecretScope,
  SecretType,
  SecretAction,
  SecretError,
  SecretMetadata,
  SecretResolutionContext,
  SecretResolutionResult,
  CreateSecretInput,
  UpdateSecretInput,
  AuditLogEntry,
  Result,
  ok,
  err,
  parseSecretRef,
  buildScopePath,
  validateSecretName,
  validateSecretRef,
} from './types.js';

export {
  // Backend
  SecretsBackend,
  getSecretsBackend,
} from './backend.js';

export {
  // Vault backend
  VaultBackend,
} from './backend/vault.js';

export {
  // Cloak backend
  CloakBackend,
} from './backend/cloak.js';

export {
  // Resolver
  SecretsResolver,
  resolveSecret,
  resolveIntegrationSecrets,
  resolveToolSecrets,
} from './resolver.js';

export {
  // Audit
  SecretsAuditLogger,
  auditSecretOperation,
  type AuditLogInput,
} from './audit.js';

export {
  // Migration
  migrateEnvVars,
  migrateDataSourceToolConfigs,
  migrateOrganizationSettings,
  migrateOrganization,
  migrateAllOrganizations,
  type MigrationResult,
  type EnvVarMapping,
  STANDARD_ENV_MAPPINGS,
} from './migration.js';

/**
 * High-level convenience function to resolve a secret for an integration
 */
export async function getIntegrationSecret(
  organizationId: string,
  integrationId: string,
  secretName: string,
  required = true,
  defaultValue?: string
): Promise<string> {
  const { resolveSecret } = await import('./resolver.js');
  const result = await resolveSecret(
    `integration.${secretName}`,
    { organizationId, integrationId, required, defaultValue }
  );
  return result.value;
}

/**
 * High-level convenience function to resolve a secret for a tool
 */
export async function getToolSecret(
  organizationId: string,
  toolId: string,
  secretName: string,
  integrationId?: string,
  required = true,
  defaultValue?: string
): Promise<string> {
  const { resolveSecret } = await import('./resolver.js');
  const result = await resolveSecret(
    `tool.${secretName}`,
    { organizationId, toolId, integrationId, required, defaultValue }
  );
  return result.value;
}

/**
 * High-level convenience function to resolve an org-level secret
 */
export async function getOrgSecret(
  organizationId: string,
  secretName: string,
  required = true,
  defaultValue?: string
): Promise<string> {
  const { resolveSecret } = await import('./resolver.js');
  const result = await resolveSecret(
    `org.${secretName}`,
    { organizationId, required, defaultValue }
  );
  return result.value;
}

/**
 * High-level convenience function to resolve a variable (non-sensitive)
 */
export async function getVariable(
  organizationId: string,
  variableName: string,
  scope: 'org' | 'integration' | 'tool' = 'org',
  scopeRef?: string,
  required = true,
  defaultValue?: string
): Promise<string> {
  const { resolveSecret } = await import('./resolver.js');
  const result = await resolveSecret(
    `${scope}.${variableName}`,
    { 
      organizationId, 
      integrationId: scope === 'integration' ? scopeRef : undefined,
      toolId: scope === 'tool' ? scopeRef : undefined,
      required, 
      defaultValue 
    }
  );
  return result.value;
}

/**
 * Initialize secrets for a monitoring cycle context
 * Loads all required secrets for the organization's enabled tools
 */
export async function initializeMonitoringSecrets(
  organizationId: string,
  enabledTools: string[],
  integrationId?: string
): Promise<Record<string, string>> {
  const { resolveToolSecrets } = await import('./resolver.js');
  
  // Map tool IDs to their required secret names
  const toolSecretMap: Record<string, string[]> = {
    fred: ['api_key'],
    thenewsapi: ['api_key'],
    twitter: ['api_key'],
    nvd: ['api_key'],
    weather: ['api_key'],
    noaa: ['api_key'],
    eonet: [],
    gdelt: [],
    cisa: [],
    rss: [],
  };

  const allSecretNames = enabledTools.flatMap(tool => toolSecretMap[tool] || []);
  
  return resolveToolSecrets(
    organizationId,
    'monitoring-agent',
    integrationId,
    allSecretNames
  );
}