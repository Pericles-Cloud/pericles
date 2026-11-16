/**
 * Per-call model resolution for the Global and Client Monitoring Agents (#76).
 * No platform env key fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  organization: { findMany: vi.fn() },
  organizationSettings: { findUnique: vi.fn() },
  organizationSecret: { findFirst: vi.fn() },
}));
const orgs = vi.hoisted(() => ({ resolveSettingsOwnership: vi.fn(), resolveCredentialsOwner: vi.fn() }));
const secrets = vi.hoisted(() => ({ getOrgSecret: vi.fn() }));
vi.mock('../organizations/settings-resolution.js', () => orgs);
vi.mock('../secrets/index.js', () => secrets);
const cfg = vi.hoisted(() => ({
  loadMonitoringConfig: vi.fn(),
  resolveAiApiKey: vi.fn(),
  resolveModel: vi.fn(),
}));

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));
vi.mock('./config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Config>()),
  loadMonitoringConfig: cfg.loadMonitoringConfig,
  resolveAiApiKey: cfg.resolveAiApiKey,
  resolveModel: cfg.resolveModel,
}));

import type * as Config from './config.js';
import { MissingApiKeyError } from './config.js';
import {
  modelContext,
  modelFromContext,
  UNRESOLVED_MODEL,
  resolveClientMonitoringModel,
  resolveGlobalMonitoringModel,
} from './agent-models.js';

const ROOT = '00000000-0000-0000-0000-0000000000aa';

beforeEach(() => {
  fake.organization.findMany.mockReset().mockResolvedValue([{ id: ROOT }]);
  cfg.loadMonitoringConfig.mockReset().mockResolvedValue({ ai: { provider: 'openai', modelName: 'gpt-4o-mini' } });
  cfg.resolveAiApiKey.mockReset();
  cfg.resolveModel.mockReset();
});

describe('resolveGlobalMonitoringModel', () => {
  it("resolves the root organization's own model + key through resolveModel", async () => {
    cfg.loadMonitoringConfig.mockResolvedValue({ organizationId: ROOT, ai: { provider: 'openai', modelName: 'gpt-4o-mini' } });
    cfg.resolveModel.mockResolvedValue({ id: 'openai/gpt-4o-mini', apiKey: 'root-key' });

    expect(await resolveGlobalMonitoringModel()).toEqual({ id: 'openai/gpt-4o-mini', apiKey: 'root-key' });
    expect(fake.organization.findMany.mock.calls[0][0].where).toEqual({ is_root: true });
    expect(cfg.loadMonitoringConfig).toHaveBeenCalledWith(ROOT);
  });

  it('propagates MissingApiKeyError when the root org has no key (no platform fallback)', async () => {
    cfg.resolveModel.mockRejectedValue(new MissingApiKeyError(ROOT, 'openai'));
    await expect(resolveGlobalMonitoringModel()).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it('refuses to guess when there is not exactly one root organization', async () => {
    fake.organization.findMany.mockResolvedValue([{ id: ROOT }, { id: 'other-root' }]);
    await expect(resolveGlobalMonitoringModel()).rejects.toThrow('exactly one root organization');
    fake.organization.findMany.mockResolvedValue([]);
    await expect(resolveGlobalMonitoringModel()).rejects.toThrow('found 0');
  });
});

describe('resolveClientMonitoringModel (strict)', () => {
  beforeEach(() => {
    orgs.resolveSettingsOwnership.mockReset().mockResolvedValue({ owner: { id: 'settings-owner' } });
    orgs.resolveCredentialsOwner.mockReset().mockResolvedValue({ id: 'keys-owner' });
    fake.organizationSettings.findUnique.mockReset().mockResolvedValue({ ai_model_provider: 'openrouter', ai_model_name: 'anthropic/claude-3.5-sonnet' });
    fake.organizationSecret.findFirst.mockReset().mockResolvedValue({ id: 'sec-1' });
    secrets.getOrgSecret.mockReset().mockResolvedValue('tenant-key');
  });

  it("resolves the tenant's provider/model from its settings owner and the key from its credentials owner", async () => {
    expect(await resolveClientMonitoringModel('org-1')).toEqual({
      id: 'openrouter/anthropic/claude-3.5-sonnet',
      apiKey: 'tenant-key',
    });
    expect(fake.organizationSecret.findFirst.mock.calls[0][0].where).toEqual({
      organization_id: 'keys-owner',
      name: 'openrouter_api_key',
      scope: 'ORGANIZATION',
    });
  });

  it('only a genuinely unconfigured key is a skip (MissingApiKeyError)', async () => {
    fake.organizationSecret.findFirst.mockResolvedValue(null);
    await expect(resolveClientMonitoringModel('org-1')).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it('a configured key that cannot be read throws a retryable error, not MissingApiKeyError', async () => {
    secrets.getOrgSecret.mockResolvedValue('');
    const error = await resolveClientMonitoringModel('org-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MissingApiKeyError);
  });

  it('a lookup failure (DB down) propagates, so the queue retries', async () => {
    fake.organizationSettings.findUnique.mockRejectedValue(new Error('db down'));
    await expect(resolveClientMonitoringModel('org-1')).rejects.toThrow('db down');
  });
});

describe('modelFromContext', () => {
  it('returns the model passed for the call', () => {
    const model = { id: 'openai/gpt-4o-mini' as const, apiKey: 'k' };
    expect(modelFromContext('X')({ runtimeContext: modelContext(model) })).toEqual(model);
  });

  it('returns a non-billable placeholder (explicit invalid key) when no model was passed', () => {
    const model = modelFromContext('X')({ runtimeContext: modelContext(undefined as never) });
    expect(model).toEqual(UNRESOLVED_MODEL);
    // A key is always supplied, so nothing can fall back to the platform env key.
    expect(typeof model === 'object' && model.apiKey.length > 0).toBe(true);
  });
});
