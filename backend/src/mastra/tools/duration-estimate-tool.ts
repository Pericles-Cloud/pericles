import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPrismaClient } from '../../monitoring/db-client.js';

/**
 * Duration Estimate Tool
 *
 * Purpose: Produce customer-agnostic duration estimates for events of Medium
 * intrinsic severity or higher.
 *
 * For every event of Medium severity or higher, produce:
 * - best: optimistic range for how long the disruption will last
 * - base: most likely range
 * - worst: pessimistic range
 *
 * Build each range by composing relevant Topical and Regional Skills together
 * with official forecasts and historical precedent.
 *
 * Keep duration_estimate separate from expected_duration, which holds only
 * durations that sources state. Never present your estimate as source-stated.
 */
export const durationEstimateTool = createTool({
  id: 'duration-estimate-tool',
  description: `
Produce duration estimates for Global Events of Medium severity or higher.

Returns best, base, and worst case ranges for how long the disruption to the
event's target will last (e.g., how long a port stays closed, how long a strike runs).

Use this tool for:
- Events with intrinsic_severity of 'medium', 'high', or 'critical'
- When you need to estimate duration beyond what sources explicitly state
- When updating an event's duration estimate after a material change

Do NOT use for:
- Low severity events (duration estimate not required)
- Copying source-stated durations (use expected_duration field instead)
`,
  inputSchema: z.object({
    event_id: z.string().uuid().describe('ID of the event to estimate duration for'),
    
    // Event context for estimation
    category: z.string().describe('Event category'),
    subcategory: z.string().optional().describe('Event subcategory'),
    intrinsic_severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Event severity'),
    
    // Target information
    target_type: z.string().describe('What is disrupted (port, plant, route, etc.)'),
    target_name: z.string().describe('Name of the disrupted target'),
    target_criticality: z.enum(['local', 'regional', 'national', 'global']).optional()
      .describe('How critical the target is to supply chains'),
    
    // Historical context
    historical_precedents: z.array(z.object({
      event_description: z.string().describe('Description of similar historical event'),
      duration_hours: z.number().describe('How long that event lasted (hours)'),
      year: z.number().optional().describe('Year of the historical event'),
      similarity_notes: z.string().optional().describe('Why this is comparable'),
    })).optional().describe('Historical events to use as precedent'),
    
    // Official forecasts
    official_forecast: z.object({
      source: z.string().describe('Source of the forecast'),
      expected_duration_hours: z.number().optional().describe('Official expected duration'),
      confidence: z.string().optional().describe('Official confidence level'),
    }).optional().describe('Official forecast if available'),
    
    // Current status
    hours_elapsed: z.number().default(0).describe('Hours since event started'),
    current_status_notes: z.string().optional().describe('Current status of the disruption'),
    
    // Estimation parameters
    confidence_level: z.enum(['low', 'medium', 'high']).default('medium')
      .describe('Confidence in this estimate'),
    estimation_basis: z.string().describe('Basis for this estimate (historical, forecast, expert judgment)'),
  }),
  outputSchema: z.object({
    event_id: z.string(),
    
    // Duration estimates (hours)
    duration_estimate: z.object({
      best: z.object({
        min_hours: z.number(),
        max_hours: z.number(),
      }),
      base: z.object({
        min_hours: z.number(),
        max_hours: z.number(),
      }),
      worst: z.object({
        min_hours: z.number(),
        max_hours: z.number(),
      }),
      basis: z.string(),
      confidence: z.string(),
    }),
    
    // Estimation details
    estimation_details: z.object({
      historical_precedents_used: z.number(),
      official_forecast_used: z.boolean(),
      severity_adjustment: z.string(),
      target_criticality_adjustment: z.string(),
      elapsed_time_adjustment: z.string(),
    }),
    
    // Warnings
    warnings: z.array(z.string()),
    
    // Whether estimate was saved
    saved: z.boolean(),
  }),
  execute: async ({ context }) => {
    const prisma = getPrismaClient();
    
    const {
      event_id,
      category,
      subcategory,
      intrinsic_severity,
      target_type,
      target_name,
      target_criticality,
      historical_precedents,
      official_forecast,
      hours_elapsed,
      current_status_notes,
      confidence_level,
      estimation_basis,
    } = context;

    const warnings: string[] = [];

    // Check if duration estimate is required
    if (intrinsic_severity === 'low') {
      warnings.push('Duration estimate not required for low severity events');
    }

    // Base duration estimates by category (in hours)
    const baseDurations: Record<string, { best: [number, number]; base: [number, number]; worst: [number, number] }> = {
      'Meteorological / Natural Hazard': {
        best: [24, 72],
        base: [72, 168],
        worst: [168, 336],
      },
      'Geopolitical / Conflict': {
        best: [48, 168],
        base: [168, 720],
        worst: [720, 2160],
      },
      'Sanctions & Trade Policy': {
        best: [168, 720],
        base: [720, 2160],
        worst: [2160, 8760],
      },
      'Regulatory & Compliance': {
        best: [72, 336],
        base: [336, 1440],
        worst: [1440, 4320],
      },
      'Labor': {
        best: [24, 120],
        base: [120, 480],
        worst: [480, 1440],
      },
      'Logistics & Infrastructure': {
        best: [12, 72],
        base: [72, 336],
        worst: [336, 1008],
      },
      'Industrial / Facility': {
        best: [24, 168],
        base: [168, 720],
        worst: [720, 2160],
      },
      'Cyber': {
        best: [24, 168],
        base: [168, 720],
        worst: [720, 2160],
      },
      'Economic & Financial': {
        best: [168, 720],
        base: [720, 2160],
        worst: [2160, 8760],
      },
      'Public Health': {
        best: [168, 720],
        base: [720, 2160],
        worst: [2160, 8760],
      },
    };

    // Get base duration for category
    const categoryKey = category;
    const baseDuration = baseDurations[categoryKey] ?? {
      best: [48, 168],
      base: [168, 720],
      worst: [720, 2160],
    };

    // Adjust for severity
    const severityMultipliers: Record<string, number> = {
      low: 0.5,
      medium: 1.0,
      high: 1.5,
      critical: 2.5,
    };
    const severityMultiplier = severityMultipliers[intrinsic_severity] ?? 1.0;

    // Adjust for target criticality
    const criticalityMultipliers: Record<string, number> = {
      local: 0.7,
      regional: 1.0,
      national: 1.3,
      global: 2.0,
    };
    const criticalityMultiplier = target_criticality
      ? criticalityMultipliers[target_criticality] ?? 1.0
      : 1.0;

    // Adjust for elapsed time (if event has been ongoing longer than expected, extend estimate)
    let elapsedMultiplier = 1.0;
    if (hours_elapsed > baseDuration.base[1]) {
      elapsedMultiplier = 1.2; // Already exceeded base estimate, extend
      warnings.push(`Event has already lasted ${hours_elapsed}h, exceeding base estimate of ${baseDuration.base[1]}h`);
    }

    // Calculate adjusted durations
    const calculateRange = (range: [number, number]): { min_hours: number; max_hours: number } => ({
      min_hours: Math.round(range[0] * severityMultiplier * criticalityMultiplier * elapsedMultiplier),
      max_hours: Math.round(range[1] * severityMultiplier * criticalityMultiplier * elapsedMultiplier),
    });

    let best = calculateRange(baseDuration.best);
    let base = calculateRange(baseDuration.base);
    let worst = calculateRange(baseDuration.worst);

    // Incorporate historical precedents if provided
    let historicalPrecedentsUsed = 0;
    if (historical_precedents && historical_precedents.length > 0) {
      const precedentDurations = historical_precedents.map((p) => p.duration_hours);
      const avgPrecedent = precedentDurations.reduce((a, b) => a + b, 0) / precedentDurations.length;
      const minPrecedent = Math.min(...precedentDurations);
      const maxPrecedent = Math.max(...precedentDurations);

      // Blend with base estimates (50% weight to precedents)
      best = {
        min_hours: Math.round((best.min_hours + minPrecedent * 0.5) / 1.5),
        max_hours: Math.round((best.max_hours + avgPrecedent * 0.5) / 1.5),
      };
      base = {
        min_hours: Math.round((base.min_hours + avgPrecedent * 0.7) / 1.7),
        max_hours: Math.round((base.max_hours + avgPrecedent * 0.7) / 1.7),
      };
      worst = {
        min_hours: Math.round((worst.min_hours + avgPrecedent * 0.5) / 1.5),
        max_hours: Math.round((worst.max_hours + maxPrecedent * 0.5) / 1.5),
      };

      historicalPrecedentsUsed = historical_precedents.length;
    }

    // Incorporate official forecast if provided
    let officialForecastUsed = false;
    if (official_forecast?.expected_duration_hours) {
      const forecastHours = official_forecast.expected_duration_hours;
      
      // Use forecast as base case, adjust best/worst around it
      base = {
        min_hours: Math.round(forecastHours * 0.7),
        max_hours: Math.round(forecastHours * 1.3),
      };
      best = {
        min_hours: Math.round(forecastHours * 0.4),
        max_hours: Math.round(forecastHours * 0.8),
      };
      worst = {
        min_hours: Math.round(forecastHours * 1.2),
        max_hours: Math.round(forecastHours * 2.0),
      };

      officialForecastUsed = true;
    }

    // Ensure min <= max for all ranges
    best = { min_hours: Math.min(best.min_hours, best.max_hours), max_hours: Math.max(best.min_hours, best.max_hours) };
    base = { min_hours: Math.min(base.min_hours, base.max_hours), max_hours: Math.max(base.min_hours, base.max_hours) };
    worst = { min_hours: Math.min(worst.min_hours, worst.max_hours), max_hours: Math.max(worst.min_hours, worst.max_hours) };

    // Ensure ranges are ordered: best <= base <= worst
    if (best.max_hours > base.min_hours) {
      best.max_hours = base.min_hours;
    }
    if (base.max_hours > worst.min_hours) {
      worst.min_hours = base.max_hours;
    }

    const durationEstimate = {
      best,
      base,
      worst,
      basis: estimation_basis,
      confidence: confidence_level,
    };

    const estimationDetails = {
      historical_precedents_used: historicalPrecedentsUsed,
      official_forecast_used: officialForecastUsed,
      severity_adjustment: `${severityMultiplier}x for ${intrinsic_severity} severity`,
      target_criticality_adjustment: target_criticality
        ? `${criticalityMultiplier}x for ${target_criticality} criticality`
        : 'No criticality adjustment (unknown)',
      elapsed_time_adjustment: elapsedMultiplier > 1.0
        ? `${elapsedMultiplier}x for extended duration`
        : 'No elapsed time adjustment',
    };

    // Save to database
    let saved = false;
    try {
      await prisma.globalEvent.update({
        where: { id: event_id },
        data: {
          duration_estimate: durationEstimate,
          updated_at: new Date(),
        },
      });
      saved = true;
    } catch (error) {
      warnings.push(`Failed to save duration estimate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      event_id,
      duration_estimate: durationEstimate,
      estimation_details: estimationDetails,
      warnings,
      saved,
    };
  },
});
