import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CandidateEvaluationSchema, upsertCandidateExposure } from '../../monitoring/candidate-exposure-store.js';
import { getPrismaClient } from '../../monitoring/db-client.js';

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
  inputSchema: CandidateEvaluationSchema.extend({
    organization_id: z.string().uuid().describe('Required for tenant isolation'),
    global_event_id: z.string().uuid(),
    global_event_hash: z.string(),
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
      // Arguments may be model-written: the event must exist and its hash must
      // match, so a made-up or truncated hash cannot create a second row.
      const event = await getPrismaClient().globalEvent.findUnique({
        where: { id: global_event_id },
        select: { event_hash: true },
      });
      if (event?.event_hash !== context.global_event_hash) {
        throw new Error('global_event_id/global_event_hash do not match a Global Event');
      }

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
