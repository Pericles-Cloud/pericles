/**
 * HashiCorp Vault Backend
 * 
 * Primary secrets backend using HashiCorp Vault with per-organization namespaces.
 * Maps Pericles organization-scoped secrets to Vault KV v2 secret engine paths.
 */

import Vault from 'node-vault';
import type {
  SecretsBackend,
  SecretMetadata,
  Result,
} from '../types.js';
import {
  SecretScope,
  SecretType,
  SecretError,
  ok,
  err,
} from '../types.js';

export class VaultBackend implements SecretsBackend {
  private vault: ReturnType<typeof Vault> | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private static instance: VaultBackend | null = null;

  static getInstance(): VaultBackend {
    if (!VaultBackend.instance) {
      VaultBackend.instance = new VaultBackend();
    }
    return VaultBackend.instance;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- private singleton constructor
  private constructor() {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const vaultAddr = process.env.VAULT_ADDR || 'http://localhost:8200';
    const vaultToken = process.env.VAULT_TOKEN;

    if (!vaultToken) {
      throw new Error('VAULT_TOKEN environment variable is required for Vault backend');
    }

    this.vault = Vault({
      apiVersion: 'v2',
      endpoint: vaultAddr,
      token: vaultToken,
    });

    // Test connection
    try {
      await this.vault.read('sys/health');
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to connect to Vault at ${vaultAddr}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private getOrgNamespace(organizationId: string): string {
    // Root org gets dedicated namespace, child orgs get their own
    return `pericles/org/${organizationId}`;
  }

  private buildVaultPath(organizationId: string, scopePath: string, name: string): string {
    const orgNamespace = this.getOrgNamespace(organizationId);
    // Vault KV v2 path format: secret/data/<path>
    return `${orgNamespace}/secret/data/${scopePath}/${name}`;
  }

  private parseScopePath(scopePath: string): { organizationId: string; scope: SecretScope; scopeRef: string | null; name: string } {
    // Expected format: org/{orgId}/integration/{integrationId}/name
    // or: org/{orgId}/tool/{toolId}/name
    // or: org/{orgId}/name
    const parts = scopePath.split('/');
    if (parts.length < 2 || parts[0] !== 'org') {
      throw new Error(`Invalid scope path format: ${scopePath}`);
    }

    const organizationId = parts[1];
    let scope: SecretScope = SecretScope.ORGANIZATION;
    let scopeRef: string | null = null;
    let name = '';

    if (parts.length === 2) {
      // org/{orgId}/name - but this shouldn't happen as buildVaultPath adds scope
      name = parts[2] || '';
    } else if (parts.length === 4) {
      // org/{orgId}/integration/{integrationId}/name or org/{orgId}/tool/{toolId}/name
      scope = parts[2] === 'integration' ? SecretScope.INTEGRATION : SecretScope.TOOL;
      scopeRef = parts[3];
      name = parts[4] || '';
    } else if (parts.length === 3) {
      // org/{orgId}/name - org scope
      scope = SecretScope.ORGANIZATION;
      name = parts[2];
    }

    return { organizationId, scope, scopeRef, name };
  }

  async get(scopePath: string, name: string): Promise<Result<string, SecretError>> {
    try {
      await this.ensureInitialized();
      const { organizationId } = this.parseScopePath(scopePath);
      const path = this.buildVaultPath(organizationId, scopePath, name);
      
      const response = await this.vault!.read(path);
      const value = response.data?.data?.value;
      
      if (value === undefined) {
        return err(new SecretError('NOT_FOUND', `Secret not found: ${scopePath}/${name}`));
      }
      
      return ok(value);
    } catch (error) {
      if (error instanceof SecretError) return err(error);
      return err(new SecretError('VAULT_UNAVAILABLE', `Vault read failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }

  async put(scopePath: string, name: string, value: string, secretType: SecretType): Promise<Result<void, SecretError>> {
    try {
      await this.ensureInitialized();
      const { organizationId } = this.parseScopePath(scopePath);
      const path = this.buildVaultPath(organizationId, scopePath, name);
      
      await this.vault!.write(path, {
        data: {
          value,
          secret_type: secretType,
          updated_at: new Date().toISOString(),
        },
      });
      
      return ok(undefined);
    } catch (error) {
      return err(new SecretError('VAULT_UNAVAILABLE', `Vault write failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }

  async delete(scopePath: string, name: string): Promise<Result<void, SecretError>> {
    try {
      await this.ensureInitialized();
      const { organizationId } = this.parseScopePath(scopePath);
      const path = this.buildVaultPath(organizationId, scopePath, name);
      
      // Soft delete in KV v2
      await this.vault!.delete(path);
      
      return ok(undefined);
    } catch (error) {
      return err(new SecretError('VAULT_UNAVAILABLE', `Vault delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }

  async list(scopePath: string): Promise<Result<SecretMetadata[], SecretError>> {
    try {
      await this.ensureInitialized();
      const { organizationId } = this.parseScopePath(scopePath);
      const orgNamespace = this.getOrgNamespace(organizationId);
      const listPath = `${orgNamespace}/secret/metadata/${scopePath}`;
      
      const response = await this.vault!.list(listPath);
      const keys = response.data?.keys || [];
      
      // Fetch metadata for each secret
      const secrets: SecretMetadata[] = [];
      for (const key of keys) {
        if (key.endsWith('/')) continue; // Skip directories
        const metaPath = `${orgNamespace}/secret/metadata/${scopePath}/${key}`;
        try {
          const metaResponse = await this.vault!.read(metaPath);
          const data = metaResponse.data?.data;
          if (data) {
            secrets.push({
              id: '', // Vault doesn't have UUIDs
              name: key,
              scope: this.parseScopePath(scopePath).scope,
              scopeRef: this.parseScopePath(scopePath).scopeRef,
              secretType: (data.secret_type as SecretType) || SecretType.SECRET,
              version: data.custom_metadata?.version || 1,
              description: data.custom_metadata?.description || null,
              isRequired: data.custom_metadata?.is_required !== 'false',
              tags: data.custom_metadata?.tags ? JSON.parse(data.custom_metadata.tags) : [],
              rotatedAt: data.custom_metadata?.rotated_at ? new Date(data.custom_metadata.rotated_at) : null,
              expiresAt: data.custom_metadata?.expires_at ? new Date(data.custom_metadata.expires_at) : null,
              createdBy: data.custom_metadata?.created_by || 'unknown',
              createdAt: new Date(data.created_time),
              updatedAt: new Date(data.updated_time || data.created_time),
            });
          }
        } catch {
          // Skip secrets we can't read metadata for
        }
      }
      
      return ok(secrets);
    } catch (error) {
      return err(new SecretError('VAULT_UNAVAILABLE', `Vault list failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }

  async rotate(scopePath: string, name: string, newValue: string): Promise<Result<void, SecretError>> {
    // In Vault KV v2, rotation is just a new version write
    return this.put(scopePath, name, newValue, SecretType.SECRET);
  }
}