/**
 * PostgreSQL + Cloak Backend (Fallback)
 * 
 * Fallback secrets backend using PostgreSQL with envelope encryption via Cloak.
 * Each organization has its own Data Encryption Key (DEK) encrypted by a
 * Key Encryption Key (KEK) from environment.
 */

import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { 
  SecretsBackend, 
  SecretMetadata, 
  SecretScope as SecretScopeType,
  SecretType as SecretTypeType,
  Result,
} from '../types.js';
import { SecretScope, SecretType, SecretError, ok, err } from '../types.js';

const prisma = new PrismaClient();

export class CloakBackend implements SecretsBackend {
  private kek: Buffer | null = null;
  private dekCache = new Map<string, Buffer>();

  private static instance: CloakBackend | null = null;

  static getInstance(): CloakBackend {
    if (!CloakBackend.instance) {
      CloakBackend.instance = new CloakBackend();
    }
    return CloakBackend.instance;
  }

  private getKEK(): Buffer {
    if (this.kek) return this.kek;

    const kekEnv = process.env.SECRETS_KEK;
    if (!kekEnv) {
      throw new Error('SECRETS_KEK environment variable is required for Cloak backend');
    }

    // KEK can be base64 encoded or hex
    let kek: Buffer;
    try {
      if (kekEnv.length === 64 && /^[0-9a-f]+$/i.test(kekEnv)) {
        kek = Buffer.from(kekEnv, 'hex');
      } else {
        kek = Buffer.from(kekEnv, 'base64');
      }
    } catch {
      throw new Error('SECRETS_KEK must be valid base64 or hex encoded 32-byte key');
    }

    if (kek.length !== 32) {
      throw new Error('SECRETS_KEK must decode to exactly 32 bytes (256 bits)');
    }

    this.kek = kek;
    return this.kek;
  }

  /**
   * Get or create DEK for an organization
   * DEK is encrypted with KEK and stored in the database
   */
  private async getDEK(organizationId: string): Promise<Buffer> {
    if (this.dekCache.has(organizationId)) {
      return this.dekCache.get(organizationId)!;
    }

    const kek = this.getKEK();

    // Try to get existing DEK from database
    const orgSecret = await prisma.organizationSecret.findFirst({
      where: {
        organization_id: organizationId,
        name: '_dek',
        scope: 'ORGANIZATION',
      },
    });

    let dek: Buffer;

    if (orgSecret && orgSecret.value_encrypted) {
      // Decrypt existing DEK
      try {
        dek = this.decrypt(kek, Buffer.from(orgSecret.value_encrypted));
      } catch {
        // KEK has changed — generate a new DEK. Existing secrets encrypted
        // with the old DEK will be unrecoverable, but new secrets will work.
        console.warn('[CloakBackend] DEK decryption failed — SECRETS_KEK may have changed. Generating new DEK.');
        dek = randomBytes(32);
        const encryptedDek = new Uint8Array(this.encrypt(kek, dek));
        await prisma.organizationSecret.update({
          where: {
            organization_id_name_scope_scope_ref: {
              organization_id: organizationId,
              name: '_dek',
              scope: 'ORGANIZATION',
              scope_ref: '',
            },
          },
          data: { value_encrypted: encryptedDek },
        });
        // Invalidate cache so the new DEK is used
        this.dekCache.delete(organizationId);
      }
    } else {
      // Generate new DEK
      dek = randomBytes(32);
      const encryptedDek = new Uint8Array(this.encrypt(kek, dek));

      // Store encrypted DEK
      await prisma.organizationSecret.upsert({
        where: {
          organization_id_name_scope_scope_ref: {
            organization_id: organizationId,
            name: '_dek',
            scope: 'ORGANIZATION',
            scope_ref: '',
          },
        },
        create: {
          organization_id: organizationId,
          name: '_dek',
          scope: 'ORGANIZATION',
          scope_ref: '',
          secret_type: 'SECRET',
          value_encrypted: encryptedDek,
          version: 1,
          description: 'Organization Data Encryption Key (DEK)',
          is_required: true,
          created_by: 'system',
        },
        update: {
          value_encrypted: encryptedDek,
        },
      });
    }

    this.dekCache.set(organizationId, dek);
    return dek;
  }

  private encrypt(key: Buffer, plaintext: Buffer): Buffer {
    const iv = randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Format: iv (12) + ciphertext + authTag (16)
    return Buffer.concat([iv, ciphertext, authTag]);
  }

  private decrypt(key: Buffer, encrypted: Buffer): Buffer {
    if (encrypted.length < 28) { // 12 + 16 minimum
      throw new Error('Invalid encrypted data length');
    }
    const iv = encrypted.subarray(0, 12);
    const authTag = encrypted.subarray(-16);
    const ciphertext = encrypted.subarray(12, -16);
    
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private buildScopePath(scope: SecretScope, scopeRef: string | null, name: string): string {
    switch (scope) {
      case SecretScope.ORGANIZATION:
        return `org/${name}`;
      case SecretScope.INTEGRATION:
        return scopeRef ? `integration/${scopeRef}/${name}` : `integration/${name}`;
      case SecretScope.TOOL:
        return scopeRef ? `tool/${scopeRef}/${name}` : `tool/${name}`;
      default:
        throw new Error(`Unknown scope: ${scope}`);
    }
  }

  async get(scopePath: string, name: string): Promise<Result<string, SecretError>> {
    try {
      // Parse scopePath to get organizationId
      // Expected format: org/{orgId}/...
      const parts = scopePath.split('/');
      if (parts.length < 2 || parts[0] !== 'org') {
        return err(new SecretError('INVALID_SCOPE', `Invalid scope path: ${scopePath}`));
      }
      const organizationId = parts[1];

      const dek = await this.getDEK(organizationId);
      
      const secret = await prisma.organizationSecret.findUnique({
        where: {
          organization_id_name_scope_scope_ref: {
            organization_id: organizationId,
            name,
            scope: parts[2]?.toUpperCase() as SecretScope || SecretScope.ORGANIZATION,
            scope_ref: parts[3] || '',
          },
        },
      });

      if (!secret || !secret.value_encrypted) {
        return err(new SecretError('NOT_FOUND', `Secret not found: ${scopePath}/${name}`));
      }

      const decrypted = this.decrypt(dek, Buffer.from(secret.value_encrypted));
      return ok(decrypted.toString('utf-8'));
    } catch (error) {
      if (error instanceof SecretError) return err(error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('unable to authenticate data') || msg.includes('Unsupported state')) {
        // Auto-delete corrupted secret so it doesn't block future operations
        try {
          const parts = scopePath.split('/');
          const organizationId = parts[1];
          await prisma.organizationSecret.deleteMany({
            where: { organization_id: organizationId, name },
          });
          console.warn(`[CloakBackend] Deleted corrupted secret ${name} for org ${organizationId}`);
        } catch { /* best effort cleanup */ }
        return err(new SecretError('DECRYPTION_FAILED', 'Secret was encrypted with a different key. It has been removed — re-create it in Settings > Secrets.'));
      }
      return err(new SecretError('DECRYPTION_FAILED', `Decryption failed: ${msg}`));
    }
  }

  async put(scopePath: string, name: string, value: string, secretType: SecretType): Promise<Result<void, SecretError>> {
    try {
      const parts = scopePath.split('/');
      if (parts.length < 2 || parts[0] !== 'org') {
        return err(new SecretError('INVALID_SCOPE', `Invalid scope path: ${scopePath}`));
      }
      const organizationId = parts[1];
      const scope = (parts[2]?.toUpperCase() as SecretScope) || SecretScope.ORGANIZATION;
      const scopeRef = parts[3] || '';

      const dek = await this.getDEK(organizationId);
      const encrypted = this.encrypt(dek, Buffer.from(value, 'utf-8'));
      const encryptedBytes = new Uint8Array(encrypted);

      await prisma.organizationSecret.upsert({
        where: {
          organization_id_name_scope_scope_ref: {
            organization_id: organizationId,
            name,
            scope,
            scope_ref: scopeRef,
          },
        },
        create: {
          organization_id: organizationId,
          name,
          scope,
          scope_ref: scopeRef,
          secret_type: secretType,
          value_encrypted: encryptedBytes,
          version: 1,
          is_required: true,
          created_by: 'system',
        },
        update: {
          value_encrypted: encryptedBytes,
          secret_type: secretType,
          version: { increment: 1 },
        },
      });

      return ok(undefined);
    } catch (error) {
      if (error instanceof SecretError) return err(error);
      return err(new SecretError('ENCRYPTION_FAILED', `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }

  async delete(scopePath: string, name: string): Promise<Result<void, SecretError>> {
    try {
      const parts = scopePath.split('/');
      if (parts.length < 2 || parts[0] !== 'org') {
        return err(new SecretError('INVALID_SCOPE', `Invalid scope path: ${scopePath}`));
      }
      const organizationId = parts[1];
      const scope = (parts[2]?.toUpperCase() as SecretScope) || SecretScope.ORGANIZATION;
      const scopeRef = parts[3] || '';

      await prisma.organizationSecret.deleteMany({
        where: {
          organization_id: organizationId,
          name,
          scope,
          scope_ref: scopeRef,
        },
      });

      return ok(undefined);
    } catch (error) {
      if (error instanceof SecretError) return err(error);
      return err(new SecretError('VAULT_UNAVAILABLE', `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }

  async list(scopePath: string): Promise<Result<SecretMetadata[], SecretError>> {
    try {
      const parts = scopePath.split('/');
      if (parts.length < 2 || parts[0] !== 'org') {
        return err(new SecretError('INVALID_SCOPE', `Invalid scope path: ${scopePath}`));
      }
      const organizationId = parts[1];
      const scope = (parts[2]?.toUpperCase() as SecretScope) || SecretScope.ORGANIZATION;
      const scopeRef = parts[3] || '';

      const where: Record<string, unknown> = {
        organization_id: organizationId,
        scope,
      };
      if (scopeRef) where.scope_ref = scopeRef;

      const secrets = await prisma.organizationSecret.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      const metadata: SecretMetadata[] = secrets.map(s => ({
        id: s.id,
        name: s.name,
        scope: s.scope,
        scopeRef: s.scope_ref || null,
        secretType: s.secret_type,
        version: s.version,
        description: s.description,
        isRequired: s.is_required,
        tags: s.tags,
        rotatedAt: s.rotated_at,
        expiresAt: s.expires_at,
        createdBy: s.created_by,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }));

      return ok(metadata);
    } catch (error) {
      return err(new SecretError('VAULT_UNAVAILABLE', `List failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }

  async rotate(scopePath: string, name: string, newValue: string): Promise<Result<void, SecretError>> {
    // For Cloak, rotation is just an update with version increment
    return this.put(scopePath, name, newValue, SecretType.SECRET);
  }
}