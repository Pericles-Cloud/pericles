/**
 * Mock Data for Shipment Generation
 *
 * Contains realistic suppliers, carriers, ports, and routes
 * designed to trigger various risk scenarios for testing the Monitoring Agent.
 */

import type { MockSupplier, MockCarrier, MockPort, MockRoute, RiskScenario } from './types.js';

// ============================================================================
// HIGH-RISK PORTS
// ============================================================================

export const MOCK_PORTS: MockPort[] = [
  // Asia - Typhoon/Earthquake Risk
  {
    name: 'Port of Manila',
    city: 'Manila',
    country: 'Philippines',
    countryCode: 'PH',
    latitude: 14.5995,
    longitude: 120.9842,
    portCode: 'PHMNS',
    type: 'departure',
    congestionLevel: 'medium',
    riskFactors: ['typhoon', 'earthquake', 'flood'],
  },
  {
    name: 'Port of Kaohsiung',
    city: 'Kaohsiung',
    country: 'Taiwan',
    countryCode: 'TW',
    latitude: 22.6273,
    longitude: 120.3014,
    portCode: 'TWKHH',
    type: 'departure',
    congestionLevel: 'medium',
    riskFactors: ['typhoon', 'earthquake', 'geopolitical'],
  },
  {
    name: 'Port of Shanghai',
    city: 'Shanghai',
    country: 'China',
    countryCode: 'CN',
    latitude: 31.2304,
    longitude: 121.4737,
    portCode: 'CNSHA',
    type: 'departure',
    congestionLevel: 'high',
    riskFactors: ['typhoon', 'port_congestion', 'tariff_risk'],
  },
  {
    name: 'Port of Ningbo-Zhoushan',
    city: 'Ningbo',
    country: 'China',
    countryCode: 'CN',
    latitude: 29.8683,
    longitude: 121.544,
    portCode: 'CNNGB',
    type: 'departure',
    congestionLevel: 'high',
    riskFactors: ['typhoon', 'port_congestion', 'tariff_risk'],
  },
  {
    name: 'Port of Shenzhen',
    city: 'Shenzhen',
    country: 'China',
    countryCode: 'CN',
    latitude: 22.5431,
    longitude: 114.0579,
    portCode: 'CNSZX',
    type: 'departure',
    congestionLevel: 'high',
    riskFactors: ['typhoon', 'cyber_risk', 'tariff_risk'],
  },
  {
    name: 'Port of Busan',
    city: 'Busan',
    country: 'South Korea',
    countryCode: 'KR',
    latitude: 35.1796,
    longitude: 129.0756,
    portCode: 'KRPUS',
    type: 'transshipment',
    congestionLevel: 'medium',
    riskFactors: ['typhoon', 'geopolitical'],
  },
  {
    name: 'Tokyo Bay (Yokohama)',
    city: 'Yokohama',
    country: 'Japan',
    countryCode: 'JP',
    latitude: 35.4437,
    longitude: 139.638,
    portCode: 'JPYOK',
    type: 'departure',
    congestionLevel: 'medium',
    riskFactors: ['typhoon', 'earthquake'],
  },

  // Southeast Asia - Pandemic/Labor Risk
  {
    name: 'Port of Ho Chi Minh City',
    city: 'Ho Chi Minh City',
    country: 'Vietnam',
    countryCode: 'VN',
    latitude: 10.7769,
    longitude: 106.7009,
    portCode: 'VNSGN',
    type: 'departure',
    congestionLevel: 'medium',
    riskFactors: ['flood', 'pandemic', 'labor_strike'],
  },
  {
    name: 'Port of Singapore',
    city: 'Singapore',
    country: 'Singapore',
    countryCode: 'SG',
    latitude: 1.2644,
    longitude: 103.822,
    portCode: 'SGSIN',
    type: 'transshipment',
    congestionLevel: 'low',
    riskFactors: ['piracy'],
  },
  {
    name: 'Port Klang',
    city: 'Port Klang',
    country: 'Malaysia',
    countryCode: 'MY',
    latitude: 3.0319,
    longitude: 101.3685,
    portCode: 'MYPKG',
    type: 'transshipment',
    congestionLevel: 'medium',
    riskFactors: ['piracy', 'flood'],
  },
  {
    name: 'Chittagong Port',
    city: 'Chittagong',
    country: 'Bangladesh',
    countryCode: 'BD',
    latitude: 22.3569,
    longitude: 91.7832,
    portCode: 'BDCGP',
    type: 'departure',
    congestionLevel: 'high',
    riskFactors: ['flood', 'labor_strike', 'port_congestion'],
  },

  // South Asia - Labor/Flood Risk
  {
    name: 'Jawaharlal Nehru Port',
    city: 'Mumbai',
    country: 'India',
    countryCode: 'IN',
    latitude: 18.9491,
    longitude: 72.9483,
    portCode: 'INNSA',
    type: 'departure',
    congestionLevel: 'high',
    riskFactors: ['flood', 'labor_strike', 'port_congestion'],
  },
  {
    name: 'Chennai Port',
    city: 'Chennai',
    country: 'India',
    countryCode: 'IN',
    latitude: 13.0827,
    longitude: 80.2707,
    portCode: 'INMAA',
    type: 'departure',
    congestionLevel: 'medium',
    riskFactors: ['flood', 'labor_strike'],
  },

  // Middle East - Geopolitical Risk
  {
    name: 'Jebel Ali Port',
    city: 'Dubai',
    country: 'UAE',
    countryCode: 'AE',
    latitude: 25.0657,
    longitude: 55.1713,
    portCode: 'AEJEA',
    type: 'transshipment',
    congestionLevel: 'low',
    riskFactors: ['geopolitical'],
  },

  // US West Coast - Congestion/Labor Risk
  {
    name: 'Port of Los Angeles',
    city: 'Los Angeles',
    country: 'United States',
    countryCode: 'US',
    latitude: 33.7406,
    longitude: -118.2755,
    portCode: 'USLAX',
    type: 'destination',
    congestionLevel: 'high',
    riskFactors: ['port_congestion', 'labor_strike'],
  },
  {
    name: 'Port of Long Beach',
    city: 'Long Beach',
    country: 'United States',
    countryCode: 'US',
    latitude: 33.7523,
    longitude: -118.2087,
    portCode: 'USLGB',
    type: 'destination',
    congestionLevel: 'high',
    riskFactors: ['port_congestion', 'labor_strike'],
  },
  {
    name: 'Port of Oakland',
    city: 'Oakland',
    country: 'United States',
    countryCode: 'US',
    latitude: 37.7956,
    longitude: -122.2789,
    portCode: 'USOAK',
    type: 'destination',
    congestionLevel: 'medium',
    riskFactors: ['earthquake', 'labor_strike'],
  },

  // US East Coast
  {
    name: 'Port of New York/New Jersey',
    city: 'Newark',
    country: 'United States',
    countryCode: 'US',
    latitude: 40.6681,
    longitude: -74.0449,
    portCode: 'USNYC',
    type: 'destination',
    congestionLevel: 'high',
    riskFactors: ['port_congestion', 'flood'],
  },
  {
    name: 'Port of Savannah',
    city: 'Savannah',
    country: 'United States',
    countryCode: 'US',
    latitude: 32.0809,
    longitude: -81.0912,
    portCode: 'USSAV',
    type: 'destination',
    congestionLevel: 'medium',
    riskFactors: ['flood', 'typhoon'],
  },

  // Europe
  {
    name: 'Port of Rotterdam',
    city: 'Rotterdam',
    country: 'Netherlands',
    countryCode: 'NL',
    latitude: 51.9244,
    longitude: 4.4777,
    portCode: 'NLRTM',
    type: 'destination',
    congestionLevel: 'medium',
    riskFactors: ['flood'],
  },
];

// ============================================================================
// HIGH-RISK SUPPLIERS (Apparel Manufacturing)
// ============================================================================

export const MOCK_SUPPLIERS: MockSupplier[] = [
  // China - Multiple risks
  {
    name: 'Guangzhou Textile Manufacturing Co.',
    location: {
      name: 'Guangzhou Factory',
      city: 'Guangzhou',
      country: 'China',
      countryCode: 'CN',
      latitude: 23.1291,
      longitude: 113.2644,
      riskFactors: ['typhoon', 'tariff_risk', 'flood'],
    },
    products: ['Denim Fabric', 'Cotton Twill', 'Canvas'],
    hsCodes: ['5209', '5208', '5212'],
    tier: 1,
  },
  {
    name: 'Shenzhen Apparel Tech Ltd.',
    location: {
      name: 'Shenzhen Plant',
      city: 'Shenzhen',
      country: 'China',
      countryCode: 'CN',
      latitude: 22.5431,
      longitude: 114.0579,
      riskFactors: ['typhoon', 'cyber_risk', 'tariff_risk'],
    },
    products: ['Smart Fabric', 'Tech Accessories', 'Wearables'],
    hsCodes: ['6203', '6204', '8517'],
    tier: 1,
  },
  {
    name: 'Ningbo Garment Factory',
    location: {
      name: 'Ningbo Facility',
      city: 'Ningbo',
      country: 'China',
      countryCode: 'CN',
      latitude: 29.8683,
      longitude: 121.544,
      riskFactors: ['typhoon', 'port_congestion'],
    },
    products: ['Jeans', 'Casual Pants', 'Shorts'],
    hsCodes: ['6203', '6204'],
    tier: 1,
  },

  // Vietnam - Labor/Pandemic risks
  {
    name: 'Saigon Denim Works',
    location: {
      name: 'HCMC Factory',
      city: 'Ho Chi Minh City',
      country: 'Vietnam',
      countryCode: 'VN',
      latitude: 10.8231,
      longitude: 106.6297,
      riskFactors: ['flood', 'pandemic', 'labor_strike'],
    },
    products: ['Denim Jeans', 'Denim Jackets', 'Denim Shirts'],
    hsCodes: ['6203', '6211', '6205'],
    tier: 1,
  },
  {
    name: 'Hanoi Textile Corp.',
    location: {
      name: 'Hanoi Plant',
      city: 'Hanoi',
      country: 'Vietnam',
      countryCode: 'VN',
      latitude: 21.0285,
      longitude: 105.8542,
      riskFactors: ['flood', 'labor_strike'],
    },
    products: ['Cotton Fabric', 'T-Shirts', 'Polo Shirts'],
    hsCodes: ['5208', '6109', '6105'],
    tier: 2,
  },

  // Bangladesh - Flood/Labor risks
  {
    name: 'Dhaka Garments Ltd.',
    location: {
      name: 'Dhaka Factory',
      city: 'Dhaka',
      country: 'Bangladesh',
      countryCode: 'BD',
      latitude: 23.8103,
      longitude: 90.4125,
      riskFactors: ['flood', 'labor_strike', 'pandemic'],
    },
    products: ['T-Shirts', 'Knit Tops', 'Underwear'],
    hsCodes: ['6109', '6110', '6107'],
    tier: 2,
  },
  {
    name: 'Chittagong Apparel Manufacturing',
    location: {
      name: 'Chittagong Plant',
      city: 'Chittagong',
      country: 'Bangladesh',
      countryCode: 'BD',
      latitude: 22.3569,
      longitude: 91.7832,
      riskFactors: ['flood', 'labor_strike', 'port_congestion'],
    },
    products: ['Casual Wear', 'Activewear', 'Kids Clothing'],
    hsCodes: ['6203', '6112', '6111'],
    tier: 2,
  },

  // India - Labor/Flood risks
  {
    name: 'Mumbai Cotton Mills',
    location: {
      name: 'Mumbai Factory',
      city: 'Mumbai',
      country: 'India',
      countryCode: 'IN',
      latitude: 19.076,
      longitude: 72.8777,
      riskFactors: ['flood', 'labor_strike'],
    },
    products: ['Cotton Fabric', 'Organic Cotton', 'Blended Fabrics'],
    hsCodes: ['5208', '5209', '5210'],
    tier: 2,
  },
  {
    name: 'Chennai Textile Industries',
    location: {
      name: 'Chennai Facility',
      city: 'Chennai',
      country: 'India',
      countryCode: 'IN',
      latitude: 13.0827,
      longitude: 80.2707,
      riskFactors: ['flood', 'labor_strike'],
    },
    products: ['Denim', 'Khaki Fabric', 'Workwear'],
    hsCodes: ['5209', '5211', '6203'],
    tier: 2,
  },

  // Philippines - Typhoon risk
  {
    name: 'Manila Garment Factory',
    location: {
      name: 'Manila Plant',
      city: 'Manila',
      country: 'Philippines',
      countryCode: 'PH',
      latitude: 14.5995,
      longitude: 120.9842,
      riskFactors: ['typhoon', 'earthquake', 'flood'],
    },
    products: ['Casual Shirts', 'Blouses', 'Light Jackets'],
    hsCodes: ['6205', '6206', '6201'],
    tier: 2,
  },

  // Taiwan - Geopolitical/Typhoon risk
  {
    name: 'Taipei Tech Textiles',
    location: {
      name: 'Taipei Factory',
      city: 'Taipei',
      country: 'Taiwan',
      countryCode: 'TW',
      latitude: 25.033,
      longitude: 121.5654,
      riskFactors: ['typhoon', 'earthquake', 'geopolitical'],
    },
    products: ['Performance Fabric', 'Stretch Denim', 'Technical Textiles'],
    hsCodes: ['5903', '5209', '5907'],
    tier: 1,
  },

  // Turkey - Geopolitical risk
  {
    name: 'Istanbul Denim Co.',
    location: {
      name: 'Istanbul Factory',
      city: 'Istanbul',
      country: 'Turkey',
      countryCode: 'TR',
      latitude: 41.0082,
      longitude: 28.9784,
      riskFactors: ['geopolitical', 'earthquake'],
    },
    products: ['Premium Denim', 'Selvedge Denim', 'Vintage Wash'],
    hsCodes: ['5209', '5211'],
    tier: 1,
  },
];

// ============================================================================
// CARRIERS
// ============================================================================

export const MOCK_CARRIERS: MockCarrier[] = [
  {
    name: 'Maersk Line',
    scacCode: 'MAEU',
    vesselNames: ['Maersk Edmonton', 'Maersk Eindhoven', 'Maersk Evora'],
    reliability: 'high',
  },
  {
    name: 'MSC Mediterranean Shipping',
    scacCode: 'MSCU',
    vesselNames: ['MSC Oscar', 'MSC Maya', 'MSC Zoe'],
    reliability: 'high',
  },
  {
    name: 'CMA CGM',
    scacCode: 'CMDU',
    vesselNames: ['CMA CGM Marco Polo', 'CMA CGM Jules Verne', 'CMA CGM Antoine'],
    reliability: 'high',
  },
  {
    name: 'COSCO Shipping',
    scacCode: 'COSU',
    vesselNames: ['COSCO Shipping Universe', 'COSCO Shipping Nebula', 'COSCO Shipping Star'],
    reliability: 'medium',
  },
  {
    name: 'Evergreen Marine',
    scacCode: 'EGLV',
    vesselNames: ['Ever Given', 'Ever Ace', 'Ever Glory'],
    reliability: 'medium',
  },
  {
    name: 'Hapag-Lloyd',
    scacCode: 'HLCU',
    vesselNames: ['Berlin Express', 'Hamburg Express', 'Tokyo Express'],
    reliability: 'high',
  },
  {
    name: 'ONE (Ocean Network Express)',
    scacCode: 'ONEY',
    vesselNames: ['ONE Commitment', 'ONE Continuity', 'ONE Contribution'],
    reliability: 'medium',
  },
  {
    name: 'Yang Ming Marine',
    scacCode: 'YMLU',
    vesselNames: ['YM Wellness', 'YM Witness', 'YM Worth'],
    reliability: 'medium',
  },
  {
    name: 'HMM (Hyundai Merchant Marine)',
    scacCode: 'HDMU',
    vesselNames: ['HMM Algeciras', 'HMM Copenhagen', 'HMM Dublin'],
    reliability: 'medium',
  },
  {
    name: 'ZIM Integrated Shipping',
    scacCode: 'ZIMU',
    vesselNames: ['ZIM Sammy Ofer', 'ZIM Antwerp', 'ZIM Rotterdam'],
    reliability: 'low',
  },
];

// ============================================================================
// SHIPPING ROUTES (High-Risk)
// ============================================================================

/**
 * Helper to get a port by code with type safety
 */
function getPort(code: string): MockPort {
  const port = MOCK_PORTS.find((p) => p.portCode === code);
  if (!port) {
    throw new Error(`Port not found: ${code}`);
  }
  return port;
}

export const MOCK_ROUTES: MockRoute[] = [
  // Asia to US West Coast - Typhoon season risk
  {
    name: 'China-LAX Express',
    departurePort: getPort('CNSHA'),
    destinationPort: getPort('USLAX'),
    transitDays: 14,
    riskScenarios: ['typhoon', 'port_congestion', 'tariff_risk'],
  },
  {
    name: 'Vietnam-Long Beach',
    departurePort: getPort('VNSGN'),
    destinationPort: getPort('USLGB'),
    transshipmentPorts: [getPort('SGSIN')],
    transitDays: 21,
    riskScenarios: ['flood', 'pandemic', 'piracy'],
  },
  {
    name: 'Bangladesh-NYC via Singapore',
    departurePort: getPort('BDCGP'),
    destinationPort: getPort('USNYC'),
    transshipmentPorts: [getPort('SGSIN')],
    transitDays: 35,
    riskScenarios: ['flood', 'labor_strike', 'port_congestion'],
  },
  {
    name: 'Taiwan-Oakland',
    departurePort: getPort('TWKHH'),
    destinationPort: getPort('USOAK'),
    transitDays: 16,
    riskScenarios: ['typhoon', 'earthquake', 'geopolitical'],
  },
  {
    name: 'India-Rotterdam',
    departurePort: getPort('INNSA'),
    destinationPort: getPort('NLRTM'),
    transshipmentPorts: [getPort('AEJEA')],
    transitDays: 28,
    riskScenarios: ['flood', 'labor_strike', 'piracy'],
  },
  {
    name: 'Philippines-Savannah via Busan',
    departurePort: getPort('PHMNS'),
    destinationPort: getPort('USSAV'),
    transshipmentPorts: [getPort('KRPUS')],
    transitDays: 25,
    riskScenarios: ['typhoon', 'earthquake', 'flood'],
  },
  {
    name: 'Shenzhen-LA Tech Route',
    departurePort: getPort('CNSZX'),
    destinationPort: getPort('USLAX'),
    transitDays: 15,
    riskScenarios: ['typhoon', 'cyber_risk', 'tariff_risk'],
  },
  {
    name: 'Ningbo-Long Beach',
    departurePort: getPort('CNNGB'),
    destinationPort: getPort('USLGB'),
    transitDays: 14,
    riskScenarios: ['typhoon', 'port_congestion', 'tariff_risk'],
  },
];

// ============================================================================
// PRODUCT DEFINITIONS
// ============================================================================

export const MOCK_PRODUCTS = [
  { description: "Men's 501 Original Fit Jeans", hsCode: '6203424510', category: 'jeans' },
  { description: "Men's 511 Slim Fit Jeans", hsCode: '6203424510', category: 'jeans' },
  { description: "Women's 721 High Rise Skinny", hsCode: '6204624010', category: 'jeans' },
  { description: "Women's Ribcage Straight", hsCode: '6204624010', category: 'jeans' },
  { description: "Men's Trucker Jacket", hsCode: '6201930020', category: 'jackets' },
  { description: "Women's Ex-Boyfriend Trucker", hsCode: '6202930020', category: 'jackets' },
  { description: "Men's Western Shirt", hsCode: '6205200020', category: 'shirts' },
  { description: "Women's Ultimate Western", hsCode: '6206300030', category: 'shirts' },
  { description: 'Graphic Tee', hsCode: '6109100012', category: 'tshirts' },
  { description: 'Logo Hoodie', hsCode: '6110201020', category: 'hoodies' },
  { description: "Men's Chino Pants", hsCode: '6203424520', category: 'pants' },
  { description: "Women's Wide Leg Trousers", hsCode: '6204624020', category: 'pants' },
  { description: 'Denim Shorts', hsCode: '6203424530', category: 'shorts' },
  { description: 'Premium Selvedge Denim', hsCode: '5209320000', category: 'fabric' },
  { description: 'Stretch Denim Fabric', hsCode: '5209410000', category: 'fabric' },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get ports by risk scenario
 */
export function getPortsByRisk(scenarios: RiskScenario[]): MockPort[] {
  if (scenarios.length === 0) return MOCK_PORTS;

  return MOCK_PORTS.filter((port) => port.riskFactors.some((risk) => scenarios.includes(risk)));
}

/**
 * Get suppliers by risk scenario
 */
export function getSuppliersByRisk(scenarios: RiskScenario[]): MockSupplier[] {
  if (scenarios.length === 0) return MOCK_SUPPLIERS;

  return MOCK_SUPPLIERS.filter((supplier) =>
    supplier.location.riskFactors.some((risk) => scenarios.includes(risk))
  );
}

/**
 * Get routes by risk scenario
 */
export function getRoutesByRisk(scenarios: RiskScenario[]): MockRoute[] {
  if (scenarios.length === 0) return MOCK_ROUTES;

  return MOCK_ROUTES.filter((route) =>
    route.riskScenarios.some((risk) => scenarios.includes(risk))
  );
}

/**
 * Get departure ports only
 */
export function getDeparturePorts(): MockPort[] {
  return MOCK_PORTS.filter((p) => p.type === 'departure');
}

/**
 * Get destination ports only
 */
export function getDestinationPorts(): MockPort[] {
  return MOCK_PORTS.filter((p) => p.type === 'destination');
}

/**
 * Get a random element from an array
 */
export function randomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Get a random number between min and max
 */
export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a random BOL number
 */
export function generateBolNumber(): string {
  const prefix = randomElement(['MAEU', 'MSCU', 'CMDU', 'COSU', 'EGLV']);
  const number = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${prefix}${number}`;
}

/**
 * Generate a random container ID
 */
export function generateContainerId(): string {
  const prefix = randomElement(['MSKU', 'MSCU', 'CMAU', 'COSU', 'EGHU']);
  const number = randomBetween(1000000, 9999999);
  const checkDigit = randomBetween(0, 9);
  return `${prefix}${number}${checkDigit}`;
}
