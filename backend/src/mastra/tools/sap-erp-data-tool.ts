/**
 * SAP S/4HANA Cloud ERP Data Tool
 *
 * Purpose: Fetch real-time supply chain master data directly from SAP S/4HANA Cloud OData APIs.
 *
 * This tool enables agents to retrieve fresh ERP data including:
 * - Business Partners (Suppliers/Customers) with addresses and risk scores
 * - Plants and Warehouses with capacity and utilization metrics
 * - Material Stock levels by plant
 * - Shipping Lanes with carriers and transit times
 *
 * Use Cases:
 * - Real-time supplier location verification during event monitoring
 * - On-demand plant capacity checks for impact assessment
 * - Fresh stock level queries for inventory risk analysis
 * - Shipping lane status validation for logistics disruptions
 *
 * Data Source: SAP S/4HANA Cloud OData V2 APIs
 * - API_BUSINESS_PARTNER: Supplier master data
 * - API_PLANT_SRV: Plant/warehouse data
 * - API_MATERIAL_STOCK_SRV: Inventory levels
 * - Z_SHIPPING_LANES_SRV: Custom shipping routes
 *
 * Mode Support:
 * - Production: Real SAP API calls with OAuth 2.0 authentication
 * - Mock: Test data from mock-api.ts (no SAP credentials required)
 *
 * Security: All API calls are server-side only, credentials never exposed to client
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sapClient } from '../../integrations/sap/client';
import type {
  SAPBusinessPartner,
  SAPPlant,
  SAPMaterialStock,
  SAPShippingLane,
} from '../../integrations/sap/types';

/**
 * Zod Schemas for SAP Data Structures
 */

const SAPLocationSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string(),
});

const SAPSupplierSchema = z.object({
  supplier_id: z.string(),
  name: z.string(),
  location: SAPLocationSchema,
  tier: z.number().int().min(1).max(3),
  critical: z.boolean(),
  risk_score: z.number().min(0).max(1).optional(),
});

const SAPPlantSchema = z.object({
  plant_id: z.string(),
  name: z.string(),
  location: SAPLocationSchema,
  plant_type: z.enum(['manufacturing', 'warehouse']),
  capacity: z.number().int().optional(),
  utilization: z.number().int().min(0).max(100).optional(),
});

const SAPMaterialStockSchema = z.object({
  material: z.string(),
  plant: z.string(),
  quantity: z.number(),
  unit: z.string(),
  stock_value: z.number().optional(),
  currency: z.string().optional(),
});

const SAPShippingLaneSchema = z.object({
  lane_id: z.string(),
  origin: z.object({
    plant_id: z.string(),
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
  }),
  destination: z.object({
    plant_id: z.string(),
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
  }),
  mode: z.string(),
  carrier: z.string().optional(),
  transit_days: z.number().int(),
  active: z.boolean(),
});

/**
 * Transformation Helper Functions
 */

function _transformSAPSupplier(sapData: SAPBusinessPartner): z.infer<typeof SAPSupplierSchema> {
  const address = sapData.to_BusinessPartnerAddress?.[0];
  const supplier = sapData.to_Supplier;

  if (!supplier) {
    throw new Error(`Business Partner ${sapData.BusinessPartner} is not a supplier`);
  }

  return {
    supplier_id: sapData.BusinessPartner,
    name: sapData.BusinessPartnerName,
    location: {
      name: address?.CityName || 'Unknown',
      latitude: parseFloat(address?.Latitude || '0'),
      longitude: parseFloat(address?.Longitude || '0'),
      country: address?.Country || 'Unknown',
    },
    tier: supplier.SupplierTier || 1,
    critical: supplier.IsCriticalSupplier || false,
    risk_score: supplier.SupplierRiskScore,
  };
}

function _transformSAPPlant(sapData: SAPPlant): z.infer<typeof SAPPlantSchema> {
  return {
    plant_id: sapData.Plant,
    name: sapData.PlantName,
    location: {
      name: sapData.CityName,
      latitude: parseFloat(sapData.Latitude || '0'),
      longitude: parseFloat(sapData.Longitude || '0'),
      country: sapData.Country,
    },
    plant_type: sapData.PlantCategory === 'A' ? 'manufacturing' : 'warehouse',
    capacity: sapData.PlantCapacity,
    utilization: sapData.PlantUtilization,
  };
}

function _transformSAPMaterialStock(sapData: SAPMaterialStock): z.infer<typeof SAPMaterialStockSchema> {
  return {
    material: sapData.Material,
    plant: sapData.Plant,
    quantity: parseFloat(sapData.MatlWrhsStkQtyInMatlBaseUnit),
    unit: sapData.MaterialBaseUnit,
    stock_value: sapData.StockValueInDisplayCurrency
      ? parseFloat(sapData.StockValueInDisplayCurrency)
      : undefined,
    currency: sapData.Currency,
  };
}

function transformSAPShippingLane(
  sapData: SAPShippingLane,
  plantsMap: Map<string, SAPPlant>
): z.infer<typeof SAPShippingLaneSchema> {
  const originPlant = plantsMap.get(sapData.OriginPlant);
  const destPlant = plantsMap.get(sapData.DestinationPlant);

  const shipmentModeMap: Record<string, string> = {
    '01': 'air',
    '02': 'ocean',
    '03': 'truck',
    '04': 'rail',
  };

  return {
    lane_id: sapData.ShippingLaneID,
    origin: {
      plant_id: sapData.OriginPlant,
      name: originPlant?.PlantName || 'Unknown',
      latitude: parseFloat(originPlant?.Latitude || '0'),
      longitude: parseFloat(originPlant?.Longitude || '0'),
    },
    destination: {
      plant_id: sapData.DestinationPlant,
      name: destPlant?.PlantName || 'Unknown',
      latitude: parseFloat(destPlant?.Latitude || '0'),
      longitude: parseFloat(destPlant?.Longitude || '0'),
    },
    mode: shipmentModeMap[sapData.ShipmentMode] || 'unknown',
    carrier: sapData.Carrier,
    transit_days: sapData.TransitTimeInDays,
    active: sapData.IsActive,
  };
}

/**
 * SAP ERP Data Tool - Get Suppliers
 *
 * Fetches supplier master data from SAP S/4HANA Cloud including locations, tiers, and risk scores.
 */
export const sapGetSuppliersT = createTool({
  id: 'sap-get-suppliers',
  description:
    'Fetch supplier master data from SAP S/4HANA Cloud including locations, tiers, criticality flags, and risk scores. Returns suppliers with geocoded addresses for proximity analysis.',

  inputSchema: z.object({
    country_filter: z
      .string()
      .length(2)
      .optional()
      .describe('Filter suppliers by ISO country code (e.g., "US", "CN")'),
    critical_only: z
      .boolean()
      .optional()
      .default(false)
      .describe('Return only critical (Tier 1) suppliers'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe('Maximum number of suppliers to return (1-100)'),
  }),

  outputSchema: z.object({
    suppliers: z.array(SAPSupplierSchema),
    total_count: z.number().int(),
    data_source: z.enum(['sap_production', 'sap_mock']),
    timestamp: z.string().datetime(),
  }),

  execute: async ({ context }) => {
    const { country_filter, critical_only, max_results } = context;

    console.log('[SAP Tool] Fetching suppliers from SAP S/4HANA Cloud', {
      country_filter,
      critical_only,
      max_results,
    });

    // Set timeout for SAP API call (30 seconds max)
    const controller = new AbortController();
    const _timeout = setTimeout(() => {
      controller.abort();
      console.error('[SAP Tool] Request timeout after 30 seconds');
    }, 30000);

    try {
      // Build OData filter
      let filter = 'to_Supplier ne null';
      if (country_filter) {
        filter += ` and to_BusinessPartnerAddress/any(_addr: addr/Country eq '${country_filter}')`;
      }

      // Fetch from SAP
      const response = await sapClient.getBusinessPartners({
        $expand: 'to_BusinessPartnerAddress,to_Supplier',
        $filter: filter,
        $top: max_results,
      });

      clearTimeout(_timeout);

      // Transform and filter
      let suppliers = response.d.results
        .filter((_bp) => bp.to_Supplier)
        .map(_transformSAPSupplier);

      if (critical_only) {
        suppliers = suppliers.filter((_s) => s.critical);
      }

      // Determine data source
      const dataSource = process.env.SAP_S4HANA_USE_MOCK === 'false' ? 'sap_production' : 'sap_mock';

      console.log(`[SAP Tool] Retrieved ${suppliers.length} suppliers from ${dataSource}`);

      return {
        suppliers,
        total_count: response.d.__count || suppliers.length,
        data_source: dataSource,
        timestamp: new Date().toISOString(),
      };
    } catch (_error) {
      clearTimeout(_timeout);
      console.error('[SAP Tool] Failed to fetch suppliers:', _error);
      throw new Error(
        `SAP API error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  },
});

/**
 * SAP ERP Data Tool - Get Plants
 *
 * Fetches plant and warehouse data from SAP S/4HANA Cloud with capacity metrics.
 */
export const sapGetPlantsT = createTool({
  id: 'sap-get-plants',
  description:
    'Fetch plant and warehouse data from SAP S/4HANA Cloud including locations, capacity, and utilization metrics. Useful for manufacturing and distribution center monitoring.',

  inputSchema: z.object({
    plant_type: z
      .enum(['manufacturing', 'warehouse', 'all'])
      .optional()
      .default('all')
      .describe('Filter by facility type'),
    country_filter: z
      .string()
      .length(2)
      .optional()
      .describe('Filter by ISO country code'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe('Maximum number of plants to return'),
  }),

  outputSchema: z.object({
    plants: z.array(SAPPlantSchema),
    total_count: z.number().int(),
    data_source: z.enum(['sap_production', 'sap_mock']),
    timestamp: z.string().datetime(),
  }),

  execute: async ({ context }) => {
    const { plant_type, country_filter, max_results } = context;

    console.log('[SAP Tool] Fetching plants from SAP S/4HANA Cloud', {
      plant_type,
      country_filter,
      max_results,
    });

    const controller = new AbortController();
    const _timeout = setTimeout(() => { controller.abort(); }, 30000);

    try {
      // Build OData filter
      let filter = '';
      if (country_filter) {
        filter = `Country eq '${country_filter}'`;
      }

      // Fetch from SAP
      const response = await sapClient.getPlants({
        $filter: filter || undefined,
        $top: max_results,
      });

      clearTimeout(_timeout);

      // Transform and filter by plant type
      let plants = response.d.results.map(_transformSAPPlant);

      if (plant_type !== 'all') {
        plants = plants.filter((_p) => p.plant_type === plant_type);
      }

      const dataSource = process.env.SAP_S4HANA_USE_MOCK === 'false' ? 'sap_production' : 'sap_mock';

      console.log(`[SAP Tool] Retrieved ${plants.length} plants from ${dataSource}`);

      return {
        plants,
        total_count: response.d.__count || plants.length,
        data_source: dataSource,
        timestamp: new Date().toISOString(),
      };
    } catch (_error) {
      clearTimeout(_timeout);
      console.error('[SAP Tool] Failed to fetch plants:', _error);
      throw new Error(
        `SAP API error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  },
});

/**
 * SAP ERP Data Tool - Get Material Stock
 *
 * Fetches real-time inventory levels for materials at specific plants.
 */
export const sapGetMaterialStockTool = createTool({
  id: 'sap-get-material-stock',
  description:
    'Fetch real-time material stock levels from SAP S/4HANA Cloud for a specific plant. Returns inventory quantities, values, and units.',

  inputSchema: z.object({
    plant_id: z.string().describe('SAP Plant ID (e.g., "1000")'),
    material_filter: z.string().optional().describe('Filter by material number (_optional)'),
    max_results: z.number().int().min(1).max(100).optional().default(50),
  }),

  outputSchema: z.object({
    stock: z.array(SAPMaterialStockSchema),
    plant_id: z.string(),
    total_count: z.number().int(),
    data_source: z.enum(['sap_production', 'sap_mock']),
    timestamp: z.string().datetime(),
  }),

  execute: async ({ context }) => {
    const { plant_id, material_filter, max_results } = context;

    console.log('[SAP Tool] Fetching material stock from SAP', {
      plant_id,
      material_filter,
      max_results,
    });

    const controller = new AbortController();
    const _timeout = setTimeout(() => { controller.abort(); }, 30000);

    try {
      const response = await sapClient.getMaterialStock(plant_id, {
        $top: max_results,
      });

      clearTimeout(_timeout);

      let stock = response.d.results.map(_transformSAPMaterialStock);

      if (material_filter) {
        stock = stock.filter((_s) => s.material.includes(material_filter));
      }

      const dataSource = process.env.SAP_S4HANA_USE_MOCK === 'false' ? 'sap_production' : 'sap_mock';

      console.log(`[SAP Tool] Retrieved ${stock.length} stock records from ${dataSource}`);

      return {
        stock,
        plant_id,
        total_count: response.d.__count || stock.length,
        data_source: dataSource,
        timestamp: new Date().toISOString(),
      };
    } catch (_error) {
      clearTimeout(_timeout);
      console.error('[SAP Tool] Failed to fetch material stock:', _error);
      throw new Error(
        `SAP API error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  },
});

/**
 * SAP ERP Data Tool - Get Shipping Lanes
 *
 * Fetches active shipping routes with carriers, transit times, and waypoints.
 */
export const sapGetShippingLanesTool = createTool({
  id: 'sap-get-shipping-lanes',
  description:
    'Fetch active shipping lanes from SAP S/4HANA Cloud including origin/destination plants, carriers, modes (air/ocean/truck/rail), and transit times.',

  inputSchema: z.object({
    origin_plant: z.string().optional().describe('Filter by origin plant ID'),
    destination_plant: z.string().optional().describe('Filter by destination plant ID'),
    mode: z
      .enum(['air', 'ocean', 'truck', 'rail', 'all'])
      .optional()
      .default('all')
      .describe('Filter by shipment mode'),
    active_only: z.boolean().optional().default(true).describe('Return only active lanes'),
    max_results: z.number().int().min(1).max(100).optional().default(50),
  }),

  outputSchema: z.object({
    shipping_lanes: z.array(SAPShippingLaneSchema),
    total_count: z.number().int(),
    data_source: z.enum(['sap_production', 'sap_mock']),
    timestamp: z.string().datetime(),
  }),

  execute: async ({ context }) => {
    const { origin_plant, destination_plant, mode, active_only, max_results } = context;

    console.log('[SAP Tool] Fetching shipping lanes from SAP', {
      origin_plant,
      destination_plant,
      mode,
      active_only,
      max_results,
    });

    const controller = new AbortController();
    const _timeout = setTimeout(() => { controller.abort(); }, 30000);

    try {
      // Fetch shipping lanes
      const [lanesResponse, plantsResponse] = await Promise.all([
        sapClient.getShippingLanes({ $top: max_results }),
        sapClient.getPlants(), // Need plant data for transformations
      ]);

      clearTimeout(_timeout);

      // Create plants map for lookups
      const _plantsMap = new Map(plantsResponse.d.results.map((_p) => [p.Plant, p]));

      // Transform and filter
      let shippingLanes = lanesResponse.d.results.map((_lane) =>
        transformSAPShippingLane(_lane, _plantsMap)
      );

      if (origin_plant) {
        shippingLanes = shippingLanes.filter((_l) => l.origin.plant_id === origin_plant);
      }

      if (destination_plant) {
        shippingLanes = shippingLanes.filter((_l) => l.destination.plant_id === destination_plant);
      }

      if (mode !== 'all') {
        shippingLanes = shippingLanes.filter((_l) => l.mode === mode);
      }

      if (active_only) {
        shippingLanes = shippingLanes.filter((_l) => l.active);
      }

      const dataSource = process.env.SAP_S4HANA_USE_MOCK === 'false' ? 'sap_production' : 'sap_mock';

      console.log(`[SAP Tool] Retrieved ${shippingLanes.length} shipping lanes from ${dataSource}`);

      return {
        shipping_lanes: shippingLanes,
        total_count: lanesResponse.d.__count || shippingLanes.length,
        data_source: dataSource,
        timestamp: new Date().toISOString(),
      };
    } catch (_error) {
      clearTimeout(_timeout);
      console.error('[SAP Tool] Failed to fetch shipping lanes:', _error);
      throw new Error(
        `SAP API error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  },
});
