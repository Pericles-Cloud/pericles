# BOL Trial Adapter (`integrations/bol`)

Seeds a trial tenant's `OrganizationContext` from **public US customs bill-of-lading
data** so the **Atlas MVP renders on the map without a live ERP**. It emits the exact
same `OrganizationContextData` shape as the SAP adapter (`integrations/sap`), so trial
data flows through the identical downstream Atlas + monitoring path. Effectively a
second ERP-style adapter — it validates the `pericles-erp-adapter` pattern with zero
throwaway work.

> **Trial only.** Scraping ImportYeti via Apify is a ToS gray area; the underlying data
> is public CBP AMS. Fine for an MVP/demo. At production scale, swap the client for a
> licensed customs feed with redistribution rights — Pericles resells this intelligence.
> Track that as an ADR (see the Atlas Data Sourcing decision page in Notion).

## Pipeline

```
Apify actor ─► client.fetchBolRows ─► BolRow[] ─► transformBolDataToOrganizationContext
                                                        │  (geocode via Google, cached)
                                                        ▼
                                              OrganizationContextData
                                       { plants, warehouses, suppliers,
                                         shipping_lanes, risk_preferences }
                                                        │
                                                        ▼
                                  persist as the trial tenant's OrganizationContext
                                                        │
                                                        ▼
                                          Atlas renders suppliers / lanes / dests
```

## Mapping

| BOL concept | OrganizationContextData |
| --- | --- |
| Foreign shipper (manufacturer/exporter) | `suppliers[]` — geocoded, `tier: 1`, `critical` by shipment volume |
| Distinct US destinations (port of unlading / consignee city) | `plants[]` (`plant_type: import_destination`) |
| (warehouses) | `[]` — BOL can't distinguish; left empty rather than guessed |
| Each (supplier origin → US destination) pair | `shipping_lanes[]` — `mode: SEA`, `carrier` = SCAC, `transit_days` estimated |
| risk_preferences | default set (identical to the SAP adapter) |

Transit days are estimated from great-circle distance (the same Haversine the monitoring
pipeline uses) ÷ ~833 km/day (~18 kn). Good enough for Atlas route arcs at MVP; swap for
real sea-route geometry (e.g. Searoutes) later — already logged as an open question in
`pericles-atlas-ui`.

## Usage

```ts
import {
  fetchBolRows,
  createGoogleGeocoder,
  transformBolDataToOrganizationContext,
} from './integrations/bol/index.js';

const rows = await fetchBolRows({ companySlugs: ['allient'] }); // actor input
const geocode = createGoogleGeocoder({ kv });                   // cached in KeyValueStore
const context = await transformBolDataToOrganizationContext(rows, geocode);
// → persist `context` as the trial tenant's OrganizationContext
```

### Env

- `APIFY_TOKEN` — Apify account token.
- `APIFY_BOL_ACTOR` — actor id (default `jungle_synthesizer~importyeti-bill-of-lading-scraper`); use a **row-level** actor, not an aggregate-only one.
- `GOOGLE_MAPS_API_KEY` — for geocoding (same Google account as the frontend maps). If unset, a built-in gazetteer covers common lanes so a trial can run keyless.

### Offline / keyless

`createStubGeocoder({})` plus the built-in gazetteer lets the transform run with no API
keys — used by `transformer.test.ts` and handy for a first dry run.

## Tests

`transformer.test.ts` (Vitest) covers shape, ghost-supplier dropping, critical/tier
tagging, SEA lane construction with realistic transit estimates, and dropped-endpoint
lane skipping. Run once `vitest` is wired (`pericles-testing`).
