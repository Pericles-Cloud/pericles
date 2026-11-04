/**
 * Global Event Change Record (Doctrine §13)
 *
 * Change records emitted when events are created, updated, or resolved.
 * These records are consumed by:
 * - Client Monitoring Agents (re-evaluate customer exposure)
 * - Event Verification (triggered for High/Critical severity events)
 * - Other downstream agents (refresh outputs)
 */

import type { ChangeRecord } from './change-record.js';

// ============================================================================
// Per-org Event Change Records (existing Event table)
// ============================================================================

/**
 * Create a global_event_change record for a per-org Event
 * (used by the existing monitoring agent for the Event table)
 */
export function globalEventChangeRecord(
  event: { id: string; organization_id: string; severity: number; type: string },
  producedAt: Date
): ChangeRecord {
  return {
    record_id: event.id,
    record_version: 1,
    record_type: 'global_event_change',
    organization_id: event.organization_id,
    produced_at: producedAt.toISOString(),
    payload: {
      change_kind: 'created',
      severity: event.severity,
      event_type: event.type,
    },
  };
}

// ============================================================================
// Global Event Store Change Records (new GlobalEvent table)
// ============================================================================

export interface GlobalEventStoreChangePayload {
  /** Global event ID */
  event_id: string;
  /** Event hash for deduplication */
  event_hash: string;
  /** Type of change */
  change_type: 'created' | 'updated' | 'resolved' | 'retracted' | 'merged';
  /** Event intrinsic severity */
  intrinsic_severity: string;
  /** Event lifecycle status */
  status: string;
  /** Changed fields (for updates) */
  changed_fields?: string[];
  /** Whether this is a material change */
  is_material?: boolean;
}

/**
 * Create a global_event_change record for a GlobalEvent
 * (used by the Global Monitoring Agent for the GlobalEvent table)
 */
export function globalEventStoreChangeRecord(
  payload: GlobalEventStoreChangePayload,
  producedAt: Date
): ChangeRecord {
  return {
    record_id: `global-event-${payload.event_id}`,
    record_version: 1,
    record_type: 'global_event_change',
    organization_id: null, // Global events have no org scope
    produced_at: producedAt.toISOString(),
    payload: payload as unknown as Record<string, unknown>,
  };
}

/**
 * Check if a global event change is material
 * Material changes trigger downstream re-evaluation
 */
export function isMaterialChange(payload: GlobalEventStoreChangePayload): boolean {
  // Created and resolved events are always material
  if (payload.change_type === 'created' || payload.change_type === 'resolved') {
    return true;
  }

  // Retracted and merged events are always material
  if (payload.change_type === 'retracted' || payload.change_type === 'merged') {
    return true;
  }

  // For updates, check if material fields changed
  if (payload.change_type === 'updated' && payload.changed_fields) {
    const materialFields = [
      'status',
      'intrinsic_severity',
      'latitude',
      'longitude',
      'affected_area',
      'named_infrastructure',
      'duration_estimate',
      'parent_event_id',
    ];
    return payload.changed_fields.some((field) => materialFields.includes(field));
  }

  return payload.is_material ?? false;
}

/**
 * Check if a global event change should trigger Event Verification
 * High and Critical severity events trigger proactive verification
 */
export function shouldTriggerVerification(payload: GlobalEventStoreChangePayload): boolean {
  if (payload.change_type !== 'created' && payload.change_type !== 'updated') {
    return false;
  }

  return payload.intrinsic_severity === 'high' || payload.intrinsic_severity === 'critical';
}
