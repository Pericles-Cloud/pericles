import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Weather & Natural Disaster Monitor Tool
 *
 * Purpose: Monitor weather conditions and natural disaster events near supply chain locations.
 *
 * Data Sources:
 * - NOAA Weather API: Severe weather alerts and forecasts
 * - NASA EONET API: Global natural disaster events (earthquakes, floods, wildfires, etc.)
 *
 * Risk Categories:
 * - Hurricanes/Tropical Storms
 * - Floods
 * - Earthquakes
 * - Wildfires
 * - Severe Weather (tornadoes, hail, etc.)
 * - Volcanic Activity
 *
 * Organization Isolation: Filters events based on organization's geographic exposure
 */

const LocationInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string()
});

const WeatherEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // hurricane, flood, earthquake, wildfire, severe_storm, volcanic
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1), // 0.0-1.0 normalized severity
  location: z.object({
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    affected_radius_km: z.number().optional()
  }),
  start_time: z.string().datetime(),
  end_time: z.string().datetime().optional(),
  source: z.string(), // 'NOAA' or 'EONET'
  raw_data: z.record(z.string(), z.any()).optional()
});

export const weatherDisasterMonitorTool = createTool({
  id: 'weather-disaster-monitor',
  description: 'Monitor weather conditions and natural disaster events (hurricanes, floods, earthquakes, wildfires) near supply chain locations using NOAA and NASA EONET APIs.',

  inputSchema: z.object({
    locations: z.array(LocationInputSchema).min(1).describe('Locations to monitor for weather events'),
    severity_threshold: z.enum(['low', 'medium', 'high']).default('medium').describe('Minimum severity to report'),
    lookback_hours: z.number().int().min(1).max(168).default(24).describe('How many hours back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    weather_events: z.array(WeatherEventSchema).describe('Detected weather and natural disaster events'),
    monitored_locations_count: z.number().int().describe('Number of locations checked'),
    api_calls_made: z.number().int().describe('Number of API calls made to data sources')
  }),

  execute: async ({ context }) => {
    const { locations, severity_threshold: _severity_threshold, lookback_hours: _lookback_hours, organization_id } = context;

    // Log the input parameters received
    console.log(`[Weather Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for weather monitoring');
    }

    console.log(`[Weather Monitor] Monitoring ${locations.length} locations for organization: ${organization_id}`);

    // PLACEHOLDER: Actual API integration to be implemented
    // This would call:
    // 1. NOAA Weather API: https://www.weather.gov/documentation/services-web-api
    // 2. NASA EONET API: https://eonet.gsfc.nasa.gov/docs/v3

    try {
      const weatherEvents: Array<z.infer<typeof WeatherEventSchema>> = [];
      const apiCallsMade = 0;

      // TODO: Implement NOAA API integration
      // const noaaEvents = await fetchNOAAAlerts(_locations, lookback_hours);
      // apiCallsMade += locations.length;

      // TODO: Implement EONET API integration
      // const eonetEvents = await fetchEONETEvents(_locations, lookback_hours);
      // apiCallsMade += 1; // EONET has a single global endpoint

      // PLACEHOLDER: Return empty array for now
      // In production, this would process and normalize events from both APIs

      console.log(`[Weather Monitor] Found ${weatherEvents.length} events, made ${apiCallsMade} API calls`);

      return {
        weather_events: weatherEvents,
        monitored_locations_count: locations.length,
        api_calls_made: apiCallsMade
      };

    } catch (error) {
      console.error(`[Weather Monitor] Failed to fetch weather data:`, error);
      throw new Error(`Weather monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Helper Functions (to be implemented with actual API integration)
// ============================================================================

/**
 * Fetch severe weather alerts from NOAA Weather API
 * API Docs: https://www.weather.gov/documentation/services-web-api
 */
async function _fetchNOAAAlerts(
  _locations: Array<{ latitude: number; longitude: number; name: string }>,
  _lookbackHours: number
): Promise<Array<z.infer<typeof WeatherEventSchema>>> {
  // TODO: Implement NOAA API calls
  // const events: z.infer<typeof WeatherEventSchema>[] = [];
  //
  // for (const location of locations) {
  //   const response = await fetch(
  //     `https://api.weather.gov/alerts/active?point=${location.latitude},${location.longitude}`
  //   );
  //   const data = await response.json();
  //
  //   // Parse and normalize NOAA alerts to WeatherEventSchema
  //   // Calculate severity based on alert category
  // }
  //
  // return events;

  return [];
}

/**
 * Fetch natural disaster events from NASA EONET API
 * API Docs: https://eonet.gsfc.nasa.gov/docs/v3
 */
async function _fetchEONETEvents(
  _locations: Array<{ latitude: number; longitude: number; name: string }>,
  _lookbackHours: number
): Promise<Array<z.infer<typeof WeatherEventSchema>>> {
  // TODO: Implement EONET API calls
  // const now = new Date();
  // const startDate = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  //
  // const response = await fetch(
  //   `https://eonet.gsfc.nasa.gov/api/v3/events?start=${startDate.toISOString()}&status=open`
  // );
  // const data = await response.json();
  //
  // // Filter events by proximity to monitored locations
  // // Normalize to WeatherEventSchema format
  //
  // return events;

  return [];
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
