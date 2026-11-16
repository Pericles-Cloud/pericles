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
import { createHash } from 'node:crypto';
import { enqueueManyIdempotent, CHANGE_RECORD_QUEUE } from './queue-client.js';
import { changeRecordKey, type ChangeRecord } from '../workflow/records/change-record.js';

export interface SyncResult {
  organizationId: string;
  profileVersion: number;
  facilitiesSynced: number;
  suppliersSynced: number;
  productsSynced: number;
  shipmentsSynced: number;
  strategicSynced: boolean;
  /** Active global events enqueued for re-evaluation because the profile changed. */
  backMatchEventsEnqueued: number;
  errors: string[];
}

type ProfileContent = Record<(typeof PROFILE_CONTENT_FIELDS)[number], unknown>;

/** Fields whose change can alter which global events expose this customer. */
const PROFILE_CONTENT_FIELDS = [
  'own_facilities',
  'suppliers',
  'products',
  'logistics',
  'shipments_in_transit',
  'strategic_priorities',
  'key_account_commitments',
  'stated_concerns',
  'excluded_categories',
  'excluded_regions',
  'min_severity',
] as const;

/** Stable fingerprint of the exposure-relevant profile content. */
export function profileFingerprint(profile: ProfileContent | null): string {
  const content = PROFILE_CONTENT_FIELDS.map((field) => (profile ? (profile[field] ?? null) : null));
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
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

    // Increment profile version
    const updatedProfile = await prisma.clientExposureProfile.update({
      where: { organization_id: organizationId },
      data: {
        profile_version: { increment: 1 },
        updated_at: new Date(),
      },
    });

    // Back-match only when exposure-relevant content differs from what was last
    // successfully back-matched. Comparing against the stored fingerprint (not
    // the pre-sync one) means a failed back-match is retried on the next sync.
    let backMatchEventsEnqueued = 0;
    const fingerprint = profileFingerprint(updatedProfile);
    if (fingerprint !== updatedProfile.back_match_fingerprint) {
      try {
        backMatchEventsEnqueued = await triggerBackMatching(organizationId, updatedProfile.profile_version);
        await prisma.clientExposureProfile.update({
          where: { organization_id: organizationId },
          data: { back_match_fingerprint: fingerprint },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Back-matching failed: ${msg}`);
        logger.error({ error, organizationId }, '[ProfileSync] Back-matching failed');
      }
    }

    const result: SyncResult = {
      organizationId,
      profileVersion: updatedProfile.profile_version,
      facilitiesSynced,
      suppliersSynced,
      productsSynced,
      shipmentsSynced,
      strategicSynced,
      backMatchEventsEnqueued,
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

  // Get suppliers from Supplier table
  // Every query feeding the profile is ordered, so an unchanged dataset
  // yields an identical fingerprint (no spurious back-matching).
  const suppliers = await prisma.supplier.findMany({
    where: { organization_id: organizationId },
    orderBy: { id: 'asc' },
  });

  const suppliersData = suppliers.map((s) => ({
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
  const productsData = Array.from(productMap.values());

  // Own facilities - would come from ERP plant/warehouse data
  // For now, return empty array (to be populated by SAP adapter)
  const ownFacilities: any[] = [];

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
 * Statuses re-scanned on a profile change. Per the Client Monitoring Agent
 * spec §6 (Notion): "Forecast, Developing, or Active" — De-escalating is
 * deliberately excluded.
 */
const BACK_MATCH_STATUSES = ['FORECAST', 'DEVELOPING', 'ACTIVE'] as const;
/** Events enqueued per INSERT; all active events are paged through, none dropped. */
const BACK_MATCH_PAGE_SIZE = 500;

/**
 * Trigger back-matching when a profile changes (issue #76).
 *
 * Re-scans active Global Events against the updated profile by enqueueing one
 * org-scoped global_event_change record per event. The client_monitoring
 * consumer sees `target_organization_id` and evaluates only this org, so a
 * single tenant's profile change never re-runs every other tenant.
 *
 * Records are keyed by (event, org, profile_version), so re-running a sync for
 * the same version does not enqueue duplicates.
 *
 * Returns the number of events enqueued for re-evaluation.
 */
export async function triggerBackMatching(organizationId: string, profileVersion: number): Promise<number> {
  if (!organizationId) {
    throw new Error('organization_id required for tenant isolation');
  }

  const prisma = getPrismaClient();
  const producedAt = new Date().toISOString();
  let enqueued = 0;
  let cursor: string | undefined;

  // Page through every active event by id. Each page is one atomic INSERT with
  // per-row idempotency keys, so a retry after a partial failure is safe.
  for (;;) {
    const page = await prisma.globalEvent.findMany({
      where: { status: { in: [...BACK_MATCH_STATUSES] } },
      select: { id: true, event_hash: true, intrinsic_severity: true, status: true },
      orderBy: { id: 'asc' },
      take: BACK_MATCH_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;

    const items = page.map((event) => {
      const record: ChangeRecord = {
        record_id: `${event.id}:backmatch:${organizationId}`,
        record_version: profileVersion,
        record_type: 'global_event_change',
        organization_id: organizationId,
        produced_at: producedAt,
        payload: {
          event_id: event.id,
          event_hash: event.event_hash,
          change_type: 'back_match',
          status: event.status,
          intrinsic_severity: event.intrinsic_severity,
          target_organization_id: organizationId,
        },
      };
      return {
        message: { type: 'change_record' as const, payload: record, timestamp: producedAt, organizationId },
        idempotencyKey: changeRecordKey(record),
      };
    });

    await enqueueManyIdempotent(prisma, CHANGE_RECORD_QUEUE, items);
    enqueued += page.length;

    if (page.length < BACK_MATCH_PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }

  logger.info(
    { organizationId, profileVersion, eventsEnqueued: enqueued },
    enqueued === 0
      ? '[ProfileSync] Back-matching: no active global events'
      : '[ProfileSync] Back-matching enqueued active global events for re-evaluation'
  );

  return enqueued;
}
