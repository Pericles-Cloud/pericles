// templates/scorer.template.ts
// Matches the live pattern in backend/src/mastra/scorers/monitoring-scorer.ts.
// Confirm post-preprocess step names against the installed @mastra/core/scores.

import { createScorer } from '@mastra/core/scores';

export const exampleScorer = createScorer({
  name: 'Human Readable Scorer Name',           // shows in dashboards + promotion gate
  description: 'What this scorer evaluates and why.',
  type: 'agent',
  judge: {
    // Pin the model + instructions so scores compare across versions.
    model: 'openai/gpt-4o-mini',
    instructions:
      'You are an expert evaluator of <X>. Judge <criteria>. ' +
      'Return only structured JSON matching the provided schema.',
  },
})
  .preprocess(({ run }) => {
    // Extract the fields to judge from run.output / run.input.
    // return { /* normalized inputs for the judge */ };
  });
  // .generateScore(...) / .analyze(...) per the @mastra/core/scores API.

// Promotion gate (CI): every scorer above its threshold AND no scorer regressing
// >5% vs the previous published version on the SAME versioned reference test set.
