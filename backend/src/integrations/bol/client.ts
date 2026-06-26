/**
 * BOL trial adapter — Apify client.
 *
 * Thin wrapper over the Apify run-sync-get-dataset-items endpoint to pull
 * bill-of-lading rows from an ImportYeti-style actor and normalize them into
 * BolRow[]. Keep the actor id + field mapping in ONE place so swapping actors
 * (jungle_synthesizer / khadinakbar / parseforge) is a config change.
 *
 * Apify pay-per-event pricing makes a trial pull cost cents; see the Atlas Data
 * Sourcing decision page. Trial only — at production scale, prefer a licensed
 * customs feed with redistribution rights (CBP AMS source) over scraping.
 */

import type { BolRow } from './types.js';

const UA = 'Pericles-SupplyChainMonitor/1.0 (contact@pericles.cloud)';

export interface ApifyBolClientConfig {
  apifyToken?: string;
  /** Actor that returns row-level BOLs (not aggregate-only). */
  actorId?: string;
}

/** Raw actor output is loosely typed; map defensively. */
type RawRecord = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
}
function strArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x): x is string => typeof x === 'string')
    ? v
    : undefined;
}

/**
 * Best-effort parse of a US importer address into city + state. ImportYeti's
 * `target_address` looks like "1500 W University Pkwy, Sarasota, Fl 34243, Us";
 * we key off the "ST 12345" segment and take the segment before it as the city.
 * Returns {} when no zip-qualified state is found (geocoding then skips the row).
 */
function parseUsAddress(addr: string | undefined): { city?: string; state?: string } {
  if (!addr) return {};
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const m = /^([A-Za-z]{2})\s+\d{5}(?:-\d{4})?$/.exec(parts[i]);
    if (m) return { city: parts[i - 1], state: m[1].toUpperCase() };
  }
  return {};
}

/**
 * Map a raw actor record to a normalized BolRow. Primary field names match the
 * ImportYeti row-level actor (jungle_synthesizer/importyeti-bill-of-lading-scraper):
 * the foreign supplier is the `counterparty_*`, the US importer is `target_*`,
 * and the actor emits no port (the US side is the importer address). Older
 * generic aliases are kept as fallbacks so other actor variants still map.
 */
export function normalizeRecord(r: RawRecord): BolRow | null {
  // Skip the aggregate rollup row the actor emits per company.
  if ((str(r.record_type) ?? str(r.recordType)) === 'summary') return null;

  const bol =
    str(r.bill_of_lading) ?? str(r.master_bill_of_lading) ??
    str(r.bolNumber) ?? str(r.billOfLading) ?? str(r.houseBol) ?? str(r.masterBol);
  const supplier =
    str(r.counterparty_name) ??
    str(r.supplierName) ?? str(r.shipper) ?? str(r.foreignSupplier) ?? str(r.counterparty);
  if (!bol || !supplier) return null;

  const dest = parseUsAddress(str(r.target_address));

  return {
    bol_number: bol,
    shipment_date:
      str(r.arrival_date) ?? str(r.shipmentDate) ?? str(r.date) ?? new Date().toISOString(),
    supplier_name: supplier,
    supplier_city: str(r.counterparty_city) ?? str(r.supplierCity) ?? str(r.shipperCity) ?? str(r.city),
    supplier_country:
      str(r.counterparty_country) ?? str(r.supplierCountry) ?? str(r.shipperCountry) ?? str(r.country),
    consignee_name:
      str(r.target_name) ?? str(r.consigneeName) ?? str(r.importer) ?? str(r.usConsignee) ?? 'Unknown Consignee',
    destination_city: dest.city ?? str(r.destinationCity) ?? str(r.portOfUnlading) ?? str(r.usPort),
    destination_state: dest.state ?? str(r.destinationState) ?? str(r.state),
    destination_country: str(r.destinationCountry) ?? 'US',
    origin_port: str(r.originPort) ?? str(r.portOfLading),
    carrier_scac: str(r.carrier_code) ?? str(r.carrierScac) ?? str(r.scac) ?? str(r.carrier),
    weight_kg: num(r.weight_kg) ?? num(r.weightKg) ?? num(r.weight),
    quantity: num(r.quantity) ?? num(r.qty),
    containers: num(r.container_count) ?? num(r.containers) ?? num(r.containerCount) ?? num(r.teu),
    product_description: str(r.product_description) ?? str(r.productDescription) ?? str(r.description) ?? str(r.goods),
    hs_codes: strArray(r.hs_codes) ?? strArray(r.hsCodes),
  };
}

/**
 * Pull BOL rows for one or more importer/supplier slugs via Apify.
 * `input` is passed through verbatim to the actor; for the default ImportYeti
 * actor the shape is `{ companies: string[], suppliers: string[] }` (slugs from
 * importyeti.com/company/<slug>). Shape depends on the chosen actor.
 */
export async function fetchBolRows(
  input: Record<string, unknown>,
  config: ApifyBolClientConfig = {},
): Promise<BolRow[]> {
  const token = config.apifyToken ?? process.env.APIFY_TOKEN;
  const actorId =
    config.actorId ??
    process.env.APIFY_BOL_ACTOR ??
    'jungle_synthesizer~importyeti-bill-of-lading-scraper';
  if (!token) throw new Error('APIFY_TOKEN not set');

  const url =
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items` +
    `?token=${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120000), // actor runs can take a minute+
  });
  if (!res.ok) {
    throw new Error(`Apify actor ${actorId} failed: ${res.status} ${res.statusText}`);
  }
  const records = (await res.json()) as RawRecord[];
  return records
    .map(normalizeRecord)
    .filter((r): r is BolRow => r !== null);
}
