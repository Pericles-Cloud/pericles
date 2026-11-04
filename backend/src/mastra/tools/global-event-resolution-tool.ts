import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPrismaClient } from '../../monitoring/db-client.js';

/**
 * Global Event Resolution Tool
 *
 * Purpose: Mark events as Resolved when they have ended globally.
 * An event is Resolved when:
 * - Authoritative sources report normal operations restored (source_restoration)
 * - After [N] days with no new signal for its category (no_signal_timeout)
 *
 * This tool also handles:
 * - Retracting events that prove false (Retracted status)
 * - Merging duplicate events (Merged status)
 */
export const globalEventResolutionTool = createTool({
  id: 'global-event-resolution-tool',
  description: `
Mark a Global Event as Resolved, Retracted, or Merged.

Use this tool when:
- Authoritative sources report normal operations restored (source_restoration)
- No new signals for the event's category after the timeout period (no_signal_timeout)
- An event proves false, hoax, or misreported (Retracted)
- Two events describe the same occurrence (Merged)

Never delete events - always use status transitions.
`,
  inputSchema: z.object({
    event_id: z.string().uuid().describe('ID of the event to resolve/retract/merge'),
    
    // Resolution action
    action: z.enum(['resolve', 'retract', 'merge']).describe('Action to take'),
    
    // For resolve action
    resolution_basis: z.enum(['source_restoration', 'no_signal_timeout']).optional()
      .describe('Basis for resolution (required for resolve action)'),
    restoration_source: z.string().url().optional()
      .describe('URL of source reporting restoration (for source_restoration)'),
    restoration_evidence: z.string().optional()
      .describe('Evidence that operations have restored'),
    
    // For retract action
    retraction_reason: z.string().optional()
      .describe('Reason for retraction (required for retract action)'),
    retraction_evidence: z.string().optional()
      .describe('Evidence that event was false/misreported'),
    
    // For merge action
    merge_into_event_id: z.string().uuid().optional()
      .describe('ID of the surviving event (required for merge action)'),
    merge_reason: z.string().optional()
      .describe('Reason for merge'),
    
    // Timeline entry
    timeline_note: z.string().optional()
      .describe('Additional note for the timeline entry'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    event_id: z.string(),
    new_status: z.string(),
    resolved_at: z.string().datetime().nullable(),
    resolution_basis: z.string().nullable(),
    timeline_entry: z.object({
      timestamp: z.string().datetime(),
      field: z.string(),
      old_value: z.string(),
      new_value: z.string(),
      source: z.string().nullable(),
      note: z.string().nullable(),
    }),
    // Change record for downstream agents
    change_record: z.object({
      event_id: z.string(),
      change_type: z.string(),
      is_material: z.boolean(),
      changed_fields: z.array(z.string()),
      timestamp: z.string().datetime(),
    }),
    error: z.string().nullable(),
  }),
  execute: async ({ context }) => {
    const prisma = getPrismaClient();
    
    const {
      event_id,
      action,
      resolution_basis,
      restoration_source,
      restoration_evidence,
      retraction_reason,
      retraction_evidence,
      merge_into_event_id,
      merge_reason,
      timeline_note,
    } = context;

    // Fetch the current event
    const event = await prisma.globalEvent.findUnique({
      where: { id: event_id },
    });

    if (!event) {
      return {
        success: false,
        event_id,
        new_status: 'UNKNOWN',
        resolved_at: null,
        resolution_basis: null,
        timeline_entry: {
          timestamp: new Date().toISOString(),
          field: 'status',
          old_value: 'UNKNOWN',
          new_value: 'ERROR',
          source: null,
          note: 'Event not found',
        },
        change_record: {
          event_id,
          change_type: 'error',
          is_material: false,
          changed_fields: [],
          timestamp: new Date().toISOString(),
        },
        error: 'Event not found',
      };
    }

    const now = new Date();
    const oldStatus = event.status;
    let newStatus: string;
    let resolvedAt: Date | null = null;
    let resolutionBasis: string | null = null;
    let source: string | null = null;
    let note: string | null = timeline_note ?? null;

    switch (action) {
      case 'resolve':
        if (!resolution_basis) {
          return {
            success: false,
            event_id,
            new_status: oldStatus,
            resolved_at: null,
            resolution_basis: null,
            timeline_entry: {
              timestamp: now.toISOString(),
              field: 'status',
              old_value: oldStatus,
              new_value: 'RESOLVED',
              source: null,
              note: 'Missing resolution_basis',
            },
            change_record: {
              event_id,
              change_type: 'error',
              is_material: false,
              changed_fields: [],
              timestamp: now.toISOString(),
            },
            error: 'resolution_basis is required for resolve action',
          };
        }
        newStatus = 'RESOLVED';
        resolvedAt = now;
        resolutionBasis = resolution_basis;
        source = restoration_source ?? null;
        note = restoration_evidence ? `${note ?? ''} Evidence: ${restoration_evidence}`.trim() : note;
        break;

      case 'retract':
        if (!retraction_reason) {
          return {
            success: false,
            event_id,
            new_status: oldStatus,
            resolved_at: null,
            resolution_basis: null,
            timeline_entry: {
              timestamp: now.toISOString(),
              field: 'status',
              old_value: oldStatus,
              new_value: 'RETRACTED',
              source: null,
              note: 'Missing retraction_reason',
            },
            change_record: {
              event_id,
              change_type: 'error',
              is_material: false,
              changed_fields: [],
              timestamp: now.toISOString(),
            },
            error: 'retraction_reason is required for retract action',
          };
        }
        newStatus = 'RETRACTED';
        note = `Retraction reason: ${retraction_reason}${retraction_evidence ? `. Evidence: ${retraction_evidence}` : ''}`;
        break;

      case 'merge':
        if (!merge_into_event_id) {
          return {
            success: false,
            event_id,
            new_status: oldStatus,
            resolved_at: null,
            resolution_basis: null,
            timeline_entry: {
              timestamp: now.toISOString(),
              field: 'status',
              old_value: oldStatus,
              new_value: 'MERGED',
              source: null,
              note: 'Missing merge_into_event_id',
            },
            change_record: {
              event_id,
              change_type: 'error',
              is_material: false,
              changed_fields: [],
              timestamp: now.toISOString(),
            },
            error: 'merge_into_event_id is required for merge action',
          };
        }
        newStatus = 'MERGED';
        note = `Merged into event ${merge_into_event_id}${merge_reason ? `. Reason: ${merge_reason}` : ''}`;
        break;

      default:
        newStatus = oldStatus;
    }

    // Create timeline entry
    const timelineEntry = {
      timestamp: now.toISOString(),
      field: 'status',
      old_value: oldStatus,
      new_value: newStatus,
      source,
      note,
    };

    // Update the event
    const timeline = (event.timeline as Array<Record<string, unknown>>) ?? [];
    timeline.push(timelineEntry as Record<string, unknown>);

    await prisma.globalEvent.update({
      where: { id: event_id },
      data: {
        status: newStatus as any,
        resolved_at: resolvedAt,
        resolution_basis: resolutionBasis,
        timeline: timeline as any,
        updated_at: now,
      },
    });

    // Create change record for downstream agents
    const changeRecord = {
      event_id,
      change_type: action === 'resolve' ? 'resolved' : action === 'retract' ? 'retracted' : 'merged',
      is_material: true, // Status changes are always material
      changed_fields: ['status', 'resolved_at', 'resolution_basis'],
      timestamp: now.toISOString(),
    };

    return {
      success: true,
      event_id,
      new_status: newStatus,
      resolved_at: resolvedAt?.toISOString() ?? null,
      resolution_basis: resolutionBasis,
      timeline_entry: timelineEntry,
      change_record: changeRecord,
      error: null,
    };
  },
});
