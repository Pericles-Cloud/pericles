/**
 * BOL trial adapter — context sync service.
 *
 * Seeds a tenant's `OrganizationContext` from public bill-of-lading data so the
 * Atlas map renders WITHOUT a live ERP. Mirrors the SAP sync-service exactly
 * (fetch → transform → validate → upsert OrganizationContext), so trial data
 * flows through the identical downstream Atlas/monitoring path.
 *
 * Tenant isolation: every read/write is scoped by `organizationId`, the org is
 * verified to exist before any write, and the geocode cache is namespaced per
 * organization. See pericles-erp-adapter, pericles-tenant-isolation.
 *
 * Usage:
 * ```typescript
 * import { syncBolContextForOrganization } from './sync-service.js';
 * await syncBolContextForOrganization(orgId, { input: { companySlugs: ['allient'] } });
 * ```
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { kvGet, kvSet } from '../../monitoring/queue-client.js';
import {
  validateOrganizationContext,
  type OrganizationContextData,
} from '../sap/transformer.js';
import { fetchBolRows, type ApifyBolClientConfig } from './client.js';
import { createGoogleGeocoder } from './geocode.js';
import { transformBolDataToOrganizationContext } from './transformer.js';
import type { BolRow, Geocoder, BolTransformOptions } from './types.js';

/** Cache geocode results for 90 days — places don't move; saves re-billing. */
const GEOCODE_TTL_SECONDS = 90 * 24 * 60 * 60;

const defaultPrisma = new PrismaClient();

export interface SyncBolOptions {
  /** Apify actor input (e.g. `{ companySlugs: ['allient'] }`). Required unless `rows` is given. */
  input?: Record<string, unknown>;
  /** Apify client config (token, actorId). Falls back to env. */
  clientConfig?: ApifyBolClientConfig;
  /** Pre-fetched rows — bypasses the network (offline fixtures, tests). */
  rows?: BolRow[];
  /** Geocoder override — defaults to a KV-cached Google geocoder scoped to the org. */
  geocoder?: Geocoder;
  /** Transform tuning (critical thresholds, ocean speed, etc.). */
  transformOptions?: BolTransformOptions;
  /** Preview only — compute the context but do not write it. */
  dryRun?: boolean;
  verbose?: boolean;
  /** Injectable client (tests). Defaults to a module-level PrismaClient. */
  prisma?: PrismaClient;
}

export interface SyncBolResult {
  success: boolean;
  organization_id: string;
  records_synced: {
    plants: number;
    warehouses: number;
    suppliers: number;
    shipping_lanes: number;
  };
  rows_fetched: number;
  sync_timestamp: string;
  errors?: string[];
}

/**
 * Build the default geocoder: Google Geocoding cached in KeyValueStore under
 * the `geocode` namespace, scoped to this organization so cache entries never
 * cross tenants. Keyless installs degrade to the offline gazetteer in geocode.ts.
 */
function buildDefaultGeocoder(organizationId: string): Geocoder {
  const kv = {
    async get(key: string, namespace?: string): Promise<string | null> {
      const value = await kvGet(key, { namespace, organizationId });
      if (value === null) return null;
      return typeof value === 'string' ? value : JSON.stringify(value);
    },
    async set(key: string, value: string, namespace?: string): Promise<void> {
      await kvSet(key, value, {
        namespace,
        organizationId,
        ttlSeconds: GEOCODE_TTL_SECONDS,
      });
    },
  };
  return createGoogleGeocoder({ kv });
}

/**
 * Sync BOL-derived supply-chain context for a single organization.
 */
export async function syncBolContextForOrganization(
  organizationId: string,
  options: SyncBolOptions = {}
): Promise<SyncBolResult> {
  const {
    input,
    clientConfig,
    rows: providedRows,
    geocoder,
    transformOptions,
    dryRun = false,
    verbose = false,
    prisma = defaultPrisma,
  } = options;

  const emptyCounts = { plants: 0, warehouses: 0, suppliers: 0, shipping_lanes: 0 };
  const log = (msg: string): void => {
    if (verbose) console.log(`[BOL Sync] ${msg}`);
  };

  try {
    if (!organizationId) {
      throw new Error('organizationId is required');
    }

    // 1. Verify the organization exists (tenant isolation: never write to an
    //    org that doesn't exist or wasn't resolved by the caller).
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    if (!organization) {
      throw new Error(`Organization ${organizationId} not found`);
    }
    log(`Organization: ${organization.name}`);

    // 2. Obtain BOL rows — injected (offline/tests) or pulled from Apify.
    let rows = providedRows;
    if (!rows) {
      if (!input) {
        throw new Error('Either `rows` or `input` must be provided');
      }
      log('Fetching BOL rows from Apify...');
      rows = await fetchBolRows(input, clientConfig);
    }
    log(`Rows: ${rows.length}`);

    // 3. Transform to the shared OrganizationContextData shape (geocoding lanes).
    const geocode = geocoder ?? buildDefaultGeocoder(organizationId);
    const contextData: OrganizationContextData =
      await transformBolDataToOrganizationContext(rows, geocode, transformOptions);

    // 4. Validate (coordinates present, etc.) — warn, don't fail the run.
    const validation = validateOrganizationContext(contextData);
    if (!validation.valid) {
      console.warn('[BOL Sync] Validation warnings:', validation.errors);
    }

    const counts = {
      plants: contextData.plants.length,
      warehouses: contextData.warehouses.length,
      suppliers: contextData.suppliers.length,
      shipping_lanes: contextData.shipping_lanes.length,
    };

    // 5. Upsert OrganizationContext (skip writes on dry run).
    if (dryRun) {
      log(`DRY RUN — would sync: ${JSON.stringify(counts)}`);
    } else {
      await persistContext(prisma, organizationId, contextData);
      log('OrganizationContext upserted');
    }

    return {
      success: true,
      organization_id: organizationId,
      records_synced: counts,
      rows_fetched: rows.length,
      sync_timestamp: new Date().toISOString(),
      errors: validation.valid ? undefined : validation.errors,
    };
  } catch (error) {
    console.error(`[BOL Sync] Failed for organization ${organizationId}:`, error);
    return {
      success: false,
      organization_id: organizationId,
      records_synced: emptyCounts,
      rows_fetched: 0,
      sync_timestamp: new Date().toISOString(),
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/** Upsert the OrganizationContext row from transformed BOL data. */
async function persistContext(
  prisma: PrismaClient,
  organizationId: string,
  contextData: OrganizationContextData
): Promise<void> {
  const data = {
    plants: contextData.plants as unknown as Prisma.InputJsonValue,
    warehouses: contextData.warehouses as unknown as Prisma.InputJsonValue,
    suppliers: contextData.suppliers as unknown as Prisma.InputJsonValue,
    shipping_lanes: contextData.shipping_lanes as unknown as Prisma.InputJsonValue,
    monitored_risk_types: contextData.risk_preferences.monitored_risk_types,
    geographic_radius_km: contextData.risk_preferences.geographic_radius_km,
    severity_threshold: contextData.risk_preferences.severity_threshold,
    last_erp_sync: new Date(),
  };

  await prisma.organizationContext.upsert({
    where: { organization_id: organizationId },
    create: { organization_id: organizationId, ...data },
    update: data,
  });
}
