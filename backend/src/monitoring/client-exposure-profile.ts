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

import { Prisma } from '@prisma/client';
import { getPrismaClient } from './db-client.js';
import { logger } from './logger.js';
import { isUniqueViolation } from './prisma-errors.js';

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

/** The empty value of the same shape (for "does this sync carry any content?"). */
function emptyLike(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, emptyLike(v)]));
  }
  return null;
}

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
  const errors: string[] = [];
  let facilitiesSynced = 0;
  let suppliersSynced = 0;
  let productsSynced = 0;
  let shipmentsSynced = 0;
  let strategicSynced = false;

  logger.info({ organizationId }, '[ProfileSync] Starting Client Exposure Profile sync');

  // Gather every source first; a source that fails leaves its fields as they
  // are. Then write all of it, and the version, in one transaction.
  const patch: ProfileContentPatch = {};
  const now = new Date();
  const stamps: Prisma.ClientExposureProfileUpdateInput = {};

  try {
    const erpData = await syncFromERP(organizationId);
    facilitiesSynced = erpData.facilities;
    suppliersSynced = erpData.suppliers;
    productsSynced = erpData.products;
    patch.own_facilities = erpData.ownFacilities;
    patch.suppliers = erpData.suppliersData;
    patch.products = erpData.productsData;
    patch.logistics = erpData.logisticsData;
    stamps.last_erp_sync = now;
  } catch (error) {
    errors.push(`ERP sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logger.error({ error, organizationId }, '[ProfileSync] ERP sync failed');
  }

  try {
    const shipmentsData = await syncShipmentsInTransit(organizationId);
    shipmentsSynced = shipmentsData.length;
    patch.shipments_in_transit = shipmentsData;
    stamps.last_shipment_sync = now;
  } catch (error) {
    errors.push(`Shipment sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logger.error({ error, organizationId }, '[ProfileSync] Shipment sync failed');
  }

  try {
    const orgMemoryData = await syncFromOrgMemory(organizationId);
    strategicSynced = true;
    patch.strategic_priorities = orgMemoryData.strategicPriorities;
    patch.key_account_commitments = orgMemoryData.keyAccountCommitments;
    patch.stated_concerns = orgMemoryData.statedConcerns;
    stamps.last_org_memory_sync = now;
  } catch (error) {
    errors.push(`Org Memory sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logger.error({ error, organizationId }, '[ProfileSync] Org Memory sync failed');
  }

  // An org with nothing to expose (no facilities, suppliers, products,
  // shipments or strategic context) gets no profile: a profile makes it
  // eligible for Client Monitoring, which would then spend its LLM calls on an
  // empty footprint.
  const hasContent = Object.values(patch).some((value) => canonicalJson(value) !== canonicalJson(emptyLike(value)));
  const existing = await getPrismaClient().clientExposureProfile.findUnique({
    where: { organization_id: organizationId },
    select: { profile_version: true },
  });
  if (!existing && !hasContent) {
    logger.info({ organizationId }, '[ProfileSync] No exposure-relevant data; no profile created');
    return {
      organizationId,
      profileVersion: 0,
      facilitiesSynced,
      suppliersSynced,
      productsSynced,
      shipmentsSynced,
      strategicSynced,
      errors,
    };
  }

  const { profileVersion } = await writeProfileContent(organizationId, patch, stamps);

  const result: SyncResult = {
    organizationId,
    profileVersion,
    facilitiesSynced,
    suppliersSynced,
    productsSynced,
    shipmentsSynced,
    strategicSynced,
    errors,
  };
  logger.info(result, '[ProfileSync] Client Exposure Profile sync complete');
  return result;
}

/** Profile Json columns that are nullable; the others are NOT NULL (default []). */
const NULLABLE_PROFILE_FIELDS = new Set(['strategic_priorities', 'key_account_commitments', 'stated_concerns']);

/** Exposure-relevant profile content, as written by a sync. */
export type ProfileContentPatch = Partial<Record<(typeof PROFILE_CONTENT_FIELDS)[number], unknown>>;

/**
 * Write profile content and decide the version in ONE transaction, holding the
 * profile row lock: create the profile if missing, compare the patch with what
 * is stored (canonical JSON), write the patch, and bump profile_version only if
 * a field actually changed. Every writer of profile content goes through here
 * (full sync and Org Memory's strategic refresh), so readers never see new
 * content under an old version and concurrent writers cannot both skip or
 * both apply the bump.
 */
export async function writeProfileContent(
  organizationId: string,
  patch: ProfileContentPatch,
  extra: Prisma.ClientExposureProfileUpdateInput = {}
): Promise<{ profileVersion: number; changed: boolean }> {
  if (!organizationId) {
    throw new Error('organization_id required for tenant isolation');
  }
  try {
    return await writeProfileContentOnce(organizationId, patch, extra);
  } catch (error) {
    // Two first writers for a new org can both try to create the row; the
    // loser's transaction aborts on the unique key. Retry once: the row exists.
    if (!isUniqueViolation(error)) throw error;
    return writeProfileContentOnce(organizationId, patch, extra);
  }
}

async function writeProfileContentOnce(
  organizationId: string,
  patch: ProfileContentPatch,
  extra: Prisma.ClientExposureProfileUpdateInput
): Promise<{ profileVersion: number; changed: boolean }> {
  return getPrismaClient().$transaction(async (tx) => {
    await tx.clientExposureProfile.upsert({
      where: { organization_id: organizationId },
      create: { organization_id: organizationId, profile_version: 1 },
      update: {},
    });
    await tx.$queryRaw`SELECT id FROM "ClientExposureProfile" WHERE organization_id = ${organizationId} FOR UPDATE`;
    const current = await tx.clientExposureProfile.findUniqueOrThrow({ where: { organization_id: organizationId } });

    const changed = (Object.keys(patch) as Array<keyof ProfileContentPatch>).some(
      (field) => canonicalJson(current[field]) !== canonicalJson(patch[field])
    );
    // Unchanged content is not rewritten (only the sync stamps are), so an
    // hourly refresh of identical data costs no jsonb rewrite.
    const data = changed
      ? {
          ...extra,
          ...(Object.fromEntries(
            Object.entries(patch).map(([field, value]) => [
              field,
              value ?? (NULLABLE_PROFILE_FIELDS.has(field) ? Prisma.DbNull : []),
            ])
          ) as Prisma.ClientExposureProfileUpdateInput),
          profile_version: { increment: 1 },
        }
      : extra;
    const written = await tx.clientExposureProfile.update({ where: { organization_id: organizationId }, data });
    return { profileVersion: written.profile_version, changed };
  });
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
  // SAP's transformer writes a missing coordinate as 0, so (0, 0) means
  // "unknown", not a site in the Gulf of Guinea that geographic matching
  // would then expose.
  const coords = (location: { latitude?: unknown; longitude?: unknown } | undefined) => {
    const lat = typeof location?.latitude === 'number' ? location.latitude : null;
    const lon = typeof location?.longitude === 'number' ? location.longitude : null;
    return lat === null || lon === null || (lat === 0 && lon === 0)
      ? { latitude: null, longitude: null }
      : { latitude: lat, longitude: lon };
  };
  const ownFacilities = [
    // `type` uses the profile schema's enum (plant | warehouse | dc | office);
    // SAP's plant_type (e.g. manufacturing) is kept as a subtype.
    // Ids are namespaced by kind (plant 1000 and warehouse 1000 are different
    // sites), and an entry without an id is dropped rather than called "undefined".
    ...located(context?.plants).filter((p) => p.plant_id !== undefined && p.plant_id !== null).map((p) => ({
      id: `plant:${String(p.plant_id)}`,
      name: p.name,
      type: 'plant' as const,
      subtype: p.plant_type ?? null,
      ...coords(p.location),
      country_iso: p.country ?? null,
    })),
    ...located(context?.warehouses).filter((w) => w.warehouse_id !== undefined && w.warehouse_id !== null).map((w) => ({
      id: `warehouse:${String(w.warehouse_id)}`,
      name: w.name,
      type: 'warehouse' as const,
      ...coords(w.location),
      country_iso: w.country ?? null,
    })),
  ].sort((a, b) => a.id.localeCompare(b.id));

  // Context suppliers: a supplier also in the Supplier table keeps that record
  // but gains the context's tier/critical flags (the BOL transformer marks
  // high-volume shippers critical); one only in the context (e.g. SAP) is added.
  const byName = new Map(suppliersData.map((s) => [String(s.name).trim().toLowerCase(), s]));
  for (const cs of located(context?.suppliers)) {
    const known = byName.get(String(cs.name).trim().toLowerCase());
    if (known) {
      known.tier = cs.tier ?? known.tier ?? 1;
      known.critical = cs.critical === true;
      continue;
    }
    suppliersData.push({
      id: cs.supplier_id,
      name: cs.name,
      ...coords(cs.location),
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
    take: 500, // Limit for performance: the 500 arriving soonest
    orderBy: [{ estimated_arrival_date: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
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

