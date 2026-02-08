/**
 * SAP S/4HANA Cloud Integration
 *
 * This module provides integration with SAP S/4HANA Cloud for ERP data synchronization.
 *
 * Exports:
 * - SAPClient: Main client for SAP API interactions
 * - sapClient: Singleton instance (mock mode by default)
 * - createSAPClient: Factory function
 * - All SAP types
 */

export * from './types.js';
export * from './client.js';
export * from './mock-api.js';
export { transformSAPDataToOrganizationContext } from './transformer.js';
