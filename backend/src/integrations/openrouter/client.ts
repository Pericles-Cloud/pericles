/**
 * OpenRouter integration — model catalog.
 *
 * Fetches OpenRouter's public model list and normalizes pricing so the AI
 * Settings "OpenRouter" provider (pericles-admin-portal-ui) can offer free
 * models first, then the rest cheapest-first. Requires `OPENROUTER_API_KEY`
 * — pericles-external-feeds treats every external call as authenticated and
 * timed-out, never anonymous, even for a read-only catalog fetch.
 */

import type { OpenRouterModel, OpenRouterRawModel } from './types.js';

const UA = 'Pericles-SupplyChainMonitor/1.0 (contact@pericles.cloud)';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Thrown when OPENROUTER_API_KEY is missing — distinct from an upstream/API failure. */
export class OpenRouterConfigError extends Error {
  constructor(message = 'OPENROUTER_API_KEY not configured') {
    super(message);
    this.name = 'OpenRouterConfigError';
  }
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function requireApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterConfigError();
  return key;
}

/**
 * Fetch OpenRouter's model catalog, sorted free models first, then by
 * ascending blended price (prompt + completion, per million tokens).
 *
 * @throws {OpenRouterConfigError} when OPENROUTER_API_KEY is not set.
 * @throws {Error} when the OpenRouter API call fails.
 */
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const apiKey = requireApiKey();

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
