/**
 * OpenRouter integration — shared types.
 *
 * `OpenRouterRawModel` is the (loosely typed, untrusted) shape returned by
 * OpenRouter's `/models` endpoint. `OpenRouterModel` is the normalized shape
 * the AI Settings UI consumes.
 */

export interface OpenRouterModelPricing {
  /** USD cost per input token, as a decimal string (e.g. "0.0000006"). */
  prompt?: string;
  /** USD cost per output token, as a decimal string. */
  completion?: string;
  request?: string;
  image?: string;
}

/** Raw catalog entry as returned by GET https://openrouter.ai/api/v1/models. */
export interface OpenRouterRawModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: OpenRouterModelPricing;
}

/** Normalized model entry, pre-sorted free-first then cheapest-first. */
export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  /** Blended $ per 1M tokens (prompt + completion), for display and sorting. */
  promptPricePerMillionTokens: number;
  completionPricePerMillionTokens: number;
  isFree: boolean;
}
