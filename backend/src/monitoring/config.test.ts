/**
 * resolveModel / resolveAiApiKey — per-org AI provider + key resolution.
 *
 * The monitoring cron (run-once.ts) must honor each org's AI settings:
 * provider and model from OrganizationSettings, key from org-scoped Secrets
 * Manager entries with the platform env var as fallback. Without this, an org
 * running OpenRouter-only would still hard-fail on a missing OPENAI_API_KEY,
 * and org-billed keys would never reach the model call.
 *
 * Secrets Manager is exercised implicitly here: without a DATABASE_URL in the
 * test environment the resolver throws, and resolveAiApiKey must fall through
 * to the env fallback instead of failing the org's cycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MonitoringConfig } from './config.js';
import { resolveAiApiKey, resolveModel } from './config.js';

const ORG_ID = '00000000-0000-4000-8000-000000000001';

function configWith(provider: string, modelName: string): MonitoringConfig {
  return {
    organizationId: ORG_ID,
    ai: { provider, modelName, temperature: 0.7, maxTokens: 4096 },
  } as MonitoringConfig;
}

const saved = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };

beforeEach(() => {
  saved.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  saved.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  if (saved.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
  if (saved.OPENROUTER_API_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = saved.OPENROUTER_API_KEY;
});

describe('resolveAiApiKey', () => {
  it('returns null when neither Secrets Manager nor env has the key', async () => {
    expect(await resolveAiApiKey(ORG_ID, 'openai')).toBeNull();
  });

  it('falls back to the provider env var when no org secret exists', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-env';
    expect(await resolveAiApiKey(ORG_ID, 'openai')).toBe('sk-test-env');
  });

  it('maps provider names to their conventional env var', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    expect(await resolveAiApiKey(ORG_ID, 'openrouter')).toBe('sk-or-test');
  });
});

describe('resolveModel', () => {
  it('returns a config object carrying the org key for openai', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-env';
    const model = await resolveModel(configWith('openai', 'gpt-4o-mini'));
    expect(model).toEqual({ id: 'openai/gpt-4o-mini', apiKey: 'sk-test-env' });
  });

  it('prefixes openrouter model ids and attaches the openrouter key', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const model = await resolveModel(configWith('openrouter', 'anthropic/claude-3.5-sonnet'));
    expect(model).toEqual({ id: 'openrouter/anthropic/claude-3.5-sonnet', apiKey: 'sk-or-test' });
  });

  it('throws a secrets-aware error when the org provider has no key anywhere', async () => {
    await expect(resolveModel(configWith('openrouter', 'anthropic/claude-3.5-sonnet')))
      .rejects.toThrow(/add "openrouter_api_key" in Settings > Secrets/i);
  });

  it('does not require an OPENAI key for an openrouter-configured org', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    delete process.env.OPENAI_API_KEY;
    await expect(resolveModel(configWith('openrouter', 'google/gemini-2.0-flash'))).resolves.toBeTruthy();
  });
});
