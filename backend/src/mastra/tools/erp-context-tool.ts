import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPrismaClient } from '../../monitoring/db-client';

const prisma = getPrismaClient();

/**
 * ERP Context Tool
 *
 * Purpose: Retrieve organization-specific ERP data to understand supply chain footprint and exposure.
 *
 * This tool queries the OrganizationContext table to get:
 * - Plants, warehouses, suppliers, shipping lanes with geographic locations
 * - Risk monitoring preferences (monitored risk types, geographic radius, severity threshold)
 * - Strategic documents metadata
 *
 * This context is critical for:
 * - Geographic filtering (proximity-based event relevance)
 * - Risk type filtering (organization-specific risk needs)
 * - Impact assessment (which entities are affected)
 *
 * Organization Isolation: Queries are scoped to the specified organization_id
 */

// Zod schemas for ERP data structures
const LocationSchema = z.object({
  city: z.string(),
  country: z.string(),
  latitude: z.number(),
  longitude: z.number()
});

const PlantSchema = z.object({
  plant_id: z.string(),
  name: z.string(),
  location: LocationSchema,
  criticality: z.enum(['low', 'medium', 'high']).optional()
});

const WarehouseSchema = z.object({
  warehouse_id: z.string(),
  name: z.string(),
  location: LocationSchema
});

const SupplierSchema = z.object({
  supplier_id: z.string(),
  name: z.string(),
  location: LocationSchema,
  tier: z.number().int().min(1).optional()
});

const ShippingLaneSchema = z.object({
  lane_id: z.string(),
  origin: z.string(),
  destination: z.string(),
  key_ports: z.array(z.string())
});

const RiskPreferencesSchema = z.object({
  monitored_risk_types: z.array(z.string()).optional().describe('Specific risk types to monitor (e.g., flood, _strike)'),
  geographic_radius_km: z.number().min(1).max(5000).describe('Distance in km for geographic relevance filtering'),
  severity_threshold: z.number().min(0).max(1).describe('Minimum severity score (0.0-1.0) for event publication')
});

export const erpContextTool = createTool({
  id: 'erp-context-retrieval',
  description: 'Retrieve organization-specific ERP data including plants, warehouses, suppliers, shipping lanes, and risk monitoring preferences. Essential for geographic filtering and impact assessment.',

  inputSchema: z.object({
    organization_id: z.string().uuid().describe('Organization identifier (required for all operations)')
  }),

  outputSchema: z.object({
    plants: z.array(PlantSchema).describe('Manufacturing plants with locations'),
    warehouses: z.array(WarehouseSchema).describe('Warehouses and distribution centers'),
    suppliers: z.array(SupplierSchema).describe('Supply chain suppliers'),
    shipping_lanes: z.array(ShippingLaneSchema).describe('Key shipping routes'),
    risk_preferences: RiskPreferencesSchema.describe('Risk monitoring configuration'),
    strategic_documents: z.record(z.string(), z.any()).optional().describe('References to annual plans, risk policies, etc.'),
    last_erp_sync: z.string().datetime().optional().describe('When ERP data was last synchronized')
  }),

  execute: async ({ context }) => {
    const { organization_id } = context;

    // Log the input parameters received
    console.log(`[ERP Context] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id is present
    if (!organization_id) {
      throw new Error('organization_id is required for ERP context retrieval');
    }

    console.log(`[ERP Context] Retrieving context for organization: ${organization_id}`);

    try {
      // Query OrganizationContext with organization isolation
      const organizationContext = await prisma.organizationContext.findUnique({
        where: {
          organization_id: organization_id
        },
        select: {
          plants: true,
          warehouses: true,
          suppliers: true,
          shipping_lanes: true,
          monitored_risk_types: true,
          geographic_radius_km: true,
          severity_threshold: true,
          strategic_documents: true,
          last_erp_sync: true
        }
      });

      if (!organizationContext) {
        console.warn(`[ERP Context] No context found for organization: ${organization_id}, returning defaults`);

        // Return defaults for organizations without ERP data
        return {
          plants: [],
          warehouses: [],
          suppliers: [],
          shipping_lanes: [],
          risk_preferences: {
            monitored_risk_types: [], // Empty = monitor all risk types
            geographic_radius_km: 100, // Default: 100km radius
            severity_threshold: 0.5    // Default: 0.5 severity threshold
          }
        };
      }

      // Parse JSON fields (Prisma stores as Json type)
      const plants = Array.isArray(organizationContext.plants)
        ? organizationContext.plants as Array<z.infer<typeof PlantSchema>>
        : [];

      const warehouses = Array.isArray(organizationContext.warehouses)
        ? organizationContext.warehouses as Array<z.infer<typeof WarehouseSchema>>
        : [];

      const suppliers = Array.isArray(organizationContext.suppliers)
        ? organizationContext.suppliers as Array<z.infer<typeof SupplierSchema>>
        : [];

      const shipping_lanes = Array.isArray(organizationContext.shipping_lanes)
        ? organizationContext.shipping_lanes as Array<z.infer<typeof ShippingLaneSchema>>
        : [];

      const strategic_documents = organizationContext.strategic_documents as Record<string, unknown> | undefined;

      console.log(`[ERP Context] Retrieved ${plants.length} plants, ${warehouses.length} warehouses, ${suppliers.length} suppliers`);

      return {
        plants,
        warehouses,
        suppliers,
        shipping_lanes,
        risk_preferences: {
          monitored_risk_types: organizationContext.monitored_risk_types || [],
          geographic_radius_km: organizationContext.geographic_radius_km,
          severity_threshold: organizationContext.severity_threshold
        },
        strategic_documents,
        last_erp_sync: organizationContext.last_erp_sync?.toISOString()
      };

    } catch (error) {
      console.error(`[ERP Context] Database query failed:`, error);
      throw new Error(`Failed to retrieve ERP context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});
