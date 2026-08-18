/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/restrict-plus-operands */
// Note: Mastra's scorer API doesn't provide strict typing for run.output, run.input, and results
// All 'any' usages in this file are necessary for interacting with Mastra's scorer framework

import { z } from 'zod';
import { createScorer } from '@mastra/core/scores';

/**
 * Factuality Scorer for Monitoring Agent
 *
 * Evaluates whether detected events contain verifiable facts or primarily
 * opinion/commentary. Uses the <untrusted_content> boundary marking to
 * safely consume external feed content.
 *
 * High score = Event is primarily factual/verifiable
 * Low score = Event is primarily opinion/commentary
 */
export const factualityScorer = createScorer({
  name: 'Event Factuality',
  description: 'Evaluates whether detected events contain verifiable facts or primarily opinion/commentary',
  type: 'agent',
  judge: {
    model: 'openai/gpt-4o-mini',
    instructions:
      'You are an expert evaluator of supply chain risk event factuality. ' +
      'Determine whether the following event description is primarily factual ' +
      'or primarily opinion/commentary. Consider: ' +
      '1) Whether claims are verifiable against the source_url provided ' +
      '2) Whether the content reports observed events vs. analyzes/interprets them ' +
      '3) Whether the language is descriptive of an incident vs. evaluative/editorial ' +
      '4) Cross-check the event_classification field if present ' +
      'Return only the structured JSON matching the provided schema.',
  },
})
  .preprocess(({ run }) => {
    const output = run.output?.[0];
    const events = (output as any)?.detected_events || [];
    return { events };
  })
  .analyze({
    description: 'Analyze event factuality vs opinion/commentary',
    outputSchema: z.object({
      factuality_score: z.number().min(0).max(1),
      is_opinion: z.boolean(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
      events_evaluated: z.number().int().min(0),
    }),
    createPrompt: ({ results }) => {
      const events = results.preprocessStepResult.events;
      const eventCount = events.length;

      // Build a compact events block for the prompt
      const eventBlocks = events
        .slice(0, 5)
        .map(
          (ev: any, i: number) => `Event ${i + 1}:
  headline: "${ev.headline || ev.title || 'N/A'}"
  source_url: "${ev.source_url || 'N/A'}"
  event_classification: "${ev.event_classification || 'N/A'}"
  description: "${ev.description || 'N/A'}"
  severity: ${ev.severity || 0}
  confidence: ${ev.confidence || 0}
`
        )
        .join('\n');

      return `You are evaluating the factuality of supply chain risk events.

      Detected Events (showing first ${Math.min(eventCount, 5)} of ${eventCount} total):
      """
      ${eventBlocks}
      """

      Tasks:
      1) For each event, determine if it is primarily factual (verifiable facts) or primarily opinion/commentary
      2) Assign a factualityScore: 1.0 = fully factual, 0.0 = fully opinion/commentary
      3) Assign is_opinion: true if the event is primarily opinion/commentary
      4) Provide a brief reason for each evaluation
      5) Calculate overall confidence in your judgments

      Guidelines:
      - Factual events: report observed incidents, cite specific details (names, locations, times), 
        cite sources, use language like "reported that", "witnesses say", "according to"
      - Opinion/Commentary events: analyze/interpreting events, use language like "appears to", "likely", 
        "in my opinion", "experts suggest", evaluate significance or impact
      - If event_classification is "opinion" or "commentary", is_opinion should be true
      - If event_classification is "fact", is_opinion should typically be false (but verify)
      - Consider the source_url: reputable wire services (Reuters, AP) tend toward factual;
        editorial columns, blogs tend toward opinion
      - When in doubt, favor marking as factual if the event describes a specific, time-bound incident
        with location and source attribution

      Return JSON with fields:
      {
        "factuality_score": number, // 0.0-1.0 overall factuality across evaluated events
        "is_opinion": boolean, // true if majority/concerning events are opinion/commentary
        "confidence": number, // 0-1 confidence in these judgments
        "reason": string, // brief explanation of the overall assessment
        "events_evaluated": number // how many events were evaluated
      }
      `;
    },
  })
  .generateScore(({ results }) => {
    const r = (results as any)?.analyzeStepResult || {};
    const total = (r.events_evaluated || 0);
    if (total === 0) return 1; // No events = perfect score (no content to evaluate)

    // Score based on is_opinion prevalence and confidence
    const isOpinion = r.is_opinion || false;
    const factualityScore = isOpinion ? 0.0 : 1.0; // simplified: if opinion, score 0; if not, score 1
    const confidence = r.confidence || 0;

    // Softer scoring: if factualityScore is near 0.5, pull in confidence weight
    const finalScore = Math.max(0, Math.min(1, factualityScore + (confidence - 0.5) * 0.3));

    return finalScore;
  })
  .generateReason(({ results, score }) => {
    const r = (results as any)?.analyzeStepResult || {};
    const total = r.events_evaluated || 0;
    const isOpinion = r.is_opinion || false;
    const reason = r.reason || 'No reason provided';

    return `Factuality scoring: ${total} events evaluated, is_opinion=${isOpinion}, ` +
      `factualityScore=${score.toFixed(2)}, reason: ${reason}`;
  });