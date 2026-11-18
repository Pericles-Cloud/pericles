/**
 * resolveModel / resolveAiApiKey — per-org AI provider + key resolution.
 *
 * Keys are ORG-SCOPED ONLY: `org.<provider>_api_key` in Secrets Manager.
 * There is deliberately NO platform/env fallback.
 *
 * Two different outcomes (#72):
 * - no OrganizationSecret row: MissingApiKeyError, a policy skip;
 * - a row that can't be read (KEK, decryption, backend down) or a failing
 *   DB: a real error, never reported as "no key" (which the UI shows as a
 *   neutral "Skipped" telling the admin to add a key they already have).
 *
 * The secret-row lookup (db-client) and Secrets Manager are mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MonitoringConfig } from './config.js';
import { ApiKeyUnreadableError, resolveAiApiKey, resolveModel, MissingApiKeyError } from './config.js';

const { getOrgSecret, findFirst } = vi.hoisted(() => ({
  getOrgSecret: vi.fn<(orgId: string, name: string, decrypt?: boolean) => Promise<string | null>>(),
  findFirst: vi.fn<(args: { where: { organization_id: string; name: string; scope: string } }) => Promise<{ id: string } | null>>(),
}));

vi.mock('../secrets/index.js', () => ({ getOrgSecret }));
// resolveCredentialsOwner also reads organizations through this client; it is
// absent here, so that lookup fails and resolveModel falls back to the org
// itself (its documented behaviour).
vi.mock('./db-client.js', () => ({ getPrismaClient: () => ({ organizationSecret: { findFirst } }) }));

const ORG_ID = '00000000-0000-4000-8000-000000000001';

function configWith(provider: string, modelName: string): MonitoringConfig {
  return {
    organizationId: ORG_ID,
    ai: { provider, modelName, temperature: 0.7, maxTokens: 4096 },
  } as MonitoringConfig;
}

const configured = () => findFirst.mockResolvedValue({ id: 'secret-row' });
const notConfigured = () => findFirst.mockResolvedValue(null);
const rejection = (p: Promise<unknown>) => p.then(() => new Error('expected a rejection'), (e: unknown) => e as Error);

beforeEach(() => {
  getOrgSecret.mockReset();
  findFirst.mockReset();
});

describe('resolveAiApiKey — org-scoped keys only, no env fallback', () => {
  it('no secret row -> MissingApiKeyError (a skip), without reading Secrets Manager', async () => {
    notConfigured();
    await expect(resolveAiApiKey(ORG_ID, 'openai')).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(getOrgSecret).not.toHaveBeenCalled();
  });

  it('returns the org secret when it exists and reads', async () => {
    configured();
    getOrgSecret.mockResolvedValue('sk-org-test');
    expect(await resolveAiApiKey(ORG_ID, 'openai')).toBe('sk-org-test');
  });

  it('ignores the provider env var even when it is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-env';
    notConfigured();
    try {
      await expect(resolveAiApiKey(ORG_ID, 'openai')).rejects.toBeInstanceOf(MissingApiKeyError);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('a configured key the secrets backend cannot read -> ApiKeyUnreadableError, NOT "no key"', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env';
    configured();
    try {
      for (const fail of [() => getOrgSecret.mockRejectedValue(new Error('KEK unavailable')), () => getOrgSecret.mockResolvedValue(null)]) {
        fail();
        const e = await rejection(resolveAiApiKey(ORG_ID, 'openrouter'));
        expect(e).toBeInstanceOf(ApiKeyUnreadableError);
        expect(e).not.toBeInstanceOf(MissingApiKeyError);
        expect(e.name).toBe('ApiKeyUnreadableError');
      }
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it('a failing DB lookup propagates as a real error, not "no key"', async () => {
    findFirst.mockRejectedValue(new Error('db down'));
    const e = await rejection(resolveAiApiKey(ORG_ID, 'openai'));
    expect(e.message).toBe('db down');
    expect(e).not.toBeInstanceOf(MissingApiKeyError);
  });

  it('looks up the provider-shaped, org-scoped secret on the given org', async () => {
    configured();
    getOrgSecret.mockResolvedValue('k');
    await resolveAiApiKey(ORG_ID, 'openrouter');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organization_id: ORG_ID, name: 'openrouter_api_key', scope: 'ORGANIZATION' } })
    );
    expect(getOrgSecret).toHaveBeenCalledWith(ORG_ID, 'openrouter_api_key', false);
  });
});

describe('resolveModel', () => {
  it('returns a config object carrying the org key for openai', async () => {
    configured();
    getOrgSecret.mockResolvedValue('sk-org-openai');
    const model = await resolveModel(configWith('openai', 'gpt-4o-mini'));
    expect(model).toEqual({ id: 'openai/gpt-4o-mini', apiKey: 'sk-org-openai' });
  });

  it('prefixes openrouter model ids and attaches the org openrouter key', async () => {
    configured();
    getOrgSecret.mockResolvedValue('sk-or-org');
    const model = await resolveModel(configWith('openrouter', 'anthropic/claude-3.5-sonnet'));
    expect(model).toEqual({ id: 'openrouter/anthropic/claude-3.5-sonnet', apiKey: 'sk-or-org' });
  });

  it('throws MissingApiKeyError when the org has no key', async () => {
    notConfigured();
    await expect(resolveModel(configWith('openrouter', 'anthropic/claude-3.5-sonnet'))).rejects.toThrow(MissingApiKeyError);
  });

  it('MissingApiKeyError names the run org, the secret to add, and never an env var', async () => {
    notConfigured();
    const error = await rejection(resolveModel(configWith('openai', 'gpt-4o-mini')));
    expect(error).toBeInstanceOf(MissingApiKeyError);
    expect(error.message).toContain(ORG_ID);
    expect(error.message).toMatch(/openai_api_key in Settings > Secrets/);
    expect(error.message).not.toMatch(/environment variable|OPENAI_API_KEY/);
  });

  it('throws MissingApiKeyError even when a platform env key exists', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-env';
    notConfigured();
    try {
      await expect(resolveModel(configWith('openai', 'gpt-4o-mini'))).rejects.toThrow(MissingApiKeyError);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('an unreadable configured key is a real failure (ApiKeyUnreadableError), not a skip', async () => {
    configured();
    getOrgSecret.mockRejectedValue(new Error('decryption failed'));
    await expect(resolveModel(configWith('openai', 'gpt-4o-mini'))).rejects.toBeInstanceOf(ApiKeyUnreadableError);
  });
});
