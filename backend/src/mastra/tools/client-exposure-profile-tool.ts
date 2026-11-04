import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPrismaClient } from '../../monitoring/db-client.js';

/**
 * Client Exposure Profile Tool
 *
 * Purpose: Load and manage the Client Exposure Profile for a customer.
 * The profile contains ERP-derived structural footprint and Org Memory strategic context.
 */
export const clientExposureProfileTool = createTool({
  id: 'client-exposure-profile-tool',
  description: `
Load the Client Exposure Profile for an organization.

Returns the customer's complete footprint including:
- Own facilities (plants, warehouses, DCs, offices)
- Suppliers with locations and criticality
- Products with BOMs and HS codes
- Logistics (carriers, routes, ports)
- Shipments in transit
- Strategic priorities from Organizational Memory
- Admin configuration (sensitivity, exclusions, buffers)

Use this tool BEFORE evaluating exposure pathways.
`,
  inputSchema: z.object({
    organization_id: z.string().uuid().describe('Organization ID'),
    include_shipments: z.boolean().default(true).describe('Include shipments in transit'),
    include_strategic: z.boolean().default(true).describe('Include strategic context from Org Memory'),
  }),
  outputSchema: z.object({
    organization_id: z.string(),
    profile_version: z.number(),
    last_erp_sync: z.string().datetime(),
    last_shipment_sync: z.string().datetime(),
    last_org_memory_sync: z.string().datetime(),

    // Structural footprint
    own_facilities: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(['plant', 'warehouse', 'dc', 'office']),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      criticality: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    })),
    suppliers: z.array(z.object({
      id: z.string(),
      name: z.string(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      country_iso: z.string().optional(),
      supplies: z.array(z.object({
        sku: z.string().optional(),
        commodity: z.string().optional(),
        hs_code: z.string().optional(),
      })),
      spend_pct: z.number().optional(),
      single_source: z.boolean().optional(),
    })),
    products: z.array(z.object({
      sku: z.string(),
      name: z.string().optional(),
      bom: z.array(z.object({
        input_sku: z.string(),
        qty: z.number().optional(),
      })).optional(),
      hs_codes: z.array(z.string()).optional(),
    })),
    logistics: z.object({
      carriers: z.array(z.object({
        id: z.string(),
        name: z.string(),
        scac_code: z.string().optional(),
      })),
      routes: z.array(z.object({
        origin: z.string(),
        destination: z.string(),
        mode: z.enum(['maritime', 'air', 'rail', 'road']),
        ports: z.array(z.string()).optional(),
      })),
    }),
    shipments_in_transit: z.array(z.object({
      id: z.string(),
      origin: z.string(),
      destination: z.string(),
      route: z.string().optional(),
      carrier: z.string().optional(),
      eta: z.string().datetime().nullable(),
      contents: z.array(z.object({
        sku: z.string(),
        qty: z.number().optional(),
      })).optional(),
      departure_port_code: z.string().optional(),
      destination_port_code: z.string().optional(),
    })),
    customers: z.array(z.object({
      id: z.string(),
      name: z.string(),
      ship_to_locations: z.array(z.object({
        latitude: z.number(),
        longitude: z.number(),
      })).optional(),
    })),

    // Strategic context
    strategic_priorities: z.array(z.object({
      initiative: z.string(),
      description: z.string().optional(),
      target_date: z.string().optional(),
      locations: z.array(z.string()).optional(),
      partners: z.array(z.string()).optional(),
    })).nullable(),
    key_account_commitments: z.array(z.object({
      account: z.string(),
      sla: z.string().optional(),
      dependent_supply: z.array(z.string()).optional(),
    })).nullable(),
    stated_concerns: z.array(z.object({
      concern: z.string(),
      risk_appetite: z.string().optional(),
    })).nullable(),

    // Admin configuration
    sensitivity_config: z.record(z.string()).nullable(),
    excluded_categories: z.array(z.string()),
    excluded_regions: z.array(z.string()),
    buffer_distances: z.record(z.number()).nullable(),
    min_severity: z.record(z.string()).nullable(),

    // Data quality flags
    data_quality_flags: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const prisma = getPrismaClient();
    const { organization_id, include_shipments, include_strategic } = context;

    // Load profile from database
    const profile = await prisma.clientExposureProfile.findUnique({
      where: { organization_id },
    });

    const dataQualityFlags: string[] = [];

    if (!profile) {
      // No profile exists - return empty structure with flags
      dataQualityFlags.push('NO_PROFILE_EXISTS');
      dataQualityFlags.push('ERP_SYNC_REQUIRED');

      return {
        organization_id,
        profile_version: 0,
        last_erp_sync: new Date().toISOString(),
        last_shipment_sync: new Date().toISOString(),
        last_org_memory_sync: new Date().toISOString(),
        own_facilities: [],
        suppliers: [],
        products: [],
        logistics: { carriers: [], routes: [] },
        shipments_in_transit: [],
        customers: [],
        strategic_priorities: null,
        key_account_commitments: null,
        stated_concerns: null,
        sensitivity_config: null,
        excluded_categories: [],
        excluded_regions: [],
        buffer_distances: null,
        min_severity: null,
        data_quality_flags: dataQualityFlags,
      };
    }

    // Check data freshness
    const now = new Date();
    const erpAgeHours = (now.getTime() - profile.last_erp_sync.getTime()) / (1000 * 60 * 60);
    const shipmentAgeHours = (now.getTime() - profile.last_shipment_sync.getTime()) / (1000 * 60 * 60);

    if (erpAgeHours > 24) {
      dataQualityFlags.push(`ERP_DATA_STALE_${Math.round(erpAgeHours)}H`);
    }
    if (include_shipments && shipmentAgeHours > 4) {
      dataQualityFlags.push(`SHIPMENT_DATA_STALE_${Math.round(shipmentAgeHours)}H`);
    }

    // Parse JSON fields
    const ownFacilities = (profile.own_facilities as any[]) ?? [];
    const suppliers = (profile.suppliers as any[]) ?? [];
    const products = (profile.products as any[]) ?? [];
    const logistics = (profile.logistics as any) ?? { carriers: [], routes: [] };
    const shipments = include_shipments ? ((profile.shipments_in_transit as any[]) ?? []) : [];
    const customers = (profile.customers as any[]) ?? [];

    // Check for missing data
    if (ownFacilities.length === 0) {
      dataQualityFlags.push('NO_FACILITIES_DATA');
    }
    if (suppliers.length === 0) {
      dataQualityFlags.push('NO_SUPPLIERS_DATA');
    }
    if (logistics.routes?.length === 0) {
      dataQualityFlags.push('NO_ROUTE_DATA');
    }

    // Check for facilities/suppliers without coordinates
    const facilitiesWithoutCoords = ownFacilities.filter(
      (f: any) => f.latitude === null || f.longitude === null
    ).length;
    if (facilitiesWithoutCoords > 0) {
      dataQualityFlags.push(`${facilitiesWithoutCoords}_FACILITIES_MISSING_COORDS`);
    }

    const suppliersWithoutCoords = suppliers.filter(
      (s: any) => s.latitude === null || s.longitude === null
    ).length;
    if (suppliersWithoutCoords > 0) {
      dataQualityFlags.push(`${suppliersWithoutCoords}_SUPPLIERS_MISSING_COORDS`);
    }

    return {
      organization_id,
      profile_version: profile.profile_version,
      last_erp_sync: profile.last_erp_sync.toISOString(),
      last_shipment_sync: profile.last_shipment_sync.toISOString(),
      last_org_memory_sync: profile.last_org_memory_sync.toISOString(),
      own_facilities: ownFacilities,
      suppliers,
      products,
      logistics: {
        carriers: logistics.carriers ?? [],
        routes: logistics.routes ?? [],
      },
      shipments_in_transit: shipments,
      customers,
      strategic_priorities: include_strategic ? (profile.strategic_priorities as any) : null,
      key_account_commitments: include_strategic ? (profile.key_account_commitments as any) : null,
      stated_concerns: include_strategic ? (profile.stated_concerns as any) : null,
      sensitivity_config: profile.sensitivity_config as any,
      excluded_categories: profile.excluded_categories ?? [],
      excluded_regions: profile.excluded_regions ?? [],
      buffer_distances: profile.buffer_distances as any,
      min_severity: profile.min_severity as any,
      data_quality_flags: dataQualityFlags,
    };
  },
});
