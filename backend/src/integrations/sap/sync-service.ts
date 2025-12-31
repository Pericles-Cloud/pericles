/**
 * SAP S/4HANA ERP Sync Service
 *
 * This service synchronizes supply chain data from SAP S/4HANA Cloud
 * into the Pericles OrganizationContext table for risk monitoring.
 *
 * Sync Frequency: Every 30 minutes (configurable)
 * Data Sources: Business Partners, Plants, Materials, Shipping Lanes
 *
 * Usage:
 * ```typescript
 * import { syncSAPDataForOrganization } from './sync-service';
 * await syncSAPDataForOrganization('550e8400-e29b-41d4-a716-446655440000');
 * ```
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { sapClient } from './client';
import { transformSAPDataToOrganizationContext, validateOrganizationContext } from './transformer';
import type { OrganizationContextData } from './transformer';

const prisma = new PrismaClient();

/**
 * Sync SAP data for a single organization
 */
export async function syncSAPDataForOrganization(
  organizationId: string,
  options: {
    dryRun?: boolean;
    verbose?: boolean;
  } = {}
): Promise<{
  success: boolean;
  organization_id: string;
  records_synced: {
    plants: number;
    warehouses: number;
    suppliers: number;
    shipping_lanes: number;
  };
  sync_timestamp: string;
  errors?: string[];
}> {
  const startTime = Date.now();
  const { dryRun = false, verbose = false } = options;

  if (verbose) {
    console.log(`[SAP Sync] Starting sync for organization: ${organizationId}`);
  }

  try {
    // 1. Verify organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });

    if (!organization) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    if (verbose) {
      console.log(`[SAP Sync] Found organization: ${organization.name}`);
    }

    // 2. Fetch data from SAP S/4HANA
    if (verbose) {
      console.log(`[SAP Sync] Fetching data from SAP S/4HANA Cloud...`);
    }

    const [suppliersResponse, plantsResponse, shippingLanesResponse] = await Promise.all([
      sapClient.getBusinessPartners({
        $expand: 'to_BusinessPartnerAddress,to_Supplier',
        $filter: "to_Supplier ne null",
      }),
      sapClient.getPlants(),
      sapClient.getShippingLanes(),
    ]);

    if (verbose) {
      console.log(
        `[SAP Sync] Fetched ${suppliersResponse.d.results.length} suppliers, ` +
          `${plantsResponse.d.results.length} plants, ` +
          `${shippingLanesResponse.d.results.length} shipping lanes`
      );
    }

    // 3. Transform SAP data to OrganizationContext format
    const contextData: OrganizationContextData = transformSAPDataToOrganizationContext(
      suppliersResponse,
      plantsResponse,
      shippingLanesResponse
    );

    // 4. Validate transformed data
    const validation = validateOrganizationContext(contextData);
    if (!validation.valid) {
      console.warn(`[SAP Sync] Validation warnings:`, validation.errors);
    }

    // 5. Update or create OrganizationContext
    if (!dryRun) {
      const existingContext = await prisma.organizationContext.findUnique({
        where: { organization_id: organizationId },
      });

      if (existingContext) {
        // Update existing context
        await prisma.organizationContext.update({
          where: { organization_id: organizationId },
          data: {
            plants: contextData.plants as Prisma.JsonValue,
            warehouses: contextData.warehouses as Prisma.JsonValue,
            suppliers: contextData.suppliers as Prisma.JsonValue,
            shipping_lanes: contextData.shipping_lanes as Prisma.JsonValue,
            monitored_risk_types: contextData.risk_preferences.monitored_risk_types,
            geographic_radius_km: contextData.risk_preferences.geographic_radius_km,
            severity_threshold: contextData.risk_preferences.severity_threshold,
            last_erp_sync: new Date(),
          },
        });

        if (verbose) {
          console.log(`[SAP Sync] Updated existing OrganizationContext`);
        }
      } else {
        // Create new context
        await prisma.organizationContext.create({
          data: {
            organization_id: organizationId,
            plants: contextData.plants as Prisma.JsonValue,
            warehouses: contextData.warehouses as Prisma.JsonValue,
            suppliers: contextData.suppliers as Prisma.JsonValue,
            shipping_lanes: contextData.shipping_lanes as Prisma.JsonValue,
            monitored_risk_types: contextData.risk_preferences.monitored_risk_types,
            geographic_radius_km: contextData.risk_preferences.geographic_radius_km,
            severity_threshold: contextData.risk_preferences.severity_threshold,
            last_erp_sync: new Date(),
          },
        });

        if (verbose) {
          console.log(`[SAP Sync] Created new OrganizationContext`);
        }
      }
    } else {
      console.log(`[SAP Sync] DRY RUN - Would have synced:`, {
        plants: contextData.plants.length,
        warehouses: contextData.warehouses.length,
        suppliers: contextData.suppliers.length,
        shipping_lanes: contextData.shipping_lanes.length,
      });
    }

    const duration = Date.now() - startTime;

    if (verbose) {
      console.log(`[SAP Sync] Completed in ${duration}ms`);
    }

    return {
      success: true,
      organization_id: organizationId,
      records_synced: {
        plants: contextData.plants.length,
        warehouses: contextData.warehouses.length,
        suppliers: contextData.suppliers.length,
        shipping_lanes: contextData.shipping_lanes.length,
      },
      sync_timestamp: new Date().toISOString(),
      errors: validation.valid ? undefined : validation.errors,
    };
  } catch (error) {
    console.error(`[SAP Sync] Failed for organization ${organizationId}:`, error);

    return {
      success: false,
      organization_id: organizationId,
      records_synced: {
        plants: 0,
        warehouses: 0,
        suppliers: 0,
        shipping_lanes: 0,
      },
      sync_timestamp: new Date().toISOString(),
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Sync SAP data for all active organizations
 */
export async function syncSAPDataForAllOrganizations(
  options: {
    dryRun?: boolean;
    verbose?: boolean;
    concurrency?: number;
  } = {}
): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: Array<Awaited<ReturnType<typeof syncSAPDataForOrganization>>>;
}> {
  const { concurrency = 3, verbose = false } = options;

  if (verbose) {
    console.log(`[SAP Sync] Starting sync for all organizations (concurrency: ${concurrency})`);
  }

  try {
    // Get all organizations
    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true },
    });

    if (verbose) {
      console.log(`[SAP Sync] Found ${organizations.length} organizations`);
    }

    // Process in batches to avoid overwhelming SAP API
    const results: Array<Awaited<ReturnType<typeof syncSAPDataForOrganization>>> = [];
    for (let i = 0; i < organizations.length; i += concurrency) {
      const batch = organizations.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map((org) =>
          syncSAPDataForOrganization(org.id, options).catch((error: unknown) => ({
            success: false,
            organization_id: org.id,
            records_synced: { plants: 0, warehouses: 0, suppliers: 0, shipping_lanes: 0 },
            sync_timestamp: new Date().toISOString(),
            errors: [error instanceof Error ? error.message : String(error)],
          }))
        )
      );

      results.push(...batchResults);

      if (verbose) {
        console.log(`[SAP Sync] Completed batch ${Math.floor(i / concurrency) + 1}`);
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (verbose) {
      console.log(`[SAP Sync] Completed: ${successful} successful, ${failed} failed`);
    }

    return {
      total: organizations.length,
      successful,
      failed,
      results,
    };
  } catch (error) {
    console.error(`[SAP Sync] Failed to sync all organizations:`, error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Test SAP connection health
 */
export async function testSAPConnection(): Promise<{
  status: 'ok' | 'error';
  mode: string;
  timestamp: string;
  error?: string;
}> {
  try {
    const health = await sapClient.healthCheck();
    return health;
  } catch (error) {
    return {
      status: 'error',
      mode: 'unknown',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
