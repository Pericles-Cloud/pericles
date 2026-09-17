/**
 * Secrets Backend Interface
 * 
 * Defines the contract for pluggable secrets backends (Vault, Cloak, etc.)
 */

import { 
  SecretsBackend, 
  SecretMetadata, 
  CreateSecretInput, 
  UpdateSecretInput,
  SecretResolutionContext,
  SecretResolutionResult,
  SecretScope,
  SecretType,
  SecretAction,
  SecretError,
  Result,
  ok,
  err,
} from './types.js';

export {
  SecretsBackend,
  SecretMetadata,
  CreateSecretInput,
  UpdateSecretInput,
  SecretResolutionContext,
  SecretResolutionResult,
  SecretScope,
  SecretType,
  SecretAction,
  SecretError,
  Result,
  ok,
  err,
};

/**
 * Backend factory - returns the configured backend based on environment
 */
export function getSecretsBackend(): SecretsBackend {
  const backendType = process.env.SECRETS_BACKEND || 'vault';
  
  switch (backendType.toLowerCase()) {
    case 'vault':
      return getVaultBackend();
    case 'cloak':
      return getCloakBackend();
    default:
      throw new Error(`Unknown secrets backend: ${backendType}`);
  }
}

/**
 * Lazy-load Vault backend to avoid import issues if not configured
 */
let _vaultBackend: SecretsBackend | null = null;

function getVaultBackend(): SecretsBackend {
  if (!_vaultBackend) {
    _vaultBackend = new VaultBackend();
  }
  return _vaultBackend;
}

/**
 * Lazy-load Cloak backend
 */
let _cloakBackend: SecretsBackend | null = null;

function getCloakBackend(): SecretsBackend {
  if (!_cloakBackend) {
    _cloakBackend = new CloakBackend();
  }
  return _cloakBackend;
}

// Import implementations dynamically to avoid circular dependencies
class VaultBackend implements SecretsBackend {
  async get(scopePath: string, name: string): Promise<Result<string, SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./vault');
    return VaultBackendImpl.getInstance().get(scopePath, name);
  }

  async put(scopePath: string, name: string, value: string, secretType: SecretType): Promise<Result<void, SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./vault');
    return VaultBackendImpl.getInstance().put(scopePath, name, value, secretType);
  }

  async delete(scopePath: string, name: string): Promise<Result<void, SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./vault');
    return VaultBackendImpl.getInstance().delete(scopePath, name);
  }

  async list(scopePath: string): Promise<Result<SecretMetadata[], SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./vault');
    return VaultBackendImpl.getInstance().list(scopePath);
  }

  async rotate(scopePath: string, name: string, newValue: string): Promise<Result<void, SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./vault');
    return VaultBackendImpl.getInstance().rotate(scopePath, name, newValue);
  }
}

class CloakBackend implements SecretsBackend {
  async get(scopePath: string, name: string): Promise<Result<string, SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./cloak');
    return CloakBackendImpl.getInstance().get(scopePath, name);
  }

  async put(scopePath: string, name: string, value: string, secretType: SecretType): Promise<Result<void, SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./cloak');
    return CloakBackendImpl.getInstance().put(scopePath, name, value, secretType);
  }

  async delete(scopePath: string, name: string): Promise<Result<void, SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./cloak');
    return CloakBackendImpl.getInstance().delete(scopePath, name);
  }

  async list(scopePath: string): Promise<Result<SecretMetadata[], SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./cloak');
    return CloakBackendImpl.getInstance().list(scopePath);
  }

  async rotate(scopePath: string, name: string, newValue: string): Promise<Result<void, SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./cloak');
    return CloakBackendImpl.getInstance().rotate(scopePath, name, newValue);
  }
}