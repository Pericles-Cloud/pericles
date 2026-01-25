import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Weather & Natural Disaster Monitor Tool
 *
 * Purpose: Monitor weather conditions and natural disaster events near supply chain locations.
 *
 * Data Sources:
 * - NOAA Weather API: Severe weather alerts and forecasts
 *   API: https://www.weather.gov/documentation/services-web-api
 * - NASA EONET API: Global natural disaster events (earthquakes, floods, wildfires, etc.)
 *   API: https://eonet.gsfc.nasa.gov/docs/v3
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
    const { locations, severity_threshold, lookback_hours, organization_id } = context;

    // Log the input parameters received
    console.log(`[Weather Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for weather monitoring');
    }

    console.log(`[Weather Monitor] Monitoring ${locations.length} locations for organization: ${organization_id}`);

    try {
      const weatherEvents: Array<z.infer<typeof WeatherEventSchema>> = [];
      let apiCallsMade = 0;

      const severityThresholdValue = severity_threshold === 'low' ? 0.3 : severity_threshold === 'medium' ? 0.5 : 0.7;

      // Fetch NOAA alerts for each location (US only)
      const noaaEvents = await fetchNOAAAlerts(locations, lookback_hours);
      apiCallsMade += locations.length;
      weatherEvents.push(...noaaEvents.filter(e => e.severity >= severityThresholdValue));

      // Fetch EONET global events
      const eonetEvents = await fetchEONETEvents(locations, lookback_hours);
      apiCallsMade += 1;
      weatherEvents.push(...eonetEvents.filter(e => e.severity >= severityThresholdValue));

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
// NOAA Weather API Integration
// ============================================================================

interface NOAAAlert {
  id: string;
  properties: {
    event: string;
    headline: string;
    description: string;
    severity: string; // Extreme, Severe, Moderate, Minor, Unknown
    certainty: string;
    urgency: string;
    onset: string;
    ends?: string;
    areaDesc: string;
  };
  geometry?: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
}

interface NOAAResponse {
  features: NOAAAlert[];
}

/**
 * Fetch severe weather alerts from NOAA Weather API
 * API Docs: https://www.weather.gov/documentation/services-web-api
 * Note: NOAA API only covers US locations
 */
async function fetchNOAAAlerts(
  locations: Array<{ latitude: number; longitude: number; name: string }>,
  lookbackHours: number
): Promise<Array<z.infer<typeof WeatherEventSchema>>> {
  const events: Array<z.infer<typeof WeatherEventSchema>> = [];

  for (const location of locations) {
    // NOAA only works for US locations (roughly lat 24-50, lon -125 to -66)
    if (location.latitude < 24 || location.latitude > 50 ||
        location.longitude < -125 || location.longitude > -66) {
      console.log(`[NOAA] Skipping non-US location: ${location.name}`);
      continue;
    }

    try {
      const response = await fetch(
        `https://api.weather.gov/alerts/active?point=${location.latitude},${location.longitude}`,
        {
          headers: {
            'User-Agent': 'Pericles-SupplyChainMonitor/1.0 (contact@pericles.cloud)',
            'Accept': 'application/geo+json'
          },
          signal: AbortSignal.timeout(10000)
        }
      );

      if (!response.ok) {
        console.warn(`[NOAA] API error for ${location.name}: ${response.status}`);
        continue;
      }

      const data = await response.json() as NOAAResponse;

      if (!data.features || !Array.isArray(data.features)) {
        continue;
      }

      const cutoffTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

      for (const alert of data.features) {
        const onset = new Date(alert.properties.onset);
        if (onset < cutoffTime) continue;

        const severity = mapNOAASeverity(alert.properties.severity);
        const eventType = classifyNOAAEventType(alert.properties.event);

        events.push({
          event_id: `noaa-${alert.id}`,
          event_type: eventType,
          title: alert.properties.headline,
          description: alert.properties.description.substring(0, 1000),
          severity,
          location: {
            name: alert.properties.areaDesc || location.name,
            latitude: location.latitude,
            longitude: location.longitude
          },
          start_time: alert.properties.onset,
          end_time: alert.properties.ends,
          source: 'NOAA',
          raw_data: alert.properties
        });
      }

      console.log(`[NOAA] Found ${data.features.length} alerts for ${location.name}`);
    } catch (err) {
      console.error(`[NOAA] Error fetching alerts for ${location.name}:`, err);
    }
  }

  return events;
}

function mapNOAASeverity(severity: string): number {
  switch (severity.toLowerCase()) {
    case 'extreme': return 0.95;
    case 'severe': return 0.8;
    case 'moderate': return 0.6;
    case 'minor': return 0.4;
    default: return 0.3;
  }
}

function classifyNOAAEventType(event: string): string {
  const eventLower = event.toLowerCase();
  if (eventLower.includes('hurricane') || eventLower.includes('tropical')) return 'hurricane';
  if (eventLower.includes('flood')) return 'flood';
  if (eventLower.includes('tornado')) return 'severe_storm';
  if (eventLower.includes('fire') || eventLower.includes('wildfire')) return 'wildfire';
  if (eventLower.includes('earthquake')) return 'earthquake';
  if (eventLower.includes('volcano')) return 'volcanic';
  if (eventLower.includes('winter') || eventLower.includes('blizzard') || eventLower.includes('ice')) return 'winter_storm';
  if (eventLower.includes('thunderstorm') || eventLower.includes('severe')) return 'severe_storm';
  return 'weather_alert';
}

// ============================================================================
// NASA EONET API Integration
// ============================================================================

interface EONETEvent {
  id: string;
  title: string;
  description?: string;
  link: string;
  closed?: string;
  categories: Array<{ id: string; title: string }>;
  geometry: Array<{
    magnitudeValue?: number;
    magnitudeUnit?: string;
    date: string;
    type: string;
    coordinates: number[];
  }>;
}

interface EONETResponse {
  events: EONETEvent[];
}

/**
 * Fetch natural disaster events from NASA EONET API
 * API Docs: https://eonet.gsfc.nasa.gov/docs/v3
 */
async function fetchEONETEvents(
  locations: Array<{ latitude: number; longitude: number; name: string }>,
  lookbackHours: number
): Promise<Array<z.infer<typeof WeatherEventSchema>>> {
  const events: Array<z.infer<typeof WeatherEventSchema>> = [];

  try {
    const startDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const response = await fetch(
      `https://eonet.gsfc.nasa.gov/api/v3/events?start=${startDate.toISOString().split('T')[0]}&status=open`,
      {
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!response.ok) {
      console.warn(`[EONET] API error: ${response.status}`);
      return events;
    }

    const data = await response.json() as EONETResponse;

    if (!data.events || !Array.isArray(data.events)) {
      return events;
    }

    console.log(`[EONET] Fetched ${data.events.length} global events`);

    // Filter events by proximity to monitored locations
    const proximityRadiusKm = 500; // Events within 500km of monitored locations

    for (const event of data.events) {
      if (!event.geometry || event.geometry.length === 0) continue;

      // Get the most recent geometry point
      const latestGeometry = event.geometry[event.geometry.length - 1];
      const [eventLon, eventLat] = latestGeometry.coordinates;

      // Check if event is near any monitored location
      let nearestLocation: { latitude: number; longitude: number; name: string } | null = null;
      let minDistance = Infinity;

      for (const location of locations) {
        const distance = calculateDistance(location.latitude, location.longitude, eventLat, eventLon);
        if (distance < minDistance) {
          minDistance = distance;
          nearestLocation = location;
        }
      }

      if (minDistance > proximityRadiusKm || !nearestLocation) continue;

      const eventType = classifyEONETEventType(event.categories);
      const severity = calculateEONETSeverity(event, latestGeometry.magnitudeValue);

      events.push({
        event_id: `eonet-${event.id}`,
        event_type: eventType,
        title: event.title,
        description: event.description || `${event.title} detected ${Math.round(minDistance)}km from ${nearestLocation.name}`,
        severity,
        location: {
          name: event.title,
          latitude: eventLat,
          longitude: eventLon,
          affected_radius_km: latestGeometry.magnitudeValue
        },
        start_time: latestGeometry.date,
        end_time: event.closed,
        source: 'EONET',
        raw_data: { categories: event.categories, link: event.link }
      });
    }

    console.log(`[EONET] ${events.length} events within range of monitored locations`);
  } catch (err) {
    console.error(`[EONET] Error fetching events:`, err);
  }

  return events;
}

function classifyEONETEventType(categories: Array<{ id: string; title: string }>): string {
  const categoryIds = categories.map(c => c.id);

  if (categoryIds.includes('wildfires')) return 'wildfire';
  if (categoryIds.includes('volcanoes')) return 'volcanic';
  if (categoryIds.includes('earthquakes')) return 'earthquake';
  if (categoryIds.includes('floods')) return 'flood';
  if (categoryIds.includes('severeStorms')) return 'severe_storm';
  if (categoryIds.includes('seaLakeIce')) return 'ice_event';
  if (categoryIds.includes('landslides')) return 'landslide';
  if (categoryIds.includes('dustHaze')) return 'dust_storm';

  return 'natural_disaster';
}

function calculateEONETSeverity(event: EONETEvent, magnitude?: number): number {
  // Base severity on event category
  const categoryIds = event.categories.map(c => c.id);
  let baseSeverity = 0.5;

  if (categoryIds.includes('volcanoes')) baseSeverity = 0.9;
  else if (categoryIds.includes('earthquakes')) baseSeverity = 0.8;
  else if (categoryIds.includes('wildfires')) baseSeverity = 0.7;
  else if (categoryIds.includes('floods')) baseSeverity = 0.7;
  else if (categoryIds.includes('severeStorms')) baseSeverity = 0.6;

  // Adjust based on magnitude if available
  if (magnitude) {
    // For earthquakes, magnitude > 6 is significant
    if (categoryIds.includes('earthquakes') && magnitude > 6) {
      baseSeverity = Math.min(0.95, baseSeverity + 0.1 * (magnitude - 6));
    }
    // For wildfires, larger area = higher severity
    if (categoryIds.includes('wildfires') && magnitude > 1000) {
      baseSeverity = Math.min(0.95, baseSeverity + 0.1);
    }
  }

  return Math.min(1.0, baseSeverity);
}

// ============================================================================
// Shared Utility Functions
// ============================================================================

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
