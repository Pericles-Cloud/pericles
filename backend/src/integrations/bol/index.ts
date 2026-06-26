/**
 * BOL trial adapter — public surface.
 *
 * Usage (trial seed for the Atlas MVP):
 *
 *   import { fetchBolRows } from './client.js';
 *   import { createGoogleGeocoder } from './geocode.js';
 *   import { transformBolDataToOrganizationContext } from './transformer.js';
 *
 *   // One call ties it together and persists the trial tenant's context:
 *   import { syncBolContextForOrganization } from './sync-service.js';
 *   await syncBolContextForOrganization(orgId, { input: { companySlugs: ['allient'] } });
 *   // → upserts OrganizationContext (same shape as SAP); Atlas then renders it.
 *
 *   // CLI: npm run bol:seed -- --org-id=<uuid> --company=allient --verbose
 */

export type {
  BolRow,
  GeoPoint,
  Geocoder,
  BolTransformOptions,
} from './types.js';
export { fetchBolRows, normalizeRecord } from './client.js';
export { createGoogleGeocoder, createStubGeocoder } from './geocode.js';
export { transformBolDataToOrganizationContext } from './transformer.js';
export {
  syncBolContextForOrganization,
  type SyncBolOptions,
  type SyncBolResult,
} from './sync-service.js';
