# Scrape inputs & slug discovery (ImportYeti via Apify)

How to turn a customer into the actor input the onboarding pipeline scrapes.

## Finding slugs

ImportYeti company URLs are `importyeti.com/company/<slug>`. The `<slug>` is the
stable key the actor takes in `companies`. To onboard a holding company, find the
slug of EACH branded operating unit (importer), not just the parent — customs
records file under the importing brand.

- Search the brand on importyeti.com, open its company page, copy the slug.
- Prefer standalone brand slugs over a renamed-parent slug (see Allient below).
- Foreign suppliers have their own slugs; pass them in `suppliers` to pull from
  the supplier side instead of (or in addition to) the importer side.

## Actor input shape

```jsonc
{
  "companies": ["sun-hydraulics", "faster"],   // importer slugs
  "suppliers": [],                               // foreign-supplier slugs
  "maxItems": 1000                               // lift the actor's 50 default
}
```

Default actor: `jungle_synthesizer~importyeti-bill-of-lading-scraper` (override
with `APIFY_BOL_ACTOR`). Must be row-level (one record per shipment), not the
aggregate-only variant. Needs `APIFY_TOKEN`.

## Verified trial sets (June 2026)

### Helios Technologies — CHOSEN first trial
Balanced China/Italy lanes, clean standalone-brand slugs, reliable sea freight.

```
sun-hydraulics, faster, enovation-controls, balboa-water-group, daman-products
```

### Standex International — viable alternative
China-concentrated plus Mexico nearshore. Use if a second trial tenant is wanted.

### Allient Inc. — DEFERRED, slug nuance
Do NOT scrape `allient`. The parent renamed from Allied Motion Technologies
(Aug 2023); that slug is unreliable. Use the brand slugs:

```
allied-motion-technologies, globe-motors, motor-products, tci,
spectrum-controls, allied-motion-changzhou
```

## Caveats

- **Sea freight only** — BOL/AMS is ocean customs data. Air/truck lanes are
  invisible; say so in trial copy.
- **Historical** — BOL rows are already-arrived shipments. Live vessel motion for
  the demo comes from `pericles-atlas-mocker` riding on these seeded rows, not
  from the scrape.
- **Cost** — pay-per-event; a trial pull is cents. Cache geocoding (done) so
  re-runs don't re-bill lookups.
- **Production** — migrate off scraping to a licensed CBP AMS feed with
  redistribution rights before customer GA.
