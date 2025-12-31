import { z } from 'zod';
import { getPrismaClient } from './db-client';

/**
 * Monitoring Configuration Management
 *
 * Configuration Precedence (highest to lowest):
 * 1. Runtime overrides (passed to loadMonitoringConfig)
 * 2. Database configuration (OrganizationContext table)
 * 3. Default values
 *
 * CRITICAL: organization_id is IMMUTABLE once set
 */

// ============================================================================
// Configuration Schema
// ============================================================================

export const MonitoringConfigSchema = z.object({
  // Organization (IMMUTABLE)
  organizationId: z.string().uuid(),

  // Polling Configuration
  pollingIntervalMs: z.number().int().min(1000).max(300000).default(15000),

  // Data Source Toggles
  enabledSources: z.object({
    weather: z.boolean(),
    political: z.boolean(),
    cybersecurity: z.boolean(),
    economic: z.boolean(),
    news: z.boolean(),
    maritime: z.boolean(),
    labor: z.boolean(),
    regulatory: z.boolean(),
    pandemic: z.boolean(),
    geopolitical: z.boolean(),
  }).default({
    weather: true,
    political: true,
    cybersecurity: true,
    economic: true,
    news: true,
    maritime: true,
    labor: true,
    regulatory: true,
    pandemic: true,
    geopolitical: true,
  }),

  // Geographic Filtering
  geographicFilter: z.object({
    radiusKm: z.number().min(1).max(5000),
    strictMode: z.boolean(), // If true, reject events outside radius entirely
  }).default({
    radiusKm: 100,
    strictMode: false,
  }),

  // Risk Filtering
  riskFilter: z.object({
    severityThreshold: z.number().min(0).max(1),
    confidenceThreshold: z.number().min(0).max(1),
    monitoredRiskTypes: z.array(z.string()), // Empty = monitor all types
  }).default({
    severityThreshold: 0.5,
    confidenceThreshold: 0.3,
    monitoredRiskTypes: [],
  }),

  // Deduplication
  deduplication: z.object({
    lookbackWindowHours: z.number().int().min(1).max(720), // 7 days
    enabled: z.boolean(),
  }).default({
    lookbackWindowHours: 168,
    enabled: true,
  }),

  // Error Handling
  errorHandling: z.object({
    maxBackoffMs: z.number().int().min(1000).max(300000), // 60 seconds
    maxRetries: z.number().int().min(0).max(10),
    stopOnFatalError: z.boolean(),
  }).default({
    maxBackoffMs: 60000,
    maxRetries: 3,
    stopOnFatalError: true,
  }),

  // Observability
  observability: z.object({
    enableMetrics: z.boolean(),
    enableAuditLog: z.boolean(),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  }).default({
    enableMetrics: true,
    enableAuditLog: true,
    logLevel: 'info' as const,
  }),
});

export type MonitoringConfig = z.infer<typeof MonitoringConfigSchema>;

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Partial<MonitoringConfig> = {
  pollingIntervalMs: 15000, // 15 seconds
  enabledSources: {
    weather: true,
    political: true,
    cybersecurity: true,
    economic: true,
    news: true,
    maritime: true,
    labor: true,
    regulatory: true,
    pandemic: true,
    geopolitical: true,
  },
  geographicFilter: {
    radiusKm: 100,
    strictMode: false,
  },
  riskFilter: {
    severityThreshold: 0.5,
    confidenceThreshold: 0.3,
    monitoredRiskTypes: [],
  },
  deduplication: {
    lookbackWindowHours: 168,
    enabled: true,
  },
  errorHandling: {
    maxBackoffMs: 60000,
    maxRetries: 3,
    stopOnFatalError: true,
  },
  observability: {
    enableMetrics: true,
    enableAuditLog: true,
    logLevel: 'info',
  },
};

// ============================================================================
// Configuration Loader
// ============================================================================

/**
 * Load monitoring configuration with precedence: runtime > database > defaults
 *
 * @param organizationId - Organization UUID (required, immutable)
 * @param runtimeOverrides - Optional runtime configuration overrides
 * @returns Validated monitoring configuration
 */
export async function loadMonitoringConfig(
  organizationId: string,
  runtimeOverrides?: Partial<MonitoringConfig>
): Promise<MonitoringConfig> {
  // Validate organization_id
  if (!organizationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    throw new Error(`Invalid organization_id: ${organizationId}`);
  }

  // Start with defaults
  let config: Partial<MonitoringConfig> = { ...DEFAULT_CONFIG };

  // Merge database configuration
  try {
    const prisma = getPrismaClient();
    const orgContext = await prisma.organizationContext.findUnique({
      where: { organization_id: organizationId },
      select: {
        geographic_radius_km: true,
        severity_threshold: true,
        monitored_risk_types: true,
      },
    });

    if (orgContext) {
      config.geographicFilter = {
        radiusKm: orgContext.geographic_radius_km,
        strictMode: config.geographicFilter?.strictMode || false,
      };
      config.riskFilter = {
        severityThreshold: orgContext.severity_threshold,
        confidenceThreshold: config.riskFilter?.confidenceThreshold || 0.3,
        monitoredRiskTypes: orgContext.monitored_risk_types || [],
      };
    }
  } catch (error) {
    console.warn('[Config] Failed to load database config, using defaults:', error);
  }

  // Merge runtime overrides
  if (runtimeOverrides) {
    config = {
      ...config,
      ...runtimeOverrides,
      // Deep merge nested objects (only if they exist in overrides)
      enabledSources: runtimeOverrides.enabledSources
        ? { ...config.enabledSources, ...runtimeOverrides.enabledSources }
        : config.enabledSources,
      geographicFilter: runtimeOverrides.geographicFilter
        ? { ...config.geographicFilter, ...runtimeOverrides.geographicFilter }
        : config.geographicFilter,
      riskFilter: runtimeOverrides.riskFilter
        ? { ...config.riskFilter, ...runtimeOverrides.riskFilter }
        : config.riskFilter,
      deduplication: runtimeOverrides.deduplication
        ? { ...config.deduplication, ...runtimeOverrides.deduplication }
        : config.deduplication,
      errorHandling: runtimeOverrides.errorHandling
        ? { ...config.errorHandling, ...runtimeOverrides.errorHandling }
        : config.errorHandling,
      observability: runtimeOverrides.observability
        ? { ...config.observability, ...runtimeOverrides.observability }
        : config.observability,
    };
  }

  // Set organization_id (immutable)
  config.organizationId = organizationId;

  // Validate final configuration
  return MonitoringConfigSchema.parse(config);
}

/**
 * Environment-based configuration overrides
 */
export function getEnvironmentOverrides(): Partial<MonitoringConfig> {
  const overrides: Partial<MonitoringConfig> = {};

  if (process.env.MONITORING_DEFAULT_INTERVAL_MS) {
    overrides.pollingIntervalMs = parseInt(process.env.MONITORING_DEFAULT_INTERVAL_MS, 10);
  }

  if (process.env.LOG_LEVEL) {
    overrides.observability = {
      logLevel: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error',
      enableMetrics: true,
      enableAuditLog: true,
    };
  }

  return overrides;
}
