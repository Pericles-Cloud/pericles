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

  // Get suppliers from Supplier table
  const suppliers = await prisma.supplier.findMany({
    where: { organization_id: organizationId },
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
    orderBy: { created_at: 'desc' },
  });

  // Derive carriers from shipments
  const carrierIds = [...new Set(shipments.map((s) => s.carrier_id).filter(Boolean))] as string[];
  const carriers = carrierIds.length > 0
    ? await prisma.carrier.findMany({ where: { id: { in: carrierIds } } })
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
  // TODO: Implement Org Memory integration
  // This would query the vector store for strategic documents
  // and extract structured data about:
  // - Strategic priorities and initiatives
  // - Key account commitments and SLAs
  // - Stated concerns and risk appetite

  // For now, return null (no Org Memory integration yet)
  return {
    strategicPriorities: null,
    keyAccountCommitments: null,
    statedConcerns: null,
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
