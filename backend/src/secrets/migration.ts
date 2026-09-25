/**
 * Secrets Migration Utilities
 * 
 * Migrates existing secrets from environment variables and DataSourceToolConfig
 * to the new OrganizationSecret system.
 */

import { PrismaClient } from '@prisma/client';
import { SecretsResolver } from './resolver.js';
import { SecretsAuditLogger } from './audit.js';
import type { SecretResolutionContext } from './types.js';
import { SecretScope, SecretType } from './types.js';

const prisma = new PrismaClient();

export interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: string[];
}

export interface EnvVarMapping {
  envVar: string;
  secretRef: string;  // e.g., "org.openrouter_api_key"
  secretType: SecretType;
  description?: string;
  isRequired?: boolean;
}

/**
 * Standard environment variable to secret reference mappings
 */
export const STANDARD_ENV_MAPPINGS: EnvVarMapping[] = [
  // AI Provider keys (org scope)
  { envVar: 'OPENROUTER_API_KEY', secretRef: 'org.openrouter_api_key', secretType: 'SECRET', description: 'OpenRouter API key for AI models' },
  { envVar: 'OPENAI_API_KEY', secretRef: 'org.openai_api_key', secretType: 'SECRET', description: 'OpenAI API key for AI models' },
  { envVar: 'ANTHROPIC_API_KEY', secretRef: 'org.anthropic_api_key', secretType: 'SECRET', description: 'Anthropic API key for AI models' },
  
  // Monitoring feed keys (tool scope)
  { envVar: 'FRED_API_KEY', secretRef: 'tool.fred.api_key', secretType: 'SECRET', description: 'FRED economic data API key' },
  { envVar: 'THENEWSAPI_API_KEY', secretRef: 'tool.thenewsapi.api_key', secretType: 'SECRET', description: 'TheNewsAPI news monitoring key' },
  { envVar: 'TWITTERAPIIO_API_KEY', secretRef: 'tool.twitter.api_key', secretType: 'SECRET', description: 'TwitterAPI.io social monitoring key' },
  { envVar: 'NVD_API_KEY', secretRef: 'tool.nvd.api_key', secretType: 'SECRET', description: 'NVD cybersecurity CVE API key' },
  { envVar: 'OPENWEATHER_API_KEY', secretRef: 'tool.weather.api_key', secretType: 'SECRET', description: 'OpenWeather weather monitoring key' },
  { envVar: 'MARINETRAFFIC_API_KEY', secretRef: 'tool.maritime.api_key', secretType: 'SECRET', description: 'MarineTraffic maritime monitoring key' },
  
  // Integration keys (integration scope)
  { envVar: 'SAP_S4HANA_BASE_URL', secretRef: 'integration.sap.base_url', secretType: 'VARIABLE', description: 'SAP S/4HANA base URL' },
  { envVar: 'SAP_S4HANA_CLIENT_ID', secretRef: 'integration.sap.client_id', secretType: 'SECRET', description: 'SAP S/4HANA OAuth client ID' },
  { envVar: 'SAP_S4HANA_CLIENT_SECRET', secretRef: 'integration.sap.client_secret', secretType: 'SECRET', description: 'SAP S/4HANA OAuth client secret' },
  { envVar: 'SAP_S4HANA_TIMEOUT', secretRef: 'integration.sap.timeout', secretType: 'VARIABLE', description: 'SAP S/4HANA request timeout (ms)' },
  
  { envVar: 'APIFY_TOKEN', secretRef: 'integration.importyeti.apify_token', secretType: 'SECRET', description: 'Apify token for ImportYeti BOL scraping' },
  { envVar: 'APIFY_BOL_ACTOR', secretRef: 'integration.importyeti.actor_id', secretType: 'SECRET', description: 'Apify BOL actor ID' },
  { envVar: 'GOOGLE_MAPS_API_KEY', secretRef: 'org.google_maps_api_key', secretType: 'SECRET', description: 'Google Maps API key for geocoding' },
  
  { envVar: 'TERMINAL49_API_KEY', secretRef: 'integration.terminal49.api_key', secretType: 'SECRET', description: 'Terminal49 container tracking API key' },
  { envVar: 'AISSTREAM_API_KEY', secretRef: 'integration.aisstream.api_key', secretType: 'SECRET', description: 'AISstream vessel tracking API key' },
  
  // MASTRA
  { envVar: 'MASTRA_CLOUD_ACCESS_TOKEN', secretRef: 'org.mastra_cloud_token', secretType: 'SECRET', description: 'Mastra Cloud access token for AI tracing' },
];

/**
 * Migrate environment variables to OrganizationSecret
 */
export async function migrateEnvVars(
  organizationId: string,
  userId: string,
  mappings: EnvVarMapping[] = STANDARD_ENV_MAPPINGS
): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: [] };
  const audit = SecretsAuditLogger.getInstance();

  for (const mapping of mappings) {
    const value = process.env[mapping.envVar];
    
    if (!value) {
      result.skipped++;
      continue;
    }

    try {
      const parsed = mapping.secretRef.split('.');
      if (parsed.length !== 2) {
        result.errors.push(`${mapping.envVar}: Invalid secret ref format`);
        continue;
      }

      const [namespace, name] = parsed;
      const scope = namespace.toUpperCase() as SecretScope;
      
      // Determine scope_ref from context
      let scopeRef = '';
      if (namespace === 'integration') {
        scopeRef = name.split('.')[0]; // e.g., "sap" from "sap.base_url"
      } else if (namespace === 'tool') {
        scopeRef = name.split('.')[0]; // e.g., "fred" from "fred.api_key"
      }

      // Check if already exists
      const existing = await prisma.organizationSecret.findUnique({
        where: {
          organization_id_name_scope_scope_ref: {
            organization_id: organizationId,
            name,
            scope,
            scope_ref: scopeRef,
          },
        },
      });

      if (existing) {
        result.skipped++;
        continue;
      }

      // Create the secret
      await prisma.organizationSecret.create({
        data: {
          organization_id: organizationId,
          name,
          scope,
          scope_ref: scopeRef,
          secret_type: mapping.secretType,
          value_encrypted: Buffer.from(value, 'utf-8'), // Will be re-encrypted by backend on first read
          version: 1,
          description: mapping.description,
          is_required: mapping.isRequired ?? true,
          tags: ['migrated', 'env', mapping.envVar],
          created_by: userId,
        },
      });

      await audit.logCreate(organizationId, userId, name, scope, scopeRef || null, null, 'migration-script');
      result.migrated++;
    } catch (error) {
      result.errors.push(`${mapping.envVar}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return result;
}

/**
 * Migrate DataSourceToolConfig api_key_encrypted to OrganizationSecret
 */
export async function migrateDataSourceToolConfigs(
  organizationId: string,
  userId: string
): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: [] };
  const audit = SecretsAuditLogger.getInstance();

  const configs = await prisma.dataSourceToolConfig.findMany({
    where: {
      organization_id: organizationId,
      OR: [
        { api_key_encrypted: { not: null } },
        { api_key_env_var: { not: null } },
      ],
    },
  });

  for (const config of configs) {
    try {
      let value: string | null = null;
      const secretType = SecretType.SECRET;

      if (config.api_key_encrypted) {
        // Decode base64 (current obfuscation)
        try {
          value = Buffer.from(config.api_key_encrypted, 'base64').toString('utf-8');
        } catch {
          result.errors.push(`${config.tool_id}: Failed to decode base64 api_key_encrypted`);
          continue;
        }
      } else if (config.api_key_env_var) {
        value = process.env[config.api_key_env_var] || null;
        if (!value) {
          result.skipped++;
          continue;
        }
      }

      if (!value) {
        result.skipped++;
        continue;
      }

      // Map data_source + tool_id to secret ref
      const namespace = 'tool';
      const name = `${config.data_source}.${config.tool_id}`;
      const scope = SecretScope.TOOL;
      const scopeRef = config.data_source;

      // Check if already exists
      const existing = await prisma.organizationSecret.findUnique({
        where: {
          organization_id_name_scope_scope_ref: {
            organization_id: organizationId,
            name,
            scope,
            scope_ref: scopeRef,
          },
        },
      });

      if (existing) {
        result.skipped++;
        continue;
      }

      // Create secret
      await prisma.organizationSecret.create({
        data: {
          organization_id: organizationId,
          name,
          scope,
          scope_ref: scopeRef,
          secret_type: secretType,
          value_encrypted: Buffer.from(value, 'utf-8'),
          version: 1,
          description: `Migrated from DataSourceToolConfig: ${config.tool_name} (${config.data_source})`,
          is_required: true,
          tags: ['migrated', 'data-source-tool', config.data_source, config.tool_id],
          created_by: userId,
        },
      });

      // Clear the old fields
      await prisma.dataSourceToolConfig.update({
        where: { id: config.id },
        data: {
          api_key_encrypted: null,
          api_key_env_var: null,
        },
      });

      await audit.logCreate(organizationId, userId, name, scope, scopeRef, null, 'migration-script');
      result.migrated++;
    } catch (error) {
      result.errors.push(`${config.tool_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return result;
}

/**
 * Migrate OrganizationSettings AI keys to OrganizationSecret
 */
export async function migrateOrganizationSettings(
  organizationId: string,
  userId: string
): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: [] };
  const audit = SecretsAuditLogger.getInstance();

  // Check if organization has AI provider configured but no secret stored
  const settings = await prisma.organizationSettings.findUnique({
    where: { organization_id: organizationId },
  });

  if (!settings) {
    result.errors.push('OrganizationSettings not found');
    return result;
  }

  // We can't migrate the actual keys from settings since they're not stored there
  // This is a placeholder for when keys are added to settings
  // For now, we rely on env var migration for AI keys

  return result;
}

/**
 * Full migration for an organization
 */
export async function migrateOrganization(
  organizationId: string,
  userId: string
): Promise<{
  envVars: MigrationResult;
  dataSourceTools: MigrationResult;
  orgSettings: MigrationResult;
}> {
  console.log(`[Migration] Starting migration for organization ${organizationId}`);
  
  const envVars = await migrateEnvVars(organizationId, userId);
  console.log(`[Migration] Env vars: ${envVars.migrated} migrated, ${envVars.skipped} skipped`);
  
  const dataSourceTools = await migrateDataSourceToolConfigs(organizationId, userId);
  console.log(`[Migration] DataSourceToolConfigs: ${dataSourceTools.migrated} migrated, ${dataSourceTools.skipped} skipped`);
  
  const orgSettings = await migrateOrganizationSettings(organizationId, userId);
  console.log(`[Migration] Org settings: ${orgSettings.migrated} migrated, ${orgSettings.skipped} skipped`);

  console.log(`[Migration] Complete for organization ${organizationId}`);
  
  return { envVars, dataSourceTools, orgSettings };
}

/**
 * Run migration for all organizations
 */
export async function migrateAllOrganizations(adminUserId: string): Promise<void> {
  const organizations = await prisma.organization.findMany({
    where: { is_root: false },
    select: { id: true },
  });

  console.log(`[Migration] Found ${organizations.length} organizations to migrate`);

  for (const org of organizations) {
    try {
      await migrateOrganization(org.id, adminUserId);
    } catch (error) {
      console.error(`[Migration] Failed for org ${org.id}:`, error);
    }
  }

  console.log('[Migration] All organizations processed');
}