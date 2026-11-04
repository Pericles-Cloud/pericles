import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPrismaClient } from '../../monitoring/db-client.js';
import { enqueueInTransaction, CHANGE_RECORD_QUEUE } from '../../monitoring/queue-client.js';
import { changeRecordKey } from '../../workflow/records/change-record.js';

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
    const prisma = getPrismaClient();

    const {
      organization_id,
      global_event_id,
      global_event_hash,
      exposure_pathways,
      exposure_strength,
      exposed_assets,
      match_confidence,
      temporal_relevance,
      strategic_context,
      rationale,
      exposure_priority,
      profile_snapshot_ref,
    } = context;

    try {
      // Check for existing candidate exposure (deduplication)
      const existing = await prisma.candidateExposure.findUnique({
        where: {
          organization_id_global_event_hash: {
            organization_id,
            global_event_hash,
          },
        },
      });

      if (existing) {
        // Update existing if status allows
        if (existing.validation_status === 'WATCHING' || existing.validation_status === 'REJECTED') {
          const updated = await prisma.candidateExposure.update({
            where: { id: existing.id },
            data: {
              exposure_pathways: exposure_pathways as any,
              exposure_strength,
              exposed_assets: exposed_assets as any,
              match_confidence: match_confidence as any,
              temporal_relevance: temporal_relevance as any,
              strategic_context: strategic_context as any,
              rationale,
              exposure_priority,
              profile_snapshot_ref,
              validation_status: exposure_strength === 'possible' ? 'WATCHING' : 'CANDIDATE',
              updated_at: new Date(),
            },
          });

          return {
            success: true,
            candidate_exposure_id: updated.id,
            organization_id,
            global_event_id,
            validation_status: updated.validation_status,
            change_record_emitted: false, // Updated, not new
            error: null,
          };
        }

        // Already in pipeline
        return {
          success: true,
          candidate_exposure_id: existing.id,
          organization_id,
          global_event_id,
          validation_status: existing.validation_status,
          change_record_emitted: false,
          error: null,
        };
      }

      // Create new candidate exposure
      const validationStatus = exposure_strength === 'possible' ? 'WATCHING' : 'CANDIDATE';

      const candidateExposure = await prisma.candidateExposure.create({
        data: {
          organization_id,
          global_event_id,
          global_event_hash,
          exposure_pathways: exposure_pathways as any,
          exposure_strength,
          exposed_assets: exposed_assets as any,
          match_confidence: match_confidence as any,
          temporal_relevance: temporal_relevance as any,
          strategic_context: strategic_context as any,
          rationale,
          exposure_priority,
          validation_status: validationStatus as any,
          profile_snapshot_ref,
        },
      });

      // Emit change record for Validation Agent (only for CANDIDATE status)
      let changeRecordEmitted = false;
      if (validationStatus === 'CANDIDATE') {
        const record = {
          record_id: candidateExposure.id,
          record_version: 1,
          record_type: 'candidate_exposure' as const,
          organization_id,
          produced_at: new Date().toISOString(),
          payload: {
            global_event_id,
            global_event_hash,
            exposure_strength,
            exposure_priority,
            has_valid_verification: false,
          },
        };

        await enqueueInTransaction(
          prisma,
          CHANGE_RECORD_QUEUE,
          {
            type: 'change_record',
            payload: record,
            timestamp: record.produced_at,
            organizationId: organization_id,
          },
          { idempotencyKey: changeRecordKey(record) }
        );

        changeRecordEmitted = true;
      }

      return {
        success: true,
        candidate_exposure_id: candidateExposure.id,
        organization_id,
        global_event_id,
        validation_status: validationStatus,
        change_record_emitted: changeRecordEmitted,
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
