/**
 * Mock SAP S/4HANA Cloud API Service
 *
 * This mock service simulates SAP S/4HANA Cloud OData APIs for development and testing.
 * It provides realistic responses for Levi Strauss & Co. supply chain data.
 *
 * In production, this would be replaced with actual SAP API calls.
 */

import type {
  SAPBusinessPartner,
  SAPPlant,
  SAPMaterial,
  SAPMaterialStock,
  SAPShippingLane,
  SAPODataResponse,
  SAPODataSingleResponse,
  SAPQueryOptions,
} from './types.js';

/**
 * Mock Levi Strauss Suppliers (matching CSV data)
 */
const MOCK_SUPPLIERS: SAPBusinessPartner[] = [
  {
    BusinessPartner: '0000100001',
    BusinessPartnerName: 'Saitex International',
    BusinessPartnerCategory: '1',
    BusinessPartnerGrouping: 'SUPPLIER',
    CreationDate: '2020-01-15',
    CreationTime: 'PT09H00M00S',
    LastChangeDate: '2025-01-10',
    LastChangeTime: 'PT14H30M00S',
    to_BusinessPartnerAddress: [
      {
        BusinessPartner: '0000100001',
        AddressID: 'ADDR001',
        Country: 'VN',
        CityName: 'Ho Chi Minh City',
        PostalCode: '700000',
        Latitude: '10.8231',
        Longitude: '106.6297',
      },
    ],
    to_Supplier: {
      Supplier: '0000100001',
      SupplierName: 'Saitex International',
      SupplierAccountGroup: 'ZDENIM',
      CreationDate: '2020-01-15',
      PurchasingOrganization: 'LS01',
      PaymentTerms: 'NT30',
      IncotermsClassification: 'FOB',
      SupplierTier: 1,
      IsCriticalSupplier: true,
      SupplierRiskScore: 0.25,
    },
  },
  {
    BusinessPartner: '0000100002',
    BusinessPartnerName: 'Nien Hsing Textile Co.',
    BusinessPartnerCategory: '1',
    BusinessPartnerGrouping: 'SUPPLIER',
    CreationDate: '2019-03-20',
    CreationTime: 'PT10H15M00S',
    LastChangeDate: '2025-01-05',
    LastChangeTime: 'PT16H45M00S',
    to_BusinessPartnerAddress: [
      {
        BusinessPartner: '0000100002',
        AddressID: 'ADDR002',
        Country: 'TW',
        CityName: 'Tainan',
        PostalCode: '710',
        Latitude: '22.9998',
        Longitude: '120.2269',
      },
    ],
    to_Supplier: {
      Supplier: '0000100002',
      SupplierName: 'Nien Hsing Textile Co.',
      SupplierAccountGroup: 'ZDENIM',
      CreationDate: '2019-03-20',
      PurchasingOrganization: 'LS01',
      PaymentTerms: 'NT45',
      IncotermsClassification: 'CIF',
      SupplierTier: 1,
      IsCriticalSupplier: true,
      SupplierRiskScore: 0.18,
    },
  },
  {
    BusinessPartner: '0000100003',
    BusinessPartnerName: 'Arvind Limited',
    BusinessPartnerCategory: '1',
    BusinessPartnerGrouping: 'SUPPLIER',
    CreationDate: '2018-06-10',
    CreationTime: 'PT11H30M00S',
    LastChangeDate: '2024-12-20',
    LastChangeTime: 'PT08H20M00S',
    to_BusinessPartnerAddress: [
      {
        BusinessPartner: '0000100003',
        AddressID: 'ADDR003',
        Country: 'IN',
        CityName: 'Ahmedabad',
        Region: 'GJ',
        PostalCode: '380015',
        Latitude: '23.0225',
        Longitude: '72.5714',
      },
    ],
    to_Supplier: {
      Supplier: '0000100003',
      SupplierName: 'Arvind Limited',
      SupplierAccountGroup: 'ZFABRIC',
      CreationDate: '2018-06-10',
      PurchasingOrganization: 'LS01',
      PaymentTerms: 'NT60',
      IncotermsClassification: 'FOB',
      SupplierTier: 1,
      IsCriticalSupplier: true,
      SupplierRiskScore: 0.42,
    },
  },
];

/**
 * Mock Levi Strauss Plants (Manufacturing & Distribution Centers)
 */
const MOCK_PLANTS: SAPPlant[] = [
  {
    Plant: '1000',
    PlantName: 'San Francisco DC',
    Country: 'US',
    Region: 'CA',
    CityName: 'San Francisco',
    PostalCode: '94102',
    StreetName: '1155 Battery Street',
    Latitude: '37.7749',
    Longitude: '-122.4194',
    PlantCategory: 'B', // Warehouse
    CompanyCode: 'LS01',
    SalesOrganization: 'LSUS',
    PlantCapacity: 500000,
    PlantUtilization: 78,
  },
  {
    Plant: '2000',
    PlantName: 'Memphis DC',
    Country: 'US',
    Region: 'TN',
    CityName: 'Memphis',
    PostalCode: '38125',
    StreetName: '3575 Pilot Drive',
    Latitude: '35.1495',
    Longitude: '-90.0490',
    PlantCategory: 'B',
    CompanyCode: 'LS01',
    SalesOrganization: 'LSUS',
    PlantCapacity: 750000,
    PlantUtilization: 85,
  },
  {
    Plant: '3000',
    PlantName: 'El Paso Manufacturing',
    Country: 'US',
    Region: 'TX',
    CityName: 'El Paso',
    PostalCode: '79936',
    StreetName: '9901 Gateway Boulevard West',
    Latitude: '31.7619',
    Longitude: '-106.4850',
    PlantCategory: 'A', // Manufacturing
    CompanyCode: 'LS01',
    SalesOrganization: 'LSUS',
    PlantCapacity: 250000,
    PlantUtilization: 92,
  },
  {
    Plant: '4000',
    PlantName: 'Rotterdam DC',
    Country: 'NL',
    CityName: 'Rotterdam',
    PostalCode: '3045 PM',
    StreetName: 'Marconistraat 16',
    Latitude: '51.9225',
    Longitude: '4.4792',
    PlantCategory: 'B',
    CompanyCode: 'LSEU',
    SalesOrganization: 'LSEU',
    PlantCapacity: 600000,
    PlantUtilization: 72,
  },
  {
    Plant: '5000',
    PlantName: 'Shanghai DC',
    Country: 'CN',
    CityName: 'Shanghai',
    PostalCode: '201315',
    StreetName: 'Pudong New Area',
    Latitude: '31.2304',
    Longitude: '121.4737',
    PlantCategory: 'B',
    CompanyCode: 'LSAP',
    SalesOrganization: 'LSAP',
    PlantCapacity: 800000,
    PlantUtilization: 88,
  },
];

/**
 * Mock Materials (Denim Products)
 */
const MOCK_MATERIALS: SAPMaterial[] = [
  {
    Material: '000000000000501000',
    MaterialType: 'FERT',
    MaterialGroup: 'DENIM',
    MaterialBaseUnit: 'EA',
    MaterialDescription: "Levi's 501 Original Fit Jeans - Men's",
    CreationDate: '2015-01-01',
    LastChangeDate: '2024-06-15',
    PurchasingGroup: 'D01',
    MaterialCategory: 'FINISHED_GOODS',
  },
  {
    Material: '000000000000511000',
    MaterialType: 'FERT',
    MaterialGroup: 'DENIM',
    MaterialBaseUnit: 'EA',
    MaterialDescription: "Levi's 511 Slim Fit Jeans - Men's",
    CreationDate: '2015-01-01',
    LastChangeDate: '2024-08-20',
    PurchasingGroup: 'D01',
    MaterialCategory: 'FINISHED_GOODS',
  },
  {
    Material: '000000000000721000',
    MaterialType: 'FERT',
    MaterialGroup: 'DENIM',
    MaterialBaseUnit: 'EA',
    MaterialDescription: "Levi's 721 High Rise Skinny Jeans - Women's",
    CreationDate: '2016-03-15',
    LastChangeDate: '2024-09-10',
    PurchasingGroup: 'D01',
    MaterialCategory: 'FINISHED_GOODS',
  },
  {
    Material: '000000000010001000',
    MaterialType: 'ROH',
    MaterialGroup: 'FABRIC',
    MaterialBaseUnit: 'MTR',
    MaterialDescription: 'Indigo Denim Fabric - 14oz',
    CreationDate: '2014-01-01',
    LastChangeDate: '2024-11-05',
    PurchasingGroup: 'F01',
    MaterialCategory: 'RAW_MATERIAL',
  },
];

/**
 * Mock Shipping Lanes
 */
const MOCK_SHIPPING_LANES: SAPShippingLane[] = [
  {
    ShippingLaneID: 'LANE001',
    OriginPlant: '1000', // San Francisco
    DestinationPlant: '2000', // Memphis
    ShipmentMode: '03', // Truck
    Carrier: 'Schneider National',
    TransitTimeInDays: 4,
    Distance: 2977,
    IsActive: true,
  },
  {
    ShippingLaneID: 'LANE002',
    OriginPlant: '3000', // El Paso
    DestinationPlant: '1000', // San Francisco
    ShipmentMode: '04', // Rail
    Carrier: 'BNSF Railway',
    TransitTimeInDays: 5,
    Distance: 1242,
    IsActive: true,
  },
  {
    ShippingLaneID: 'LANE003',
    OriginPlant: '5000', // Shanghai
    DestinationPlant: '1000', // San Francisco
    ShipmentMode: '02', // Ocean
    Carrier: 'Maersk Line',
    TransitTimeInDays: 18,
    Distance: 10250,
    IsActive: true,
    RouteWaypoints: [
      { latitude: 31.2304, longitude: 121.4737, locationName: 'Shanghai Port' },
      { latitude: 35.4437, longitude: 139.638, locationName: 'Tokyo' },
      { latitude: 21.3099, longitude: -157.8581, locationName: 'Honolulu' },
      { latitude: 37.7749, longitude: -122.4194, locationName: 'San Francisco' },
    ],
  },
  {
    ShippingLaneID: 'LANE004',
    OriginPlant: '4000', // Rotterdam
    DestinationPlant: '1000', // San Francisco
    ShipmentMode: '02', // Ocean
    Carrier: 'MSC Mediterranean Shipping',
    TransitTimeInDays: 25,
    Distance: 13500,
    IsActive: true,
    RouteWaypoints: [
      { latitude: 51.9225, longitude: 4.4792, locationName: 'Rotterdam Port' },
      { latitude: 36.1408, longitude: -5.3536, locationName: 'Gibraltar' },
      { latitude: 9.0765, longitude: -79.5845, locationName: 'Panama Canal' },
      { latitude: 37.7749, longitude: -122.4194, locationName: 'San Francisco' },
    ],
  },
];

/**
 * Mock SAP API Client
 */
export class MockSAPAPI {
  private baseUrl: string;

  constructor(baseUrl = 'https://mock-sap.s4hana.ondemand.com') {
    this.baseUrl = baseUrl;
  }

  /**
   * Simulate network delay
   */
  private async simulateDelay(ms = 200): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Apply OData query options to filter results
   */
  private applyQueryOptions<T>(data: T[], options?: SAPQueryOptions): T[] {
    let result = [...data];

    // Simple $filter implementation (supports basic equality checks)
    if (options?.$filter) {
      const filterMatch = /(\w+)\s+eq\s+'([^']+)'/.exec(options.$filter);
      if (filterMatch) {
        const [, field, value] = filterMatch;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic field access for OData filter
        result = result.filter((item: any) => item[field] === value);
      }
    }

    // $top
    if (options?.$top) {
      result = result.slice(0, options.$top);
    }

    // $skip
    if (options?.$skip) {
      result = result.slice(options.$skip);
    }

    return result;
  }

  /**
   * Get Business Partners (Suppliers/Customers)
   */
  async getBusinessPartners(
    options?: SAPQueryOptions
  ): Promise<SAPODataResponse<SAPBusinessPartner>> {
    await this.simulateDelay();

    const filtered = this.applyQueryOptions(MOCK_SUPPLIERS, options);

    return {
      d: {
        results: filtered,
        __count: MOCK_SUPPLIERS.length,
      },
    };
  }

  /**
   * Get Single Business Partner
   */
  async getBusinessPartner(
    businessPartnerId: string,
    _options?: SAPQueryOptions
  ): Promise<SAPODataSingleResponse<SAPBusinessPartner>> {
    await this.simulateDelay();

    const partner = MOCK_SUPPLIERS.find((s) => s.BusinessPartner === businessPartnerId);

    if (!partner) {
      throw new Error(`Business Partner ${businessPartnerId} not found`);
    }

    return { d: partner };
  }

  /**
   * Get Plants
   */
  async getPlants(options?: SAPQueryOptions): Promise<SAPODataResponse<SAPPlant>> {
    await this.simulateDelay();

    const filtered = this.applyQueryOptions(MOCK_PLANTS, options);

    return {
      d: {
        results: filtered,
        __count: MOCK_PLANTS.length,
      },
    };
  }

  /**
   * Get Single Plant
   */
  async getPlant(
    plantId: string,
    _options?: SAPQueryOptions
  ): Promise<SAPODataSingleResponse<SAPPlant>> {
    await this.simulateDelay();

    const plant = MOCK_PLANTS.find((p) => p.Plant === plantId);

    if (!plant) {
      throw new Error(`Plant ${plantId} not found`);
    }

    return { d: plant };
  }

  /**
   * Get Materials
   */
  async getMaterials(options?: SAPQueryOptions): Promise<SAPODataResponse<SAPMaterial>> {
    await this.simulateDelay();

    const filtered = this.applyQueryOptions(MOCK_MATERIALS, options);

    return {
      d: {
        results: filtered,
        __count: MOCK_MATERIALS.length,
      },
    };
  }

  /**
   * Get Shipping Lanes (Custom API)
   */
  async getShippingLanes(
    options?: SAPQueryOptions
  ): Promise<SAPODataResponse<SAPShippingLane>> {
    await this.simulateDelay();

    const filtered = this.applyQueryOptions(MOCK_SHIPPING_LANES, options);

    return {
      d: {
        results: filtered,
        __count: MOCK_SHIPPING_LANES.length,
      },
    };
  }

  /**
   * Get Material Stock by Plant
   */
  async getMaterialStock(
    plantId: string,
    options?: SAPQueryOptions
  ): Promise<SAPODataResponse<SAPMaterialStock>> {
    await this.simulateDelay();

    // Generate mock stock data for the plant
    const mockStock: SAPMaterialStock[] = MOCK_MATERIALS.filter(
      (m) => m.MaterialType === 'FERT'
    ).map((material) => ({
      Material: material.Material,
      Plant: plantId,
      StorageLocation: 'FG01',
      StockType: '01',
      MatlWrhsStkQtyInMatlBaseUnit: String(Math.floor(Math.random() * 10000) + 1000),
      MaterialBaseUnit: material.MaterialBaseUnit,
      StockValueInDisplayCurrency: String(
        Math.floor(Math.random() * 500000) + 50000
      ),
      Currency: 'USD',
      LastChangeDate: '2025-12-13',
    }));

    const filtered = this.applyQueryOptions(mockStock, options);

    return {
      d: {
        results: filtered,
        __count: mockStock.length,
      },
    };
  }

  /**
   * Health Check
   */
  async healthCheck(): Promise<{ status: 'ok'; timestamp: string }> {
    await this.simulateDelay(50);
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Singleton instance
 */
export const mockSAPAPI = new MockSAPAPI();
