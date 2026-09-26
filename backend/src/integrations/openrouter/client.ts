/**
 * OpenRouter integration — model catalog.
 *
 * Fetches OpenRouter's public model list and normalizes pricing so the AI
 * Settings "OpenRouter" provider (pericles-admin-portal-ui) can offer free
 * models first, then the rest cheapest-first. Requires the org-scoped
 * `org.openrouter_api_key` — pericles-external-feeds treats every external
 * call as authenticated and timed-out, never anonymous, even for a read-only
 * catalog fetch, and there is no platform/env key fallback.
 */

import type { OpenRouterModel, OpenRouterRawModel } from './types.js';
import { getOrgSecret } from '../../secrets/index.js';

const UA = 'Pericles-SupplyChainMonitor/1.0 (contact@pericles.cloud)';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Thrown when the org has no OpenRouter key — distinct from an upstream/API failure. */
export class OpenRouterConfigError extends Error {
  constructor(message = 'OpenRouter API key not configured for this organization') {
    super(message);
    this.name = 'OpenRouterConfigError';
  }
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

async function getApiKey(organizationId: string): Promise<string> {
  // Org-scoped key only — no env fallback, consistent with monitoring and
  // Event Q&A: a catalog fetch (or anything else) must not run on the
  // platform key an org never brought itself.
  try {
    const key = await getOrgSecret(organizationId, 'openrouter_api_key', false);
    if (key) return key;
  } catch {
    // Secrets backend unavailable — reported as unconfigured below
  }

  throw new OpenRouterConfigError(
    'No OpenRouter API key configured for this organization (add org.openrouter_api_key in Settings > Secrets)'
  );
}

/**
 * Fetch OpenRouter's model catalog, sorted free models first, then by
 * ascending blended price (prompt + completion, per million tokens).
 *
 * @throws {OpenRouterConfigError} when the org has no openrouter_api_key.
 * @throws {Error} when the OpenRouter API call fails.
 */
export async function fetchOpenRouterModels(organizationId: string): Promise<OpenRouterModel[]> {
  const apiKey = await getApiKey(organizationId);

  const response = await fetch(MODELS_URL, {
    headers: {
      'User-Agent': UA,
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter models request failed (${response.status})`);
  }

  // Treat the response as untrusted: validate shape defensively rather than
  // trusting OpenRouter's documented schema.
  const body = (await response.json()) as { data?: unknown };
  const rawModels = Array.isArray(body.data) ? (body.data as OpenRouterRawModel[]) : [];

  const models: OpenRouterModel[] = rawModels
    .filter((m): m is OpenRouterRawModel => typeof m?.id === 'string')
    .map((m) => {
      const promptPrice = num(m.pricing?.prompt) * 1_000_000;
      const completionPrice = num(m.pricing?.completion) * 1_000_000;
      // A model can be free per-token but still bill per-request or per-image
      // (e.g. some vision/moderation models) — only call it "Free" when none
      // of the pricing dimensions carry a cost.
      const requestPrice = num(m.pricing?.request);
      const imagePrice = num(m.pricing?.image);
      return {
        id: m.id,
        name: typeof m.name === 'string' && m.name.trim() ? m.name : m.id,
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
        promptPricePerMillionTokens: promptPrice,
        completionPricePerMillionTokens: completionPrice,
        isFree: promptPrice === 0 && completionPrice === 0 && requestPrice === 0 && imagePrice === 0,
      };
    });

  // Free models first, then cheapest-first by blended per-token price.
  models.sort((a, b) => {
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
    const priceA = a.promptPricePerMillionTokens + a.completionPricePerMillionTokens;
    const priceB = b.promptPricePerMillionTokens + b.completionPricePerMillionTokens;
    return priceA - priceB;
  });

  return models;
}
