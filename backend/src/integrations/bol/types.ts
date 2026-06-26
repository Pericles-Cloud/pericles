/**
 * Bill of Lading (BOL) trial adapter — input types.
 *
 * Normalized shape for US customs bill-of-lading rows pulled via an Apify
 * ImportYeti-style actor. Field names follow the common denominator across the
 * row-level actors (jungle_synthesizer / khadinakbar / parseforge variants).
 *
 * This adapter exists to seed `OrganizationContextData` for the Atlas MVP from
 * public customs data, so a trial tenant renders on the map WITHOUT a live ERP.
 * It deliberately mirrors the SAP adapter so the trial data flows through the
 * exact same downstream path (see ./transformer.ts → OrganizationContextData,
 * identical to integrations/sap/transformer.ts).
 *
 * Companion build skill: pericles-erp-adapter (new adapters behind MCP; SAP +
 * this BOL adapter are the reference templates).
 */

/** One normalized bill-of-lading row (one ocean shipment). */
export interface BolRow {
  /** House or master BOL number — the natural shipment key. */
  bol_number: string;
  /** ISO date string of arrival/shipment (best available). */
  shipment_date: string;

  /** Foreign supplier / shipper (the manufacturer or exporter). */
  supplier_name: string;
  supplier_city?: string;
  supplier_country?: string;

  /** US importer / consignee (the trial company / branded subsidiary). */
  consignee_name: string;
  /**
   * Stable slug for the importer entity (ImportYeti `target_slug`), when present.
   * The reliable grouping key for splitting rows per branded subsidiary —
   * `consignee_name` can vary in spelling across rows. See pericles-data-model.
   */
  consignee_slug?: string;
  /** US destination — typically port of unlading; sometimes inland city. */
  destination_city?: string;
  destination_state?: string;
  destination_country?: string; // usually 'US'

  /** Origin port of lading, when present. */
  origin_port?: string;

  /** Carrier SCAC code, when present. */
  carrier_scac?: string;

  /** Shipment magnitude — any subset may be present. */
  weight_kg?: number;
  quantity?: number;
  containers?: number;

  /** Free-text product description + any HS rollups. */
  product_description?: string;
  hs_codes?: string[];
}

/** A geocoded place: name → coordinates. The adapter is geocoder-agnostic. */
export interface GeoPoint {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * Pluggable geocoder. In production, back this with Google Geocoding (the app
 * already uses @react-google-maps/api) cached in KeyValueStore. In tests, pass
 * a stub map. Returns null when a place can't be resolved (the row degrades
 * gracefully rather than throwing — see pericles-external-feeds).
 */
export type Geocoder = (query: string) => Promise<GeoPoint | null>;

/** Tuning knobs for the transform (sensible trial defaults in transformer). */
export interface BolTransformOptions {
  /** A supplier at/above this shipment count is flagged critical. */
  criticalShipmentThreshold?: number;
  /** Average ocean speed (km/day) for transit-day estimation. ~18 kn. */
  oceanKmPerDay?: number;
  /** Drop suppliers with fewer than this many shipments (ghost records). */
  minShipmentsPerSupplier?: number;
}
