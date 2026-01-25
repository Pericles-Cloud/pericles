/**
 * SAP Data Transformer
 *
 * Transforms SAP S/4HANA Cloud data structures into Pericles OrganizationContext format
 * for supply chain risk monitoring.
 */

import type {
  SAPBusinessPartner,
  SAPPlant,
  SAPShippingLane,
  SAPODataResponse,
} from './types';

/**
 * OrganizationContext types (matching Prisma schema)
 */
export interface OrganizationContextData {
  plants: PlantLocation[];
  warehouses: WarehouseLocation[];
  suppliers: SupplierLocation[];
  shipping_lanes: ShippingLane[];
  risk_preferences: RiskPreferences;
}

export interface PlantLocation {
  plant_id: string;
  name: string;
  location: {
    name: string;
    latitude: number;
    longitude: number;
  };
  country: string;
  plant_type: string;
  capacity?: number;
  utilization?: number;
}

export interface WarehouseLocation {
  warehouse_id: string;
  name: string;
  location: {
    name: string;
    latitude: number;
    longitude: number;
  };
  country: string;
  capacity?: number;
  utilization?: number;
}

export interface SupplierLocation {
  supplier_id: string;
  name: string;
  location: {
    name: string;
    latitude: number;
    longitude: number;
  };
  country: string;
  tier: number;
  critical: boolean;
  risk_score?: number;
}

export interface ShippingLane {
  lane_id: string;
  origin: {
    plant_id: string;
    name: string;
    latitude: number;
    longitude: number;
  };
  destination: {
    plant_id: string;
    name: string;
    latitude: number;
    longitude: number;
  };
  mode: string;
  carrier?: string;
  transit_days: number;
  active: boolean;
}

export interface RiskPreferences {
  monitored_risk_types: string[];
  geographic_radius_km: number;
  severity_threshold: number;
  notification_channels: string[];
}

/**
 * Transform SAP Business Partners to Supplier Locations
 */
function transformSuppliersToLocations(
  suppliers: SAPBusinessPartner[]
): SupplierLocation[] {
  return suppliers
    .filter((bp): bp is SAPBusinessPartner & { to_Supplier: NonNullable<SAPBusinessPartner['to_Supplier']> } =>
      bp.to_Supplier !== undefined && bp.to_Supplier !== null
    )
    .map((bp) => {
      const address = bp.to_BusinessPartnerAddress?.[0];
      const supplier = bp.to_Supplier;

      return {
        supplier_id: bp.BusinessPartner,
        name: bp.BusinessPartnerName,
        location: {
          name: address?.CityName || 'Unknown',
          latitude: parseFloat(address?.Latitude || '0'),
          longitude: parseFloat(address?.Longitude || '0'),
        },
        country: address?.Country || 'Unknown',
        tier: supplier.SupplierTier || 1,
        critical: supplier.IsCriticalSupplier || false,
        risk_score: supplier.SupplierRiskScore,
      };
    });
}

/**
 * Transform SAP Plants to Plant/Warehouse Locations
 */
function transformPlantsToLocations(plants: SAPPlant[]): {
  plants: PlantLocation[];
  warehouses: WarehouseLocation[];
} {
  const plantLocations: PlantLocation[] = [];
  const warehouseLocations: WarehouseLocation[] = [];

  plants.forEach((plant) => {
    const location = {
      name: plant.CityName,
      latitude: parseFloat(plant.Latitude || '0'),
      longitude: parseFloat(plant.Longitude || '0'),
    };

    if (plant.PlantCategory === 'A') {
      // Manufacturing plant
      plantLocations.push({
        plant_id: plant.Plant,
        name: plant.PlantName,
        location,
        country: plant.Country,
        plant_type: 'manufacturing',
        capacity: plant.PlantCapacity,
        utilization: plant.PlantUtilization,
      });
    } else {
      // Warehouse/Distribution center
      warehouseLocations.push({
        warehouse_id: plant.Plant,
        name: plant.PlantName,
        location,
        country: plant.Country,
        capacity: plant.PlantCapacity,
        utilization: plant.PlantUtilization,
      });
    }
  });

  return { plants: plantLocations, warehouses: warehouseLocations };
}

/**
 * Transform SAP Shipping Lanes
 */
function transformShippingLanes(
  lanes: SAPShippingLane[],
  plants: SAPPlant[]
): ShippingLane[] {
  // Create plant lookup map
  const plantMap = new Map(plants.map((p) => [p.Plant, p]));

  return lanes.map((lane) => {
    const originPlant = plantMap.get(lane.OriginPlant);
    const destPlant = plantMap.get(lane.DestinationPlant);

    return {
      lane_id: lane.ShippingLaneID,
      origin: {
        plant_id: lane.OriginPlant,
        name: originPlant?.PlantName || 'Unknown',
        latitude: parseFloat(originPlant?.Latitude || '0'),
        longitude: parseFloat(originPlant?.Longitude || '0'),
      },
      destination: {
        plant_id: lane.DestinationPlant,
        name: destPlant?.PlantName || 'Unknown',
        latitude: parseFloat(destPlant?.Latitude || '0'),
        longitude: parseFloat(destPlant?.Longitude || '0'),
      },
      mode: getShipmentModeLabel(lane.ShipmentMode),
      carrier: lane.Carrier,
      transit_days: lane.TransitTimeInDays,
      active: lane.IsActive,
    };
  });
}

/**
 * Convert SAP shipment mode code to label
 */
function getShipmentModeLabel(mode: string): string {
  const modeMap: Record<string, string> = {
    '01': 'air',
    '02': 'ocean',
    '03': 'truck',
    '04': 'rail',
  };
  return modeMap[mode] || 'unknown';
}

/**
 * Get default risk preferences
 */
function getDefaultRiskPreferences(): RiskPreferences {
  return {
    monitored_risk_types: [
      'flood',
      'earthquake',
      'typhoon',
      'strike',
      'port_closure',
      'cyberattack',
      'trade_restriction',
      'pandemic',
      'geopolitical_conflict',
      'economic_crisis',
    ],
    geographic_radius_km: 100,
    severity_threshold: 0.3,
    notification_channels: ['email', 'slack'],
  };
}

/**
 * Main transformation function
 * Converts SAP S/4HANA data into OrganizationContext format
 */
export function transformSAPDataToOrganizationContext(
  suppliersResponse: SAPODataResponse<SAPBusinessPartner>,
  plantsResponse: SAPODataResponse<SAPPlant>,
  shippingLanesResponse: SAPODataResponse<SAPShippingLane>
): OrganizationContextData {
  const suppliers = suppliersResponse.d.results;
  const plants = plantsResponse.d.results;
  const shippingLanes = shippingLanesResponse.d.results;

  // Transform suppliers
  const supplierLocations = transformSuppliersToLocations(suppliers);

  // Transform plants and warehouses
  const { plants: plantLocations, warehouses: warehouseLocations } =
    transformPlantsToLocations(plants);

  // Transform shipping lanes
  const transformedShippingLanes = transformShippingLanes(shippingLanes, plants);

  return {
    plants: plantLocations,
    warehouses: warehouseLocations,
    suppliers: supplierLocations,
    shipping_lanes: transformedShippingLanes,
    risk_preferences: getDefaultRiskPreferences(),
  };
}

/**
 * Validate OrganizationContext data
 */
export function validateOrganizationContext(
  data: OrganizationContextData
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate suppliers have valid coordinates
  data.suppliers.forEach((supplier) => {
    if (
      !supplier.location.latitude ||
      !supplier.location.longitude ||
      supplier.location.latitude === 0 ||
      supplier.location.longitude === 0
    ) {
      errors.push(`Supplier ${supplier.supplier_id} has invalid coordinates`);
    }
  });

  // Validate plants have valid coordinates
  data.plants.forEach((plant) => {
    if (
      !plant.location.latitude ||
      !plant.location.longitude ||
      plant.location.latitude === 0 ||
      plant.location.longitude === 0
    ) {
      errors.push(`Plant ${plant.plant_id} has invalid coordinates`);
    }
  });

  // Validate warehouses have valid coordinates
  data.warehouses.forEach((warehouse) => {
    if (
      !warehouse.location.latitude ||
      !warehouse.location.longitude ||
      warehouse.location.latitude === 0 ||
      warehouse.location.longitude === 0
    ) {
      errors.push(`Warehouse ${warehouse.warehouse_id} has invalid coordinates`);
    }
  });

  // Validate risk preferences
  if (data.risk_preferences.geographic_radius_km <= 0) {
    errors.push('Geographic radius must be greater than 0');
  }

  if (
    data.risk_preferences.severity_threshold < 0 ||
    data.risk_preferences.severity_threshold > 1
  ) {
    errors.push('Severity threshold must be between 0 and 1');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
