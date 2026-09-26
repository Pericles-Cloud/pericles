/**
 * updateScorerJudgeModels — per-cycle scorer judge model swap.
 *
 * The judges used to hardcode `openai/gpt-4o-mini` (platform OPENAI_API_KEY),
 * so every tenant cycle's scoring billed the Pericles account. The monitoring
 * cycle now calls this helper next to `agent.__updateModel` so judges run on
 * the org's own model + key. These tests lock that contract: all four scorers
 * must expose a judge, and the swap must reach each of them (including the
 * factuality scorer defined in its own module).
 */
import { describe, it, expect } from 'vitest';
import { monitoringScorers, updateScorerJudgeModels } from './monitoring-scorer.js';

const ORG_MODEL = {
  id: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
  apiKey: 'sk-or-org-key',
} as const;

describe('updateScorerJudgeModels', () => {
  it('points all four scorer judges at the org model + key', () => {
    updateScorerJudgeModels({ ...ORG_MODEL });

    for (const [name, scorer] of Object.entries(monitoringScorers)) {
      expect(scorer.config.judge, `${name} must declare a judge`).toBeDefined();
      expect(scorer.config.judge?.model).toEqual({
        id: ORG_MODEL.id,
        apiKey: ORG_MODEL.apiKey,
      });
    }
  });

  it('leaves judge instructions untouched (model swap only)', () => {
    const before = monitoringScorers.relevanceScorer.config.judge?.instructions;
    updateScorerJudgeModels({ ...ORG_MODEL });
    expect(monitoringScorers.relevanceScorer.config.judge?.instructions).toBe(before);
    expect(before).toBeTruthy();
  });

  it('normalizes a bare model id string to the OpenAI-compatible config shape', () => {
    updateScorerJudgeModels('openai/gpt-4o-mini' as const);
    expect(monitoringScorers.factualityScorer.config.judge?.model).toEqual({
      id: 'openai/gpt-4o-mini',
    });
  });

  it('is visible to Mastra at run time (judge getter reads config)', () => {
    updateScorerJudgeModels({ ...ORG_MODEL });
    // Mastra resolves the judge via `this.config.judge` on each run — the
    // getter must reflect the swap, not a construction-time snapshot.
    expect(monitoringScorers.severityAccuracyScorer.judge?.model).toEqual({
      id: ORG_MODEL.id,
      apiKey: ORG_MODEL.apiKey,
    });
  });
});
