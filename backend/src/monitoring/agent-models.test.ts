/**
 * Per-call model resolution for the Global and Client Monitoring Agents (#76).
 * No platform env key fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({ organization: { findMany: vi.fn() } }));
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

describe('resolveClientMonitoringModel', () => {
  it("resolves the tenant's model through the per-org config", async () => {
    cfg.resolveModel.mockResolvedValue({ id: 'openai/gpt-4o-mini', apiKey: 'org-key' });
    expect(await resolveClientMonitoringModel('org-1')).toEqual({ id: 'openai/gpt-4o-mini', apiKey: 'org-key' });
    expect(cfg.loadMonitoringConfig).toHaveBeenCalledWith('org-1');
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
