import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { upsertCandidateExposure } from '../../monitoring/candidate-exposure-store.js';

/**
 * Candidate Exposure Tool
 *
 * Purpose: Create CandidateExposure records and emit change records
 * for the Validation Agent to process.
 */
export const candidateExposureTool = createTool({
  id: 'candidate-exposure-tool',
  description: `
Create a CandidateExposure record for a Global Event that affects this customer.

Use this AFTER evaluating exposure pathways and determining the exposure strength.
Only create candidates for Direct, Probable, or Strategic exposures.
Possible exposures go to the watch list (not sent to Validation).

Emits a candidate_exposure change record for the Validation Agent.
`,
  inputSchema: z.object({
    organization_id: z.string().uuid(),
    global_event_id: z.string().uuid(),
    global_event_hash: z.string(),

    // Exposure analysis
    exposure_pathways: z.array(z.object({
      pathway: z.enum([
        'geographic_site',
        'geographic_flow',
        'entity',
        'product',
        'regulatory',
        'indirect',
        'strategic',
      ]),
      match_basis: z.string(),
      confidence: z.number().min(0).max(1),
    })),
    exposure_strength: z.enum(['direct', 'probable', 'possible', 'strategic']),
    exposed_assets: z.array(z.object({
      asset_type: z.enum(['facility', 'supplier', 'shipment', 'sku', 'carrier', 'lane', 'customer']),
      asset_id: z.string(),
      asset_name: z.string().optional(),
      distance_or_match_basis: z.string(),
    })),
    match_confidence: z.object({
      entity: z.number().min(0).max(1).optional(),
      location: z.number().min(0).max(1).optional(),
      product: z.number().min(0).max(1).optional(),
    }),
    temporal_relevance: z.object({
      shipment_eta: z.string().datetime().nullable().optional(),
      event_window: z.string().nullable().optional(),
      regulation_effective_date: z.string().datetime().nullable().optional(),
    }).nullable().optional(),
    strategic_context: z.array(z.object({
      doc_ref: z.string(),
      initiative: z.string(),
    })).nullable().optional(),
    rationale: z.string().min(10).describe('2-4 plain sentences explaining why'),
    exposure_priority: z.enum(['critical', 'high', 'medium', 'low']),
    profile_snapshot_ref: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    candidate_exposure_id: z.string().nullable(),
    organization_id: z.string(),
    global_event_id: z.string(),
    validation_status: z.string(),
    change_record_emitted: z.boolean(),
    error: z.string().nullable(),
  }),
  execute: async ({ context }) => {
    const { organization_id, global_event_id } = context;
    if (!organization_id) {
      throw new Error('organization_id required for tenant isolation');
    }

    try {
      const result = await upsertCandidateExposure(context);
      return {
        success: true,
        candidate_exposure_id: result.candidate_exposure_id,
        organization_id,
        global_event_id,
        validation_status: result.validation_status,
        change_record_emitted: result.change_record_emitted,
        error: null,
      };
    } catch (error) {
      return {
        success: false,
        candidate_exposure_id: null,
        organization_id,
        global_event_id,
        validation_status: 'ERROR',
        change_record_emitted: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
