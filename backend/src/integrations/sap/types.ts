/**
 * SAP S/4HANA Cloud OData API Types
 *
 * These types mirror the SAP S/4HANA Cloud OData V2 API structures
 * for Business Partner, Material, Plant, and Logistics data.
 *
 * References:
 * - API_BUSINESS_PARTNER: https://api.sap.com/api/API_BUSINESS_PARTNER
 * - SAP OData V2 Specification: https://www.odata.org/documentation/odata-version-2-0/
 */

/**
 * OAuth 2.0 Token Response
 */
export interface SAPOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/**
 * SAP OData Response Wrapper
 */
export interface SAPODataResponse<T> {
  d: {
    results: T[];
    __count?: number;
  };
}

/**
 * SAP OData Single Entity Response
 */
export interface SAPODataSingleResponse<T> {
  d: T;
}

/**
 * Business Partner (Supplier/Customer)
 * API: API_BUSINESS_PARTNER
 */
export interface SAPBusinessPartner {
  BusinessPartner: string; // BP number (e.g., "0000100001")
  BusinessPartnerName: string;
  BusinessPartnerCategory: string; // "1" = Organization, "2" = Person
  BusinessPartnerGrouping: string;
  CreationDate: string; // ISO date
  CreationTime: string; // Time in format "PT00H00M00S"
  LastChangeDate: string;
  LastChangeTime: string;
  IsMarkedForDeletion?: boolean;
  BusinessPartnerIsBlocked?: boolean;
  // Navigation properties
  to_BusinessPartnerAddress?: SAPBusinessPartnerAddress[];
  to_Supplier?: SAPSupplier;
  to_Customer?: SAPCustomer;
}

/**
 * Business Partner Address
 */
export interface SAPBusinessPartnerAddress {
  BusinessPartner: string;
  AddressID: string;
  Country: string;
  Region?: string;
  CityName: string;
  StreetName?: string;
  PostalCode?: string;
  HouseNumber?: string;
  Language?: string;
  // Geocoding (if available)
  Latitude?: string;
  Longitude?: string;
}

/**
 * Supplier Extension
 */
export interface SAPSupplier {
  Supplier: string; // Same as BusinessPartner
  SupplierName: string;
  SupplierAccountGroup: string;
  CreationDate: string;
  IsBlockedForPosting?: boolean;
  PurchasingOrganization?: string;
  PaymentTerms?: string;
  IncotermsClassification?: string;
  // Custom fields for supply chain risk
  SupplierRiskScore?: number;
  SupplierTier?: number;
  IsCriticalSupplier?: boolean;
}

/**
 * Customer Extension
 */
export interface SAPCustomer {
  Customer: string;
  CustomerName: string;
  CustomerAccountGroup: string;
  CreationDate: string;
  SalesOrganization?: string;
  DistributionChannel?: string;
  Division?: string;
}

/**
 * Plant (Manufacturing/Warehouse Location)
 * API: Custom or API_GRMASTERDATA_SRV
 */
export interface SAPPlant {
  Plant: string; // 4-digit plant code (e.g., "1000")
  PlantName: string;
  Country: string;
  Region?: string;
  CityName: string;
  PostalCode?: string;
  StreetName?: string;
  // Geocoding
  Latitude?: string;
  Longitude?: string;
  // Plant classification
  PlantCategory?: string; // "A" = Manufacturing, "B" = Warehouse
  CompanyCode: string;
  SalesOrganization?: string;
  IsMarkedForDeletion?: boolean;
  // Supply chain specific
  PlantCapacity?: number;
  PlantUtilization?: number;
}

/**
 * Material Master Data
 * API: API_MATERIAL_SRV
 */
export interface SAPMaterial {
  Material: string; // 18-digit material number
  MaterialType: string; // "FERT" = Finished goods, "ROH" = Raw material
  MaterialGroup: string;
  MaterialBaseUnit: string; // UOM (e.g., "EA", "KG")
  MaterialDescription: string;
  CreationDate: string;
  LastChangeDate: string;
  // Procurement
  PurchasingGroup?: string;
  // Classification
  MaterialCategory?: string;
}

/**
 * Material Stock
 * API: API_MATERIAL_STOCK_SRV
 */
export interface SAPMaterialStock {
  Material: string;
  Plant: string;
  StorageLocation?: string;
  Batch?: string;
  StockType: string; // "01" = Unrestricted, "02" = Quality inspection
  MatlWrhsStkQtyInMatlBaseUnit: string; // Quantity as string
  MaterialBaseUnit: string;
  StockValueInDisplayCurrency?: string;
  Currency?: string;
  LastChangeDate: string;
}

/**
 * Purchase Order
 * API: API_PURCHASEORDER_PROCESS_SRV
 */
export interface SAPPurchaseOrder {
  PurchaseOrder: string;
  PurchaseOrderType: string;
  CompanyCode: string;
  PurchasingOrganization: string;
  PurchasingGroup: string;
  Supplier: string;
  CreationDate: string;
  DocumentDate: string;
  // Items
  to_PurchaseOrderItem?: SAPPurchaseOrderItem[];
}

/**
 * Purchase Order Item
 */
export interface SAPPurchaseOrderItem {
  PurchaseOrder: string;
  PurchaseOrderItem: string;
  Material: string;
  Plant: string;
  OrderQuantity: string;
  PurchaseOrderQuantityUnit: string;
  NetPriceAmount: string;
  Currency: string;
  DeliveryDate?: string;
  ScheduleLineDeliveryDate?: string;
}

/**
 * Shipment (Inbound/Outbound Delivery)
 * API: API_OUTBOUND_DELIVERY_SRV_0002
 */
export interface SAPShipment {
  DeliveryDocument: string;
  DeliveryDocumentType: string;
  CreationDate: string;
  CreationTime: string;
  ShipToParty?: string;
  ShipFromParty?: string;
  SoldToParty?: string;
  // Shipping
  ActualGoodsMovementDate?: string;
  PlannedGoodsIssueDate?: string;
  Route?: string;
  ShippingPoint?: string;
  ShipmentMode?: string; // "01" = Air, "02" = Ocean, "03" = Truck, "04" = Rail
  // Tracking
  TrackingNumber?: string;
  TransportationServiceLevel?: string;
  // Items
  to_DeliveryDocumentItem?: SAPShipmentItem[];
}

/**
 * Shipment Item
 */
export interface SAPShipmentItem {
  DeliveryDocument: string;
  DeliveryDocumentItem: string;
  Material: string;
  ActualDeliveryQuantity: string;
  DeliveryQuantityUnit: string;
  Batch?: string;
  Plant?: string;
  StorageLocation?: string;
}

/**
 * Shipping Lane (Custom Entity for Supply Chain Monitoring)
 */
export interface SAPShippingLane {
  ShippingLaneID: string;
  OriginPlant: string;
  DestinationPlant: string;
  ShipmentMode: string;
  Carrier?: string;
  TransitTimeInDays: number;
  Distance?: number; // in kilometers
  IsActive: boolean;
  // Route waypoints (simplified)
  RouteWaypoints?: Array<{
    latitude: number;
    longitude: number;
    locationName: string;
  }>;
}

/**
 * SAP S/4HANA Client Configuration
 */
export interface SAPClientConfig {
  baseUrl: string; // e.g., "https://my123456-api.s4hana.ondemand.com"
  clientId: string;
  clientSecret: string;
  tokenUrl?: string; // OAuth 2.0 token endpoint
  scope?: string;
  timeout?: number; // Request timeout in ms
  retryAttempts?: number;
}

/**
 * SAP Query Options (OData)
 */
export interface SAPQueryOptions {
  $filter?: string; // e.g., "Country eq 'US'"
  $select?: string; // e.g., "BusinessPartner,BusinessPartnerName"
  $expand?: string; // e.g., "to_BusinessPartnerAddress"
  $top?: number;
  $skip?: number;
  $orderby?: string;
  $count?: boolean;
  $format?: 'json' | 'xml';
}

/**
 * SAP API Error Response
 */
export interface SAPErrorResponse {
  error: {
    code: string;
    message: {
      lang: string;
      value: string;
    };
    innererror?: {
      application?: {
        component_id: string;
        service_namespace: string;
        service_id: string;
        service_version: string;
      };
      transactionid?: string;
      timestamp?: string;
      Error_Resolution?: {
        SAP_Transaction?: string;
        SAP_Note?: string;
      };
      errordetails?: Array<{
        code: string;
        message: string;
        propertyref?: string;
        severity?: string;
        target?: string;
      }>;
    };
  };
}
