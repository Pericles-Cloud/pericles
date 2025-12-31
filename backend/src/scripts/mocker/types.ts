/**
 * Mocker Types and Configuration
 *
 * Defines types for configuring mock shipment data generation
 * to test the Monitoring Agent against various risk scenarios.
 */

/**
 * Risk scenario types that can be simulated
 */
export type RiskScenario =
  | 'typhoon' // Shipments through typhoon-prone regions (Philippines, Taiwan, Japan)
  | 'earthquake' // Shipments near seismic zones
  | 'port_congestion' // Shipments to congested ports (LA, Long Beach, Shanghai)
  | 'labor_strike' // Shipments through regions with active labor disputes
  | 'geopolitical' // Shipments through conflict zones or sanctioned regions
  | 'pandemic' // Shipments from regions with health alerts
  | 'cyber_risk' // Shipments involving high-value tech components
  | 'tariff_risk' // Shipments subject to tariff changes
  | 'piracy' // Shipments through high-risk maritime zones (Gulf of Aden, Malacca)
  | 'flood'; // Shipments through flood-prone regions

/**
 * Shipment status for tracking
 */
export type ShipmentStatus = 'in_transit' | 'at_port' | 'customs_hold' | 'delivered' | 'delayed';

/**
 * Location definition with coordinates
 */
export interface MockLocation {
  name: string;
  city: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  riskFactors: RiskScenario[];
}

/**
 * Port definition
 */
export interface MockPort extends MockLocation {
  portCode: string;
  type: 'departure' | 'destination' | 'transshipment';
  congestionLevel: 'low' | 'medium' | 'high';
}

/**
 * Supplier definition for mock data
 */
export interface MockSupplier {
  name: string;
  location: MockLocation;
  products: string[];
  hsCodes: string[];
  tier: 1 | 2 | 3;
}

/**
 * Carrier definition for mock data
 */
export interface MockCarrier {
  name: string;
  scacCode: string;
  vesselNames: string[];
  reliability: 'high' | 'medium' | 'low';
}

/**
 * Shipping route definition
 */
export interface MockRoute {
  name: string;
  departurePort: MockPort;
  destinationPort: MockPort;
  transshipmentPorts?: MockPort[];
  transitDays: number;
  riskScenarios: RiskScenario[];
}

/**
 * Configuration for generating mock shipments
 */
export interface MockerConfig {
  /**
   * Number of shipments to generate
   */
  shipmentCount: number;

  /**
   * Risk scenarios to include in generated data
   * If empty, all scenarios will be used
   */
  riskScenarios: RiskScenario[];

  /**
   * Distribution of shipment statuses (percentages, should sum to 100)
   */
  statusDistribution: {
    in_transit: number;
    at_port: number;
    customs_hold: number;
    delivered: number;
    delayed: number;
  };

  /**
   * Date range for shipments
   */
  dateRange: {
    /** Days in the past for earliest arrival date */
    pastDays: number;
    /** Days in the future for latest arrival date */
    futureDays: number;
  };

  /**
   * Value range for shipments in USD
   */
  valueRange: {
    min: number;
    max: number;
  };

  /**
   * Prefix for generated IDs (for easy identification/cleanup)
   */
  idPrefix: string;

  /**
   * Organization ID to create shipments for
   */
  organizationId: string;
}

/**
 * Default configuration
 */
export const DEFAULT_MOCKER_CONFIG: MockerConfig = {
  shipmentCount: 50,
  riskScenarios: [],
  statusDistribution: {
    in_transit: 40,
    at_port: 20,
    customs_hold: 10,
    delivered: 20,
    delayed: 10,
  },
  dateRange: {
    pastDays: 30,
    futureDays: 60,
  },
  valueRange: {
    min: 10000,
    max: 500000,
  },
  idPrefix: 'mock-',
  organizationId: '550e8400-e29b-41d4-a716-446655440000', // Levi Strauss
};

/**
 * Result of mock data generation
 */
export interface MockerResult {
  organizationId: string;
  suppliersCreated: number;
  carriersCreated: number;
  shipmentsCreated: number;
  riskScenariosUsed: RiskScenario[];
  timestamp: Date;
}

/**
 * CLI command options
 */
export interface MockerCliOptions {
  action: 'create' | 'reset' | 'status';
  count?: number;
  scenarios?: RiskScenario[];
  dryRun?: boolean;
}
