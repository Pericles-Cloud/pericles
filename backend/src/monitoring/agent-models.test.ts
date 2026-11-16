/**
 * Per-call model resolution for the Global and Client Monitoring Agents (#76).
 * No platform env key fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({ organization: { findFirst: vi.fn() } }));
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
  resolveClientMonitoringModel,
  resolveGlobalMonitoringModel,
} from './agent-models.js';

const ROOT = '00000000-0000-0000-0000-0000000000aa';

beforeEach(() => {
  fake.organization.findFirst.mockReset().mockResolvedValue({ id: ROOT });
  cfg.loadMonitoringConfig.mockReset().mockResolvedValue({ ai: { provider: 'openai', modelName: 'gpt-4o-mini' } });
  cfg.resolveAiApiKey.mockReset();
  cfg.resolveModel.mockReset();
});

describe('resolveGlobalMonitoringModel', () => {
  it("uses the root organization's own secret", async () => {
    cfg.resolveAiApiKey.mockResolvedValue('root-key');
    expect(await resolveGlobalMonitoringModel()).toEqual({ id: 'openai/gpt-4o-mini', apiKey: 'root-key' });
    expect(fake.organization.findFirst.mock.calls[0][0].where).toEqual({ is_root: true });
    expect(cfg.resolveAiApiKey).toHaveBeenCalledWith(ROOT, 'openai');
  });

  it('throws MissingApiKeyError when the root org has no key (no platform fallback)', async () => {
    cfg.resolveAiApiKey.mockResolvedValue(null);
    await expect(resolveGlobalMonitoringModel()).rejects.toBeInstanceOf(MissingApiKeyError);
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

  it('throws when no model was passed, so nothing falls back to a platform key', () => {
    expect(() => modelFromContext('X')({ runtimeContext: modelContext(undefined as never) })).toThrow('no model');
  });
});
