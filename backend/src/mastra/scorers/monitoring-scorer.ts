/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/restrict-plus-operands */
// Note: Mastra's scorer API doesn't provide strict typing for run.output, run.input, and results
// All 'any' usages in this file are necessary for interacting with Mastra's scorer framework

import { z } from 'zod';
import { createScorer } from '@mastra/core/scores';

/**
 * Monitoring Agent Scorers
 *
 * These scorers evaluate the monitoring agent's performance across three dimensions:
 * 1. Relevance - Geographic and risk type relevance to organization
 * 2. Severity Accuracy - Calibration of severity scores (0.0-1.0)
 * 3. Deduplication Effectiveness - How well duplicates are detected
 */

// ============================================================================
// 1. Relevance Scorer
// ============================================================================

/**
 * Evaluates if detected events are relevant to the organization's
 * geographic footprint and monitored risk types.
 *
 * High score = Events are within geographic radius and match risk preferences
 * Low score = Events are irrelevant or too far from organization's locations
 */
export const relevanceScorer = createScorer({
  name: 'Geographic and Risk Type Relevance',
  description: 'Evaluates if detected events are geographically relevant and match organization risk preferences',
  type: 'agent',
  judge: {
    model: 'openai/gpt-4o',
    instructions:
      'You are an expert evaluator of supply chain risk event relevance. ' +
      'Determine whether detected events are relevant to the organization based on: ' +
      '1) Geographic proximity to organization locations (plants, warehouses, suppliers) ' +
      '2) Risk type alignment with organization preferences ' +
      '3) Supply chain impact potential. ' +
      'Return only the structured JSON matching the provided schema.',
  },
})
  .preprocess(({ run }) => {
    // Extract events and organization context from agent output
    const output = run.output?.[0];
    const events = (output as any)?.detected_events || [];
    const orgContext = (run.input as any)?.organization_context || {};
    return { events, orgContext };
  })
  .analyze({
    description: 'Analyze geographic and risk type relevance of detected events',
    outputSchema: z.object({
      relevant_count: z.number().int().min(0),
      irrelevant_count: z.number().int().min(0),
      average_distance_km: z.number().optional(),
      risk_type_matches: z.number().int().min(0),
      confidence: z.number().min(0).max(1),
      explanation: z.string()
    }),
    createPrompt: ({ results }) => `
      You are evaluating the relevance of supply chain risk events detected by a monitoring agent.

      Organization Context:
      """
      ${JSON.stringify(results.preprocessStepResult.orgContext, null, 2)}
      """

      Detected Events:
      """
      ${JSON.stringify(results.preprocessStepResult.events, null, 2)}
      """

      Tasks:
      1) Count how many events are geographically relevant (within organization's radius)
      2) Count how many events match organization's monitored risk types
      3) Calculate average distance of events from organization locations
      4) Determine overall relevance confidence

      Return JSON with fields:
      {
        "relevant_count": number,
        "irrelevant_count": number,
        "average_distance_km": number,
        "risk_type_matches": number,
        "confidence": number, // 0-1
        "explanation": string
      }
    `,
  })
  .generateScore(({ results }) => {
    const r = (results as any)?.analyzeStepResult || {};
    const total = (r.relevant_count || 0) + (r.irrelevant_count || 0);
    if (total === 0) return 1; // No events = perfect score (no false positives)

    // Score = (relevant / total) * confidence
    const relevanceRatio = (r.relevant_count || 0) / total;
    return relevanceRatio * (r.confidence || 1);
  })
  .generateReason(({ results, score }) => {
    const r = (results as any)?.analyzeStepResult || {};
    return `Relevance scoring: ${r.relevant_count || 0} relevant, ${r.irrelevant_count || 0} irrelevant, avg distance ${r.average_distance_km || 'N/A'}km, ${r.risk_type_matches || 0} risk type matches. Score=${score}. ${r.explanation || ''}`;
  });

// ============================================================================
// 2. Severity Accuracy Scorer
// ============================================================================

/**
 * Evaluates if severity scores (0.0-1.0) are well-calibrated.
 *
 * High score = Severity scores accurately reflect event impact
 * Low score = Severity scores are miscalibrated (too high or too low)
 */
export const severityAccuracyScorer = createScorer({
  name: 'Severity Score Calibration',
  description: 'Evaluates if severity scores (0.0-1.0) accurately reflect event impact potential',
  type: 'agent',
  judge: {
    model: 'openai/gpt-4o',
    instructions:
      'You are an expert evaluator of supply chain risk severity scoring. ' +
      'Determine whether severity scores are well-calibrated by comparing: ' +
      '1) Assigned severity (0.0-1.0) vs. event description ' +
      '2) Consistency across similar event types ' +
      '3) Alignment with industry standards (e.g., CVSS for cyber, Richter for earthquakes). ' +
      'Return only the structured JSON matching the provided schema.',
  },
})
  .preprocess(({ run }) => {
    const output = run.output?.[0];
    const events = (output as any)?.detected_events || [];
    return { events };
  })
  .analyze({
    description: 'Analyze severity score calibration accuracy',
    outputSchema: z.object({
      well_calibrated_count: z.number().int().min(0),
      overestimated_count: z.number().int().min(0),
      underestimated_count: z.number().int().min(0),
      average_deviation: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1),
      explanation: z.string()
    }),
    createPrompt: ({ results }) => `
      You are evaluating the calibration of severity scores assigned to supply chain risk events.

      Detected Events with Severity Scores:
      """
      ${JSON.stringify(results.preprocessStepResult.events, null, 2)}
      """

      Tasks:
      1) For each event, determine if the severity score (0.0-1.0) is appropriate
      2) Count well-calibrated, overestimated, and underestimated scores
      3) Calculate average deviation from ideal scores
      4) Provide overall calibration confidence

      Guidelines:
      - Critical events (major disruptions, high casualties): 0.8-1.0
      - High impact events (significant delays, moderate casualties): 0.6-0.8
      - Medium impact events (minor delays, localized issues): 0.4-0.6
      - Low impact events (warnings, small incidents): 0.0-0.4

      Return JSON with fields:
      {
        "well_calibrated_count": number,
        "overestimated_count": number,
        "underestimated_count": number,
        "average_deviation": number, // 0-1
        "confidence": number, // 0-1
        "explanation": string
      }
    `,
  })
  .generateScore(({ results }) => {
    const r = (results as any)?.analyzeStepResult || {};
    const total = (r.well_calibrated_count || 0) + (r.overestimated_count || 0) + (r.underestimated_count || 0);
    if (total === 0) return 1;

    // Score = (well_calibrated / total) - (average_deviation * 0.5)
    const calibrationRatio = (r.well_calibrated_count || 0) / total;
    const deviationPenalty = (r.average_deviation || 0) * 0.5;
    return Math.max(0, Math.min(1, calibrationRatio - deviationPenalty));
  })
  .generateReason(({ results, score }) => {
    const r = (results as any)?.analyzeStepResult || {};
    return `Severity calibration: ${r.well_calibrated_count || 0} well-calibrated, ${r.overestimated_count || 0} overestimated, ${r.underestimated_count || 0} underestimated, avg deviation ${r.average_deviation || 0}. Score=${score}. ${r.explanation || ''}`;
  });

// ============================================================================
// 3. Deduplication Effectiveness Scorer
// ============================================================================

/**
 * Evaluates how effectively the agent detects and filters duplicate events.
 *
 * High score = Duplicates correctly identified and skipped
 * Low score = Duplicates not detected OR unique events incorrectly flagged as duplicates
 */
export const deduplicationScorer = createScorer({
  name: 'Deduplication Effectiveness',
  description: 'Evaluates how well the agent detects and filters duplicate events using content hashing',
  type: 'agent',
  judge: {
    model: 'openai/gpt-4o',
    instructions:
      'You are an expert evaluator of event deduplication systems. ' +
      'Determine whether duplicate events are correctly identified and unique events are not incorrectly flagged. ' +
      'Consider: ' +
      '1) True positives (duplicates correctly detected) ' +
      '2) False positives (unique events incorrectly flagged as duplicates) ' +
      '3) False negatives (duplicates missed). ' +
      'Return only the structured JSON matching the provided schema.',
  },
})
  .preprocess(({ run }) => {
    const output = run.output?.[0];
    const events = (output as any)?.detected_events || [];
    const duplicateChecks = (output as any)?.duplicate_checks || [];
    return { events, duplicateChecks };
  })
  .analyze({
    description: 'Analyze deduplication accuracy',
    outputSchema: z.object({
      true_duplicates_detected: z.number().int().min(0),
      false_positives: z.number().int().min(0),
      false_negatives: z.number().int().min(0),
      precision: z.number().min(0).max(1),
      recall: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1),
      explanation: z.string()
    }),
    createPrompt: ({ results }) => `
      You are evaluating the deduplication effectiveness of a monitoring agent.

      Detected Events:
      """
      ${JSON.stringify(results.preprocessStepResult.events, null, 2)}
      """

      Duplicate Checks:
      """
      ${JSON.stringify(results.preprocessStepResult.duplicateChecks, null, 2)}
      """

      Tasks:
      1) Identify true duplicates that were correctly detected
      2) Identify false positives (unique events flagged as duplicates)
      3) Identify false negatives (duplicates that were missed)
      4) Calculate precision and recall

      Precision = true_duplicates / (true_duplicates + false_positives)
      Recall = true_duplicates / (true_duplicates + false_negatives)

      Return JSON with fields:
      {
        "true_duplicates_detected": number,
        "false_positives": number,
        "false_negatives": number,
        "precision": number, // 0-1
        "recall": number, // 0-1
        "confidence": number, // 0-1
        "explanation": string
      }
    `,
  })
  .generateScore(({ results }) => {
    const r = (results as any)?.analyzeStepResult || {};
    const precision = r.precision || 1;
    const recall = r.recall || 1;

    // F1 Score = 2 * (precision * recall) / (precision + recall)
    if (precision + recall === 0) return 1; // No duplicates detected = perfect
    const f1Score = 2 * (precision * recall) / (precision + recall);
    return f1Score * (r.confidence || 1);
  })
  .generateReason(({ results, score }) => {
    const r = (results as any)?.analyzeStepResult || {};
    return `Deduplication scoring: ${r.true_duplicates_detected || 0} true duplicates, ${r.false_positives || 0} false positives, ${r.false_negatives || 0} false negatives. Precision=${r.precision || 0}, Recall=${r.recall || 0}. Score=${score}. ${r.explanation || ''}`;
  });

// ============================================================================
// Export all scorers
// ============================================================================

export const monitoringScorers = {
  relevanceScorer,
  severityAccuracyScorer,
  deduplicationScorer,
};
