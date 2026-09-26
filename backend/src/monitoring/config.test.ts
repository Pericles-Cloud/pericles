/**
 * resolveModel / resolveAiApiKey — per-org AI provider + key resolution.
 *
 * Keys are ORG-SCOPED ONLY: `org.<provider>_api_key` in Secrets Manager.
 * There is deliberately NO platform/env fallback — a tenant without a key is
 * skipped (MissingApiKeyError), never silently billed to the Pericles env
 * key. Secrets Manager is mocked here; without DATABASE_URL the real
 * resolver throws, which must be treated as "no key" rather than "use env".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MonitoringConfig } from './config.js';
import { resolveAiApiKey, resolveModel, MissingApiKeyError } from './config.js';

const { getOrgSecret } = vi.hoisted(() => ({
  getOrgSecret: vi.fn<(orgId: string, name: string, decrypt?: boolean) => Promise<string | null>>(),
}));

vi.mock('../secrets/index.js', () => ({ getOrgSecret }));

const ORG_ID = '00000000-0000-4000-8000-000000000001';

function configWith(provider: string, modelName: string): MonitoringConfig {
  return {
    organizationId: ORG_ID,
    ai: { provider, modelName, temperature: 0.7, maxTokens: 4096 },
  } as MonitoringConfig;
}

beforeEach(() => {
  getOrgSecret.mockReset();
});

describe('resolveAiApiKey — org-scoped keys only, no env fallback', () => {
  it('returns null when the org has no secret', async () => {
    getOrgSecret.mockResolvedValue(null);
    expect(await resolveAiApiKey(ORG_ID, 'openai')).toBeNull();
  });

  it('returns the org secret when present', async () => {
    getOrgSecret.mockResolvedValue('sk-org-test');
    expect(await resolveAiApiKey(ORG_ID, 'openai')).toBe('sk-org-test');
  });

  it('ignores the provider env var even when it is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-env';
    getOrgSecret.mockResolvedValue(null);
    try {
      expect(await resolveAiApiKey(ORG_ID, 'openai')).toBeNull();
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('treats a secrets-backend failure as no key, not an env fallback', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env';
    getOrgSecret.mockRejectedValue(new Error('db down'));
    try {
      expect(await resolveAiApiKey(ORG_ID, 'openrouter')).toBeNull();
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it('requests the provider-shaped secret name on the given org', async () => {
    getOrgSecret.mockResolvedValue(null);
    await resolveAiApiKey(ORG_ID, 'openrouter');
    expect(getOrgSecret).toHaveBeenCalledWith(ORG_ID, 'openrouter_api_key', false);
  });
});

describe('resolveModel', () => {
  it('returns a config object carrying the org key for openai', async () => {
    getOrgSecret.mockResolvedValue('sk-org-openai');
    const model = await resolveModel(configWith('openai', 'gpt-4o-mini'));
    expect(model).toEqual({ id: 'openai/gpt-4o-mini', apiKey: 'sk-org-openai' });
  });

  it('prefixes openrouter model ids and attaches the org openrouter key', async () => {
    getOrgSecret.mockResolvedValue('sk-or-org');
    const model = await resolveModel(configWith('openrouter', 'anthropic/claude-3.5-sonnet'));
    expect(model).toEqual({ id: 'openrouter/anthropic/claude-3.5-sonnet', apiKey: 'sk-or-org' });
  });

  it('throws MissingApiKeyError when the org has no key', async () => {
    getOrgSecret.mockResolvedValue(null);
    await expect(resolveModel(configWith('openrouter', 'anthropic/claude-3.5-sonnet')))
      .rejects.toThrow(MissingApiKeyError);
  });

  it('MissingApiKeyError names the secret to add and never an env var', async () => {
    getOrgSecret.mockResolvedValue(null);
    const error = await resolveModel(configWith('openai', 'gpt-4o-mini')).then(
      () => new Error('expected a rejection'),
      (e: unknown) => e as Error
    );
    expect(error).toBeInstanceOf(MissingApiKeyError);
    expect(error).toMatchObject({ name: 'MissingApiKeyError' });
    expect(error.message).toMatch(/openai_api_key in Settings > Secrets/);
    expect(error.message).not.toMatch(/environment variable|OPENAI_API_KEY/);
  });

  it('throws MissingApiKeyError even when a platform env key exists', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-env';
    getOrgSecret.mockResolvedValue(null);
    try {
      await expect(resolveModel(configWith('openai', 'gpt-4o-mini')))
        .rejects.toThrow(MissingApiKeyError);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
