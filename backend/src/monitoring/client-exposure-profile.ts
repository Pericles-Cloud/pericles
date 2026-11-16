/**
 * Client Exposure Profile Service
 *
 * Syncs data from ERP and Organizational Memory into the ClientExposureProfile table.
 * The Client Monitoring Agent uses this profile to evaluate exposure pathways.
 *
 * Sync sources:
 * - ERP (SAP adapter): facilities, suppliers, products, logistics
 * - Shipment tracking: shipments in transit
 * - Organizational Memory: strategic priorities, key account commitments, stated concerns
 */

import { getPrismaClient } from './db-client.js';
import { logger } from './logger.js';

export interface SyncResult {
  organizationId: string;
  profileVersion: number;
  facilitiesSynced: number;
  suppliersSynced: number;
  productsSynced: number;
  shipmentsSynced: number;
  strategicSynced: boolean;
  errors: string[];
}

/** Profile fields whose change makes a new profile version. */
const PROFILE_CONTENT_FIELDS = [
  'own_facilities',
  'suppliers',
  'products',
  'logistics',
  'shipments_in_transit',
  'strategic_priorities',
  'key_account_commitments',
  'stated_concerns',
] as const;

/** JSON with object keys sorted, so jsonb key reordering is not a "change". */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}

/**
 * Sync Client Exposure Profile from all sources
 */
export async function syncClientExposureProfile(organizationId: string): Promise<SyncResult> {
  const prisma = getPrismaClient();
  const errors: string[] = [];

  let facilitiesSynced = 0;
  let suppliersSynced = 0;
  let productsSynced = 0;
  let shipmentsSynced = 0;
  let strategicSynced = false;

  logger.info({ organizationId }, '[ProfileSync] Starting Client Exposure Profile sync');

  try {
    // Get or create profile
    let profile = await prisma.clientExposureProfile.findUnique({
      where: { organization_id: organizationId },
    });

    if (!profile) {
      profile = await prisma.clientExposureProfile.create({
        data: {
          organization_id: organizationId,
          profile_version: 1,
        },
      });
      logger.info({ organizationId, profileId: profile.id }, '[ProfileSync] Created new profile');
    }

    // Sync from ERP (facilities, suppliers, products, logistics)
    try {
      const erpData = await syncFromERP(organizationId);
      facilitiesSynced = erpData.facilities;
      suppliersSynced = erpData.suppliers;
      productsSynced = erpData.products;

      await prisma.clientExposureProfile.update({
        where: { id: profile.id },
        data: {
          own_facilities: erpData.ownFacilities,
          suppliers: erpData.suppliersData,
          products: erpData.productsData,
          logistics: erpData.logisticsData,
          last_erp_sync: new Date(),
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`ERP sync failed: ${msg}`);
      logger.error({ error, organizationId }, '[ProfileSync] ERP sync failed');
    }

    // Sync shipments in transit
    try {
      const shipmentsData = await syncShipmentsInTransit(organizationId);
      shipmentsSynced = shipmentsData.length;

      await prisma.clientExposureProfile.update({
        where: { organization_id: organizationId },
        data: {
          shipments_in_transit: shipmentsData,
          last_shipment_sync: new Date(),
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Shipment sync failed: ${msg}`);
      logger.error({ error, organizationId }, '[ProfileSync] Shipment sync failed');
    }

    // Sync from Organizational Memory
    try {
      const orgMemoryData = await syncFromOrgMemory(organizationId);
      strategicSynced = true;

      await prisma.clientExposureProfile.update({
        where: { organization_id: organizationId },
        data: {
          strategic_priorities: orgMemoryData.strategicPriorities as any,
          key_account_commitments: orgMemoryData.keyAccountCommitments as any,
          stated_concerns: orgMemoryData.statedConcerns as any,
          last_org_memory_sync: new Date(),
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Org Memory sync failed: ${msg}`);
      logger.error({ error, organizationId }, '[ProfileSync] Org Memory sync failed');
    }

    // Bump the version only when exposure-relevant content changed, so
    // profile_snapshot_ref identifies real profile states (an hourly refresh
    // of unchanged data does not mint a new version).
    const before = profile;
    const after = await prisma.clientExposureProfile.findUniqueOrThrow({ where: { organization_id: organizationId } });
    const changed = PROFILE_CONTENT_FIELDS.some(
      (field) => canonicalJson(before[field]) !== canonicalJson(after[field])
    );
    const updatedProfile = changed
      ? await prisma.clientExposureProfile.update({
          where: { organization_id: organizationId },
          data: { profile_version: { increment: 1 }, updated_at: new Date() },
        })
      : after;

    const result: SyncResult = {
      organizationId,
      profileVersion: updatedProfile.profile_version,
      facilitiesSynced,
      suppliersSynced,
      productsSynced,
      shipmentsSynced,
      strategicSynced,
      errors,
    };

    logger.info(result, '[ProfileSync] Client Exposure Profile sync complete');

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error, organizationId }, '[ProfileSync] Profile sync failed');
    throw error;
  }
}

/**
 * Sync structural data from ERP
 */
async function syncFromERP(organizationId: string): Promise<{
  facilities: number;
  suppliers: number;
  products: number;
  ownFacilities: any[];
  suppliersData: any[];
  productsData: any[];
  logisticsData: any;
}> {
  const prisma = getPrismaClient();

  // Get suppliers from Supplier table (ordered, so an unchanged dataset
  // produces identical profile content and the version is not bumped).
  const suppliers = await prisma.supplier.findMany({
    where: { organization_id: organizationId },
    orderBy: { id: 'asc' },
  });

  const suppliersData: Array<Record<string, unknown>> = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    latitude: s.latitude,
    longitude: s.longitude,
    country_iso: s.country_code,
    supplies: s.hs_codes.map((hs) => ({ hs_code: hs })),
    spend_pct: null, // Would come from ERP spend data
    single_source: false, // Would come from ERP analysis
  }));

  // Get shipments to derive logistics data
  const shipments = await prisma.shipment.findMany({
    where: { organization_id: organizationId },
    take: 1000, // Limit for performance
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
  });

  // Derive carriers from shipments
  const carrierIds = [...new Set(shipments.map((s) => s.carrier_id).filter(Boolean))] as string[];
  const carriers = carrierIds.length > 0
    ? await prisma.carrier.findMany({ where: { id: { in: carrierIds } }, orderBy: { id: 'asc' } })
    : [];

  const carriersData = carriers.map((c) => ({
    id: c.id,
    name: c.name,
    scac_code: c.scac_code,
  }));

  // Derive routes from shipments
  const routeSet = new Set<string>();
  const routesData: any[] = [];
  for (const s of shipments) {
    const routeKey = `${s.departure_port_code || s.departure_port}-${s.destination_port_code || s.destination_port}`;
    if (!routeSet.has(routeKey)) {
      routeSet.add(routeKey);
      routesData.push({
        origin: s.departure_port || s.departure_port_code || 'Unknown',
        destination: s.destination_port || s.destination_port_code || 'Unknown',
        mode: s.mode_of_transport.toLowerCase(),
        ports: [s.departure_port_code, s.destination_port_code].filter(Boolean),
      });
    }
  }

  // Derive products from shipments
  const productMap = new Map<string, any>();
  for (const s of shipments) {
    for (let i = 0; i < s.hs_codes.length; i++) {
      const hsCode = s.hs_codes[i];
      const description = s.hs_code_descriptions[i] || hsCode;
      if (!productMap.has(hsCode)) {
        productMap.set(hsCode, {
          sku: hsCode,
          name: description,
          hs_codes: [hsCode],
        });
      }
    }
  }
  const productsData = Array.from(productMap.values()).sort((a, b) => String(a.sku).localeCompare(String(b.sku)));

  // Own facilities and ERP-only suppliers come from the OrganizationContext
  // rollup, which the SAP and BOL syncs write (plants, warehouses, suppliers).
  const context = await prisma.organizationContext.findUnique({
    where: { organization_id: organizationId },
    select: { plants: true, warehouses: true, suppliers: true },
  });
  const located = (value: unknown): Array<Record<string, any>> => (Array.isArray(value) ? value : []);
  const ownFacilities = [
    ...located(context?.plants).map((p) => ({
      id: p.plant_id,
      name: p.name,
      facility_type: p.plant_type ?? 'plant',
      latitude: p.location?.latitude ?? null,
      longitude: p.location?.longitude ?? null,
      country_iso: p.country ?? null,
    })),
    ...located(context?.warehouses).map((w) => ({
      id: w.warehouse_id,
      name: w.name,
      facility_type: 'warehouse',
      latitude: w.location?.latitude ?? null,
      longitude: w.location?.longitude ?? null,
      country_iso: w.country ?? null,
    })),
  ].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // ERP suppliers not already in the Supplier table (e.g. from SAP).
  const knownSupplierNames = new Set(suppliersData.map((s) => String(s.name).trim().toLowerCase()));
  for (const cs of located(context?.suppliers)) {
    if (knownSupplierNames.has(String(cs.name).trim().toLowerCase())) continue;
    suppliersData.push({
      id: cs.supplier_id,
      name: cs.name,
      latitude: cs.location?.latitude ?? null,
      longitude: cs.location?.longitude ?? null,
      country_iso: cs.country ?? null,
      supplies: [],
      spend_pct: null,
      single_source: false,
      tier: cs.tier ?? 1,
      critical: cs.critical === true,
    });
  }

  return {
    facilities: ownFacilities.length,
    suppliers: suppliersData.length,
    products: productsData.length,
    ownFacilities,
    suppliersData,
    productsData,
    logisticsData: {
      carriers: carriersData,
      routes: routesData,
    },
  };
}

/**
 * Sync shipments in transit
 */
async function syncShipmentsInTransit(organizationId: string): Promise<any[]> {
  const prisma = getPrismaClient();

  // Get active shipments (not yet arrived)
  const shipments = await prisma.shipment.findMany({
    where: {
      organization_id: organizationId,
      OR: [
        { arrival_date: null },
        { arrival_date: { gt: new Date() } },
      ],
    },
    include: {
      supplier: true,
      carrier: true,
    },
    take: 500, // Limit for performance
    orderBy: { id: 'asc' },
  });

  return shipments.map((s) => ({
    id: s.id,
    origin: s.departure_port || s.departure_port_code || 'Unknown',
    destination: s.destination_port || s.destination_port_code || 'Unknown',
    route: s.shipping_route,
    carrier: s.carrier?.name,
    eta: s.estimated_arrival_date?.toISOString() ?? null,
    contents: s.hs_codes.map((hs, i) => ({
      sku: hs,
      qty: s.quantity ?? undefined,
    })),
    departure_port_code: s.departure_port_code,
    destination_port_code: s.destination_port_code,
    vessel_name: s.vessel_name,
    bol_number: s.bol_number,
  }));
}

/**
 * Sync strategic context from Organizational Memory
 */
async function syncFromOrgMemory(organizationId: string): Promise<{
  strategicPriorities: any[] | null;
  keyAccountCommitments: any[] | null;
  statedConcerns: any[] | null;
}> {
  // Import dynamically to avoid circular dependency
  const { getStrategicPriorities, getKeyAccountCommitments, getStatedConcerns } = await import('./org-memory.js');

  const [strategicPriorities, keyAccountCommitments, statedConcerns] = await Promise.all([
    getStrategicPriorities(organizationId),
    getKeyAccountCommitments(organizationId),
    getStatedConcerns(organizationId),
  ]);

  return {
    strategicPriorities: strategicPriorities.length > 0 ? strategicPriorities : null,
    keyAccountCommitments: keyAccountCommitments.length > 0 ? keyAccountCommitments : null,
    statedConcerns: statedConcerns.length > 0 ? statedConcerns : null,
  };
}

/**
 * Trigger back-matching when profile changes
 * Re-scans all active global events against the updated profile
 */
export async function triggerBackMatching(organizationId: string): Promise<void> {
  const prisma = getPrismaClient();

  logger.info({ organizationId }, '[ProfileSync] Triggering back-matching for profile changes');

  // Get all active global events
  const activeEvents = await prisma.globalEvent.findMany({
    where: {
      status: {
        in: ['FORECAST', 'DEVELOPING', 'ACTIVE'],
      },
    },
    take: 1000, // Limit for performance
  });

  // For each event, re-evaluate exposure
  // This would emit change records to trigger client_monitoring consumer
  // For now, just log the count
  logger.info(
    { organizationId, activeEvents: activeEvents.length },
    '[ProfileSync] Back-matching would re-evaluate these events'
  );

  // TODO: Implement actual back-matching logic
  // This should emit synthetic global_event_change records for each active event
  // to trigger the client_monitoring consumer
}

/**
 * Refresh an organization's Client Exposure Profile after its supply-chain or
 * strategic data changed (D29, issue #76): called after BOL/ERP syncs, after an
 * Organizational Memory document is stored, and periodically by the global
 * worker. Skips the root organization (it is the operator, not a customer).
 * Never throws: a profile problem must not fail the data sync that triggered
 * it. Returns the sync result, or null when skipped or failed.
 */
export async function refreshClientExposureProfile(
  organizationId: string,
  reason: 'erp_sync' | 'bol_sync' | 'org_memory' | 'periodic'
): Promise<SyncResult | null> {
  try {
    const org = await getPrismaClient().organization.findUnique({
      where: { id: organizationId },
      select: { is_root: true },
    });
    if (!org || org.is_root) return null;
    const result = await syncClientExposureProfile(organizationId);
    logger.info({ organizationId, reason, profileVersion: result.profileVersion }, '[ProfileSync] Profile refreshed');
    return result;
  } catch (error) {
    logger.error({ error, organizationId, reason }, '[ProfileSync] Profile refresh failed');
    return null;
  }
}

