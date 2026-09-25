import { z } from 'zod';
import { getPrismaClient } from './db-client.js';
import { resolveSettingsOwnership } from '../organizations/settings-resolution.js';

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

  // AI Model Settings (from OrganizationSettings)
  ai: z.object({
    provider: z.string().default('openai'),
    modelName: z.string().default('gpt-4o-mini'),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().int().min(1).max(128000).default(4096),
  }).default({
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 4096,
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
  ai: {
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 4096,
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

  // Merge database configuration from OrganizationSettings (new) and OrganizationContext (legacy)
  try {
    const prisma = getPrismaClient();

    // Settings and monitoring-config fields belong to the settings OWNER up the
    // parent chain (inherited children read the parent's live values).
    // `config.organizationId` below stays the REQUESTED org — events are
    // attributed to the org whose cycle ran.
    const settingsOrgId = (await resolveSettingsOwnership(organizationId, prisma)).owner.id;

    // First, try to load from OrganizationSettings (new, preferred)
    const orgSettings = await prisma.organizationSettings.findUnique({
      where: { organization_id: settingsOrgId },
      select: {
        monitoring_polling_interval_ms: true,
        monitoring_enabled_sources: true,
        ai_model_provider: true,
        ai_model_name: true,
        ai_model_temperature: true,
        ai_max_tokens: true,
      },
    });

    if (orgSettings) {
      config.pollingIntervalMs = orgSettings.monitoring_polling_interval_ms;

      // Parse enabled sources from JSON
      const enabledSources = orgSettings.monitoring_enabled_sources as Record<string, boolean> | null;
      if (enabledSources && typeof enabledSources === 'object') {
        config.enabledSources = {
          weather: enabledSources.weather ?? true,
          political: enabledSources.political ?? true,
          cybersecurity: enabledSources.cybersecurity ?? true,
          economic: enabledSources.economic ?? true,
          news: enabledSources.news ?? true,
          maritime: enabledSources.maritime ?? true,
          labor: enabledSources.labor ?? true,
          regulatory: enabledSources.regulatory ?? true,
          pandemic: enabledSources.pandemic ?? true,
          geopolitical: enabledSources.geopolitical ?? true,
        };
      }

      // Load AI model settings
      if (orgSettings.ai_model_provider && orgSettings.ai_model_name) {
        config.ai = {
          provider: orgSettings.ai_model_provider,
          modelName: orgSettings.ai_model_name,
          temperature: orgSettings.ai_model_temperature ?? 0.7,
          maxTokens: orgSettings.ai_max_tokens ?? 4096,
        };
      }
    }

    // Also load from OrganizationContext for geographic/risk filter settings
    const orgContext = await prisma.organizationContext.findUnique({
      where: { organization_id: settingsOrgId },
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
      ai: runtimeOverrides.ai
        ? { ...config.ai, ...runtimeOverrides.ai }
        : config.ai,
    };
  }

  // Set organization_id (immutable)
  config.organizationId = organizationId;

  // Validate final configuration
  return MonitoringConfigSchema.parse(config);
}

/**
 * Resolved model for a monitoring cycle: either a Mastra model-router string
 * ('openai/gpt-4o-mini', 'openrouter/anthropic/claude-3.5-sonnet') or a
 * config object carrying the org-scoped API key. The config-object form is
 * required for per-org keys — magic strings resolve the key from process.env,
 * which only holds the platform/global key.
 */
export type ResolvedModel =
  | `${string}/${string}`
  | { id: `${string}/${string}`; apiKey: string };

/**
 * Resolve the API key for an organization's AI provider.
 *
 * Order: org-scoped Secrets Manager entry (`org.<provider>_api_key`) first,
 * then the platform-level environment variable. Mirrors the Event Q&A
 * resolution in auth-server.ts — the monitoring cron must honor the same
 * per-org keys, since tenants can bring their own provider credentials.
 *
 * @returns the key, or null when neither source has one
 */
export async function resolveAiApiKey(organizationId: string, provider: string): Promise<string | null> {
  const secretName = `${provider}_api_key`;
  try {
    const { getOrgSecret } = await import('../secrets/index.js');
    const secretKey = await getOrgSecret(organizationId, secretName, false);
    if (secretKey) return secretKey;
  } catch {
    // Secrets backend unavailable/unconfigured — fall through to env
  }
  return process.env[`${provider.toUpperCase()}_API_KEY`] || null;
}

/**
 * Resolve the Mastra model for a monitoring cycle from the org's AI settings.
 *
 * OpenRouter models use the format `openrouter/<provider>/<model-id>` (e.g. 'openrouter/anthropic/claude-3.5-sonnet').
 * OpenAI models use `openai/<model-id>`.
 *
 * The org's API key is attached as a config object, so a tenant bringing its
 * own OpenRouter/OpenAI key (Settings → Secrets) is billed to their account,
 * not the platform env key. Falls back to the platform env key when no org
 * secret exists.
 *
 * @returns ResolvedModel usable as Mastra's model (string or {id, apiKey})
 * @throws Error when no key is available for the org's selected provider
 */
export async function resolveModel(config: MonitoringConfig): Promise<ResolvedModel> {
  const { provider, modelName } = config.ai;

  const apiKey = await resolveAiApiKey(config.organizationId, provider);
  if (!apiKey) {
    const envName = `${provider.toUpperCase()}_API_KEY`;
    const errorMsg = `AI provider "${provider}" selected for org ${config.organizationId} but no API key is configured. Add "${provider}_api_key" in Settings > Secrets or set the ${envName} environment variable and redeploy.`;
    console.error(`[Config] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const id: `${string}/${string}` =
    provider === 'openrouter' ? `openrouter/${modelName}` : `${provider}/${modelName}`;

  if (provider === 'openrouter' && !modelName.includes('/')) {
    const warningMsg = `OpenRouter model name "${modelName}" does not include a provider prefix (e.g., "anthropic/claude-3.5-sonnet"). This may cause model resolution to fail. Please use the full model ID from OpenRouter (e.g., "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash").`;
    console.warn(`[Config] ${warningMsg}`);
  }

  return { id, apiKey };
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
