/**
 * BOL trial adapter — public surface.
 *
 * Usage (trial seed for the Atlas MVP):
 *
 *   import { fetchBolRows } from './client.js';
 *   import { createGoogleGeocoder } from './geocode.js';
 *   import { transformBolDataToOrganizationContext } from './transformer.js';
 *
 *   const rows = await fetchBolRows({ companySlugs: ['allient'] });
 *   const geocode = createGoogleGeocoder({ kv });          // cached
 *   const context = await transformBolDataToOrganizationContext(rows, geocode);
 *   // → OrganizationContextData, identical shape to the SAP adapter output.
 *   //   Persist as the trial tenant's OrganizationContext and Atlas renders it.
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
