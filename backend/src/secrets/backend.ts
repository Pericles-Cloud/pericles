/**
 * Secrets Backend Interface
 * 
 * Defines the contract for pluggable secrets backends (Vault, Cloak, etc.)
 * Types imported from dedicated backend-types.ts to avoid mastra CLI analyzer issues.
 */

import { 
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

import { 
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
} from './backend-types.js';

// Static imports for backends - resolved at build time
import { VaultBackend as VaultBackendImpl } from './backend/vault.js';
import { CloakBackend as CloakBackendImpl } from './backend/cloak.js';

export {
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
 * Interface for secrets backends
 */
export interface SecretsBackend {
  get(scopePath: string, name: string): Promise<Result<string, SecretError>>;
  put(scopePath: string, name: string, value: string, secretType: SecretType): Promise<Result<void, SecretError>>;
  delete(scopePath: string, name: string): Promise<Result<void, SecretError>>;
  list(scopePath: string): Promise<Result<SecretMetadata[], SecretError>>;
  rotate(scopePath: string, name: string, newValue: string): Promise<Result<void, SecretError>>;
}

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
    _vaultBackend = new VaultBackendWrapper();
  }
  return _vaultBackend;
}

/**
 * Lazy-load Cloak backend
 */
let _cloakBackend: SecretsBackend | null = null;

function getCloakBackend(): SecretsBackend {
  if (!_cloakBackend) {
    _cloakBackend = new CloakBackendWrapper();
  }
  return _cloakBackend;
}

// Wrapper classes that delegate to the actual implementations
class VaultBackendWrapper implements SecretsBackend {
  async get(scopePath: string, name: string): Promise<Result<string, SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./backend/vault.js');
    return VaultBackendImpl.getInstance().get(scopePath, name);
  }

  async put(scopePath: string, name: string, value: string, secretType: SecretType): Promise<Result<void, SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./backend/vault.js');
    return VaultBackendImpl.getInstance().put(scopePath, name, value, secretType);
  }

  async delete(scopePath: string, name: string): Promise<Result<void, SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./backend/vault.js');
    return VaultBackendImpl.getInstance().delete(scopePath, name);
  }

  async list(scopePath: string): Promise<Result<SecretMetadata[], SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./backend/vault.js');
    return VaultBackendImpl.getInstance().list(scopePath);
  }

  async rotate(scopePath: string, name: string, newValue: string): Promise<Result<void, SecretError>> {
    const { VaultBackend: VaultBackendImpl } = await import('./backend/vault.js');
    return VaultBackendImpl.getInstance().rotate(scopePath, name, newValue);
  }
}

class CloakBackendWrapper implements SecretsBackend {
  async get(scopePath: string, name: string): Promise<Result<string, SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./backend/cloak.js');
    return CloakBackendImpl.getInstance().get(scopePath, name);
  }

  async put(scopePath: string, name: string, value: string, secretType: SecretType): Promise<Result<void, SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./backend/cloak.js');
    return CloakBackendImpl.getInstance().put(scopePath, name, value, secretType);
  }

  async delete(scopePath: string, name: string): Promise<Result<void, SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./backend/cloak.js');
    return CloakBackendImpl.getInstance().delete(scopePath, name);
  }

  async list(scopePath: string): Promise<Result<SecretMetadata[], SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./backend/cloak.js');
    return CloakBackendImpl.getInstance().list(scopePath);
  }

  async rotate(scopePath: string, name: string, newValue: string): Promise<Result<void, SecretError>> {
    const { CloakBackend: CloakBackendImpl } = await import('./backend/cloak.js');
    return CloakBackendImpl.getInstance().rotate(scopePath, name, newValue);
  }
}