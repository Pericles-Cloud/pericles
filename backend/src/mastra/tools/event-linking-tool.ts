import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPrismaClient } from '../../monitoring/db-client.js';

/**
 * Event Linking Tool
 *
 * Purpose: Identify and link related events in the Global Event Store.
 *
 * Link types:
 * - caused_by: Event A caused Event B (e.g., earthquake → tsunami → port closure)
 * - related_to: Events share root cause or are otherwise related
 *
 * Linking is best-effort: when unsure, leave events unlinked, because a wrong
 * link can merge two impacts downstream.
 */
export const eventLinkingTool = createTool({
  id: 'event-linking-tool',
  description: `
Identify and link related events in the Global Event Store.

Use this tool to:
1. Find events that may be related to a given event
2. Create parent/child relationships (large events spawn child events)
3. Link related events with typed relationships (caused_by, related_to)

Linking is best-effort. When unsure, leave events unlinked.
A wrong link can merge two impacts downstream.
`,
  inputSchema: z.object({
    // Event to link from
    event_id: z.string().uuid().describe('ID of the event to find links for'),
    
    // Linking criteria
    search_radius_km: z.number().default(200).describe('Radius to search for related events (km)'),
    time_window_hours: z.number().default(168).describe('Time window to search (hours, default 7 days)'),
    categories: z.array(z.string()).optional().describe('Categories to search (default: same as event)'),
    
    // Link creation
    create_links: z.boolean().default(false).describe('Whether to actually create the links'),
    links: z.array(z.object({
      target_event_id: z.string().uuid().describe('ID of the event to link to'),
      link_type: z.enum(['caused_by', 'related_to']).describe('Type of relationship'),
      confidence: z.number().min(0).max(1).describe('Confidence in this link (0-1)'),
      reason: z.string().describe('Reason for this link'),
    })).optional().describe('Links to create (if create_links is true)'),
    
    // Parent/child relationship
    set_parent: z.string().uuid().optional().describe('Set this event as child of the specified parent event'),
  }),
  outputSchema: z.object({
    event_id: z.string(),
    // Current links
    current_links: z.array(z.object({
      event_id: z.string(),
      headline: z.string(),
      link_type: z.string(),
      confidence: z.number(),
    })),
    parent_event_id: z.string().nullable(),
    
    // Suggested links (from search)
    suggested_links: z.array(z.object({
      event_id: z.string(),
      headline: z.string(),
      category: z.string(),
      status: z.string(),
      intrinsic_severity: z.string(),
      // Relationship analysis
      distance_km: z.number().nullable(),
      time_difference_hours: z.number().nullable(),
      category_match: z.boolean(),
      // Suggested link type
      suggested_link_type: z.enum(['caused_by', 'related_to', 'parent', 'child', 'none']),
      confidence: z.number(),
      reason: z.string(),
    })),
    
    // Created links (if create_links was true)
    created_links: z.array(z.object({
      target_event_id: z.string(),
      link_type: z.string(),
      confidence: z.number(),
      success: z.boolean(),
    })),
    
    // Parent update
    parent_updated: z.boolean(),
  }),
  execute: async ({ context }) => {
    const prisma = getPrismaClient();
    
    const {
      event_id,
      search_radius_km,
      time_window_hours,
      categories,
      create_links,
      links,
      set_parent,
    } = context;

    // Fetch the source event
    const event = await prisma.globalEvent.findUnique({
      where: { id: event_id },
    });

    if (!event) {
      return {
        event_id,
        current_links: [],
        parent_event_id: null,
        suggested_links: [],
        created_links: [],
        parent_updated: false,
      };
    }

    // Parse current links
    const currentLinksRaw = (event.related_event_ids as Array<{ event_id: string; type: string }>) ?? [];
    const currentLinkIds = currentLinksRaw.map((l) => l.event_id);

    // Fetch current linked events
    const currentLinkedEvents = currentLinkIds.length > 0
      ? await prisma.globalEvent.findMany({
          where: { id: { in: currentLinkIds } },
          select: { id: true, headline: true },
        })
      : [];

    const currentLinks = currentLinksRaw.map((link) => {
      const linkedEvent = currentLinkedEvents.find((e) => e.id === link.event_id);
      return {
        event_id: link.event_id,
        headline: linkedEvent?.headline ?? 'Unknown',
        link_type: link.type,
        confidence: 1.0, // Existing links are assumed confident
      };
    });

    // Search for potential related events
    const eventTime = event.occurred_at ?? event.first_detected_at;
    const timeWindowStart = new Date(eventTime.getTime() - time_window_hours * 60 * 60 * 1000);
    const timeWindowEnd = new Date(eventTime.getTime() + time_window_hours * 60 * 60 * 1000);

    const searchCategories = categories ?? [event.category];

    const candidates = await prisma.globalEvent.findMany({
      where: {
        id: { not: event_id },
        category: { in: searchCategories },
        occurred_at: {
          gte: timeWindowStart,
          lte: timeWindowEnd,
        },
        status: {
          notIn: ['RETRACTED', 'MERGED'],
        },
      },
      take: 50,
    });

    // Analyze candidates for potential links
    const suggestedLinks = candidates.map((candidate) => {
      // Calculate distance
      let distanceKm: number | null = null;
      if (event.latitude !== null && event.longitude !== null &&
          candidate.latitude !== null && candidate.longitude !== null) {
        distanceKm = haversineDistance(
          event.latitude,
          event.longitude,
          candidate.latitude,
          candidate.longitude
        );
      }

      // Calculate time difference
      const candidateTime = candidate.occurred_at ?? candidate.first_detected_at;
      const timeDifferenceHours = Math.abs(eventTime.getTime() - candidateTime.getTime()) / (1000 * 60 * 60);

      // Category match
      const categoryMatch = event.category === candidate.category;

      // Determine suggested link type and confidence
      let suggestedLinkType: 'caused_by' | 'related_to' | 'parent' | 'child' | 'none' = 'none';
      let confidence = 0;
      let reason = '';

      // Check if already linked
      const alreadyLinked = currentLinkIds.includes(candidate.id);
      if (alreadyLinked) {
        suggestedLinkType = 'none';
        confidence = 0;
        reason = 'Already linked';
      } else if (distanceKm !== null && distanceKm <= search_radius_km) {
        // Geographic proximity suggests relationship
        if (categoryMatch) {
          // Same category + proximity = likely related
          suggestedLinkType = 'related_to';
          confidence = Math.max(0.3, 0.8 - (distanceKm / search_radius_km) * 0.5);
          reason = `Same category, ${distanceKm.toFixed(0)}km apart, ${timeDifferenceHours.toFixed(0)}h difference`;
        } else {
          // Different category + proximity = possible causal relationship
          suggestedLinkType = 'related_to';
          confidence = Math.max(0.2, 0.6 - (distanceKm / search_radius_km) * 0.4);
          reason = `Different category but geographically close (${distanceKm.toFixed(0)}km)`;
        }

        // Check for parent/child potential
        // Larger events (higher severity) are more likely parents
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const eventSeverity = severityOrder[event.intrinsic_severity as keyof typeof severityOrder] ?? 0;
        const candidateSeverity = severityOrder[candidate.intrinsic_severity as keyof typeof severityOrder] ?? 0;

        if (eventSeverity > candidateSeverity && timeDifferenceHours < 48) {
          suggestedLinkType = 'child';
          confidence = Math.min(0.9, confidence + 0.2);
          reason = `Potential child event: lower severity, occurred ${timeDifferenceHours.toFixed(0)}h after parent`;
        } else if (candidateSeverity > eventSeverity && timeDifferenceHours < 48) {
          suggestedLinkType = 'parent';
          confidence = Math.min(0.9, confidence + 0.2);
          reason = `Potential parent event: higher severity, occurred ${timeDifferenceHours.toFixed(0)}h before`;
        }
      } else {
        reason = 'Outside search radius or insufficient data';
      }

      return {
        event_id: candidate.id,
        headline: candidate.headline,
        category: candidate.category,
        status: candidate.status,
        intrinsic_severity: candidate.intrinsic_severity,
        distance_km: distanceKm,
        time_difference_hours: timeDifferenceHours,
        category_match: categoryMatch,
        suggested_link_type: suggestedLinkType,
        confidence,
        reason,
      };
    });

    // Sort by confidence (highest first)
    suggestedLinks.sort((a, b) => b.confidence - a.confidence);

    // Create links if requested
    let createdLinks: Array<{ target_event_id: string; link_type: string; confidence: number; success: boolean }> = [];
    
    if (create_links && links && links.length > 0) {
      const newRelatedEventIds = [...currentLinksRaw];

      for (const link of links) {
        try {
          // Add to related_event_ids
          newRelatedEventIds.push({
            event_id: link.target_event_id,
            type: link.link_type,
          });

          createdLinks.push({
            target_event_id: link.target_event_id,
            link_type: link.link_type,
            confidence: link.confidence,
            success: true,
          });
        } catch (error) {
          createdLinks.push({
            target_event_id: link.target_event_id,
            link_type: link.link_type,
            confidence: link.confidence,
            success: false,
          });
        }
      }

      // Update the event with new links
      await prisma.globalEvent.update({
        where: { id: event_id },
        data: {
          related_event_ids: newRelatedEventIds,
          updated_at: new Date(),
        },
      });
    }

    // Update parent if requested
    let parentUpdated = false;
    if (set_parent) {
      await prisma.globalEvent.update({
        where: { id: event_id },
        data: {
          parent_event_id: set_parent,
          updated_at: new Date(),
        },
      });
      parentUpdated = true;
    }

    return {
      event_id,
      current_links: currentLinks,
      parent_event_id: event.parent_event_id,
      suggested_links: suggestedLinks.slice(0, 20), // Return top 20 suggestions
      created_links: createdLinks,
      parent_updated: parentUpdated,
    };
  },
});

/**
 * Calculate Haversine distance between two coordinates in kilometers
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
