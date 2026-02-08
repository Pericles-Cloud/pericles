import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createHash } from 'crypto';
import { getPrismaClient } from '../../monitoring/db-client';
import { toolLoggers } from './tool-logger';

const prisma = getPrismaClient();
const logger = toolLoggers.incidentLookup;

/**
 * Incident Lookup Tool
 *
 * Purpose: Deduplication via event hash lookup to prevent duplicate event publication.
 *
 * This tool generates a stable SHA-256 hash from normalized event data and checks
 * if the event has been seen before within a 7-day lookback window.
 *
 * Hash Formula: SHA-256(normalized_title|normalized_source|normalized_type|hour_bucket)
 *
 * Organization Isolation: All queries filter by organization_id
 */

/**
 * Generate a stable event hash for deduplication
 *
 * @param title - Event title
 * @param source - Data source (e.g., 'news_api', 'weather_api')
 * @param type - Event type (e.g., 'flood', 'strike', 'port_closure')
 * @param timestamp - Event timestamp in ISO 8601 format
 * @returns SHA-256 hash string
 */
export function generateEventHash(
  title: string,
  source: string,
  type: string,
  _timestamp: string
): string {
  // Normalize inputs for stable hashing
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedSource = source.trim().toLowerCase();
  const normalizedType = type.trim().toLowerCase();

  // Truncate timestamp to hour for bucketing (reduces hash proliferation)
  const timestampDate = new Date(_timestamp);
  const hourBucket = new Date(
    timestampDate.getFullYear(),
    timestampDate.getMonth(),
    timestampDate.getDate(),
    timestampDate.getHours(),
    0, // minutes
    0, // seconds
    0  // milliseconds
  ).toISOString();

  // Create stable hash input
  const _hashInput = `${normalizedTitle}|${normalizedSource}|${normalizedType}|${hourBucket}`;

  // Generate SHA-256 hash
  return createHash('sha256').update(_hashInput, 'utf8').digest('hex');
}

export const incidentLookupTool = createTool({
  id: 'incident-lookup',
  description: 'Check if an incident has been seen before using content hash for deduplication. Returns event_hash and duplicate status.',

  inputSchema: z.object({
    title: z.string().min(1).describe('Event title'),
    source: z.string().min(1).describe('Data source identifier (e.g., news_api, weather_api)'),
    type: z.string().min(1).describe('Incident type (e.g., flood, strike, port_closure)'),
    timestamp: z.string().datetime().describe('Event timestamp in ISO 8601 format'),
    organization_id: z.string().uuid().describe('Organization identifier (required for all operations)')
  }),

  outputSchema: z.object({
    event_hash: z.string().describe('SHA-256 hash of normalized event content'),
    is_duplicate: z.boolean().describe('True if event has been seen before within lookback window'),
    last_seen_at: z.string().datetime().optional().describe('When this event was last detected'),
    original_event_id: z.string().uuid().optional().describe('ID of the original event if duplicate'),
    occurrence_count: z.number().int().optional().describe('Number of times this event has been detected')
  }),

  execute: async ({ context }) => {
    const { title, source, type, timestamp, organization_id } = context;

    // Log the input parameters received
    logger.debug({ title, source, type, organizationId: organization_id }, 'Tool executed');

    // CRITICAL: Validate organization_id is present
    if (!organization_id) {
      throw new Error('organization_id is required for incident lookup');
    }

    // Generate stable content hash
    const eventHash = generateEventHash(title, source, type, timestamp);

    logger.info({ hash: eventHash, organizationId: organization_id }, 'Checking for duplicate');

    try {
      // Query EventHash table with organization isolation
      const existingHash = await prisma.eventHash.findUnique({
        where: {
          organization_id_hash: {
            organization_id: organization_id,
            hash: eventHash
          }
        },
        select: {
          last_seen_at: true,
          original_event_id: true,
          occurrence_count: true,
          expires_at: true
        }
      });

      if (existingHash) {
        // Check if hash has expired (7-day TTL)
        const now = new Date();
        if (now > existingHash.expires_at) {
          logger.debug({ hash: eventHash }, 'Hash expired, treating as new event');
          return {
            event_hash: eventHash,
            is_duplicate: false
          };
        }

        logger.info({ hash: eventHash, lastSeen: existingHash.last_seen_at.toISOString() }, 'Duplicate found');

        return {
          event_hash: eventHash,
          is_duplicate: true,
          last_seen_at: existingHash.last_seen_at.toISOString(),
          original_event_id: existingHash.original_event_id,
          occurrence_count: existingHash.occurrence_count
        };
      }

      // No duplicate found
      logger.debug({ hash: eventHash }, 'No duplicate found, new event');

      return {
        event_hash: eventHash,
        is_duplicate: false
      };

    } catch (error) {
      logger.error({ error, hash: eventHash }, 'Database query failed');
      throw new Error(`Failed to lookup incident: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});
