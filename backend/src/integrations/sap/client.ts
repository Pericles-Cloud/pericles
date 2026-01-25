/**
 * SAP S/4HANA Cloud Integration Client
 *
 * This client provides a unified interface for interacting with SAP S/4HANA Cloud APIs.
 * It supports both production (real SAP API) and mock modes for development/testing.
 *
 * Authentication: OAuth 2.0 Client Credentials flow
 * Protocol: OData V2/V4
 *
 * References:
 * - SAP Business Accelerator Hub: https://api.sap.com
 * - OAuth 2.0 Guide: https://help.sap.com/docs/SAP_S4HANA_CLOUD
 */

import type {
  SAPClientConfig,
  SAPOAuthTokenResponse,
  SAPBusinessPartner,
  SAPPlant,
  SAPMaterial,
  SAPMaterialStock,
  SAPShippingLane,
  SAPODataResponse,
  SAPODataSingleResponse,
  SAPQueryOptions,
  SAPErrorResponse,
} from './types';
import { mockSAPAPI } from './mock-api';

/**
 * SAP S/4HANA Cloud Client
 */
export class SAPClient {
  private config: SAPClientConfig;
  private accessToken?: string;
  private tokenExpiry?: Date;
  private useMock: boolean;

  constructor(config: SAPClientConfig, useMock = false) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      tokenUrl: `${config.baseUrl}/sap/bc/sec/oauth2/token`,
      scope: 'API_BUSINESS_PARTNER_0001 API_MATERIAL_STOCK_SRV_0001',
      ...config,
    };
    this.useMock = useMock;
  }

  /**
   * Authenticate with OAuth 2.0 Client Credentials
   */
  private async authenticate(): Promise<string> {
    // If using mock, return fake token
    if (this.useMock) {
      return 'mock-access-token';
    }

    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await fetch(this.config.tokenUrl ?? `${this.config.baseUrl}/sap/bc/sec/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${this.config.clientId}:${this.config.clientSecret}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: this.config.scope || '',
        }),
      });

      if (!response.ok) {
        throw new Error(`OAuth authentication failed: ${response.statusText}`);
      }

      const tokenData: SAPOAuthTokenResponse = await response.json();

      this.accessToken = tokenData.access_token;
      this.tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000);

      return this.accessToken;
    } catch (error) {
      throw new Error(`SAP OAuth authentication error: ${(error as Error).message}`);
    }
  }

  /**
   * Make authenticated OData request
   */
  private async odataRequest<T>(
    endpoint: string,
    options?: SAPQueryOptions
  ): Promise<T> {
    const token = await this.authenticate();

    // Build query string
    const queryParams = new URLSearchParams();
    if (options?.$filter) queryParams.append('$filter', options.$filter);
    if (options?.$select) queryParams.append('$select', options.$select);
    if (options?.$expand) queryParams.append('$expand', options.$expand);
    if (options?.$top) queryParams.append('$top', String(options.$top));
    if (options?.$skip) queryParams.append('$skip', String(options.$skip));
    if (options?.$orderby) queryParams.append('$orderby', options.$orderby);
    if (options?.$count) queryParams.append('$count', 'true');
    queryParams.append('$format', options?.$format || 'json');

    const url = `${this.config.baseUrl}${endpoint}?${queryParams.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(this.config.timeout ?? 30000),
      });

      if (!response.ok) {
        const errorData: SAPErrorResponse = await response.json();
        throw new Error(
          `SAP API Error: ${errorData.error.code} - ${errorData.error.message.value}`
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`SAP API request timeout after ${this.config.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Get Business Partners (Suppliers/Customers)
   */
  async getBusinessPartners(
    options?: SAPQueryOptions
  ): Promise<SAPODataResponse<SAPBusinessPartner>> {
    if (this.useMock) {
      return mockSAPAPI.getBusinessPartners(options);
    }

    return this.odataRequest<SAPODataResponse<SAPBusinessPartner>>(
      '/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner',
      options
    );
  }

  /**
   * Get Single Business Partner
   */
  async getBusinessPartner(
    businessPartnerId: string,
    options?: SAPQueryOptions
  ): Promise<SAPODataSingleResponse<SAPBusinessPartner>> {
    if (this.useMock) {
      return mockSAPAPI.getBusinessPartner(businessPartnerId, options);
    }

    return this.odataRequest<SAPODataSingleResponse<SAPBusinessPartner>>(
      `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('${businessPartnerId}')`,
      options
    );
  }

  /**
   * Get Plants
   */
  async getPlants(options?: SAPQueryOptions): Promise<SAPODataResponse<SAPPlant>> {
    if (this.useMock) {
      return mockSAPAPI.getPlants(options);
    }

    // Note: In production, this might be a custom API or API_GRMASTERDATA_SRV
    return this.odataRequest<SAPODataResponse<SAPPlant>>(
      '/sap/opu/odata/sap/API_PLANT_SRV/A_Plant',
      options
    );
  }

  /**
   * Get Single Plant
   */
  async getPlant(
    plantId: string,
    options?: SAPQueryOptions
  ): Promise<SAPODataSingleResponse<SAPPlant>> {
    if (this.useMock) {
      return mockSAPAPI.getPlant(plantId, options);
    }

    return this.odataRequest<SAPODataSingleResponse<SAPPlant>>(
      `/sap/opu/odata/sap/API_PLANT_SRV/A_Plant('${plantId}')`,
      options
    );
  }

  /**
   * Get Materials
   */
  async getMaterials(options?: SAPQueryOptions): Promise<SAPODataResponse<SAPMaterial>> {
    if (this.useMock) {
      return mockSAPAPI.getMaterials(options);
    }

    return this.odataRequest<SAPODataResponse<SAPMaterial>>(
      '/sap/opu/odata/sap/API_MATERIAL_SRV/A_Material',
      options
    );
  }

  /**
   * Get Material Stock by Plant
   */
  async getMaterialStock(
    plantId: string,
    options?: SAPQueryOptions
  ): Promise<SAPODataResponse<SAPMaterialStock>> {
    if (this.useMock) {
      return mockSAPAPI.getMaterialStock(plantId, options);
    }

    return this.odataRequest<SAPODataResponse<SAPMaterialStock>>(
      '/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MaterialStock',
      {
        ...options,
        $filter: options?.$filter
          ? `${options.$filter} and Plant eq '${plantId}'`
          : `Plant eq '${plantId}'`,
      }
    );
  }

  /**
   * Get Shipping Lanes (Custom API)
   */
  async getShippingLanes(
    options?: SAPQueryOptions
  ): Promise<SAPODataResponse<SAPShippingLane>> {
    if (this.useMock) {
      return mockSAPAPI.getShippingLanes(options);
    }

    // This would be a custom Z-API in production SAP
    return this.odataRequest<SAPODataResponse<SAPShippingLane>>(
      '/sap/opu/odata/sap/Z_SHIPPING_LANES_SRV/ShippingLanes',
      options
    );
  }

  /**
   * Health Check
   */
  async healthCheck(): Promise<{ status: 'ok' | 'error'; timestamp: string; mode: string }> {
    try {
      if (this.useMock) {
        const result = await mockSAPAPI.healthCheck();
        return { ...result, mode: 'mock' };
      }

      // For production, try to authenticate
      await this.authenticate();
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        mode: 'production',
      };
    } catch (_error) {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        mode: this.useMock ? 'mock' : 'production',
      };
    }
  }
}

/**
 * Create SAP Client from environment variables
 */
export function createSAPClient(useMock = true): SAPClient {
  const config: SAPClientConfig = {
    baseUrl: process.env.SAP_S4HANA_BASE_URL || 'https://mock-sap.s4hana.ondemand.com',
    clientId: process.env.SAP_S4HANA_CLIENT_ID || 'mock-client-id',
    clientSecret: process.env.SAP_S4HANA_CLIENT_SECRET || 'mock-client-secret',
    timeout: parseInt(process.env.SAP_S4HANA_TIMEOUT || '30000'),
  };

  return new SAPClient(config, useMock);
}

/**
 * Singleton instance (mock mode by default for development)
 */
export const sapClient = createSAPClient(
  process.env.SAP_S4HANA_USE_MOCK !== 'false' // Default to mock unless explicitly disabled
);
