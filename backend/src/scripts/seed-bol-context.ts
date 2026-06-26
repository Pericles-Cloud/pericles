#!/usr/bin/env tsx
/**
 * BOL Trial Context Seed Script
 *
 * Seeds a parent organization from public bill-of-lading data so Atlas renders
 * without a live ERP. Each branded subsidiary (importer) becomes its own child
 * Organization with its own OrganizationContext — see pericles-data-model.
 * Mirrors sync-sap-erp.ts.
 *
 * Usage:
 *   # Live pull via Apify (needs APIFY_TOKEN; GOOGLE_MAPS_API_KEY for geocoding).
 *   # Each importer slug becomes a child org under --org-id.
 *   npm run bol:seed -- --org-id=<parent-uuid> --company=sun-hydraulics,faster --verbose
 *
 *   # Fully offline: rows from a JSON fixture + the built-in gazetteer geocoder
 *   npm run bol:seed -- --org-id=<parent-uuid> --fixture=./fixtures/bol-sample.json --stub
 *
 *   # Preview without writing
 *   npm run bol:seed -- --org-id=<parent-uuid> --company=sun-hydraulics --dry-run --verbose
 *
 * Environment Variables:
 *   APIFY_TOKEN           Apify token (required for live pulls; not for --fixture)
 *   APIFY_BOL_ACTOR       Override the ImportYeti-style actor id
 *   GOOGLE_MAPS_API_KEY   Google Geocoding key (falls back to offline gazetteer)
 */

import { readFileSync } from 'node:fs';
import { syncBolContextForSubsidiaries } from '../integrations/bol/sync-service.js';
import { onboardCustomerFromBol } from '../integrations/bol/onboard.js';
import { createStubGeocoder } from '../integrations/bol/geocode.js';
import type { BolRow } from '../integrations/bol/types.js';

function getArg(name: string): string | undefined {
  return process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}
function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function printUsage(): void {
  console.log(`
BOL Trial Context Seed Script

Usage:
  npm run bol:seed -- --org-id=<parent-uuid> [source] [options]

  --org-id is the PARENT org; one child org is created per branded subsidiary.
  Alternatively, --customer-name=<name> finds-or-creates the parent customer org
  (use this to onboard a brand-new customer). --seed-tables additionally writes
  the relational Supplier/Carrier/Shipment rows Atlas + the position mocker read.

Source (choose one):
  --company=<slugs>     Importer slug(s), comma-separated (actor input: companies)
  --supplier=<slugs>    Foreign supplier slug(s), comma-separated (input: suppliers)
  --fixture=<path>      Load normalized BolRow[] from a JSON file (no network)

Options:
  --customer-name=<n>   Find-or-create the parent customer org by name
  --seed-tables         Also seed Supplier/Carrier/Shipment tables (Atlas path)
  --max-items=<n>       Cap total actor records (default 1000; 0 = no cap). The
                        actor's own default is 50, so set this to pull more.
  --stub                Use the offline gazetteer-only geocoder (no Google calls)
  --dry-run             Compute context but do not write to the database
  --verbose, -v         Verbose logging
  --help, -h            Show this help

Examples:
  # Onboard Helios end-to-end (parent + subsidiaries + tables):
  npm run bol:seed -- --customer-name="Helios Technologies" --seed-tables -v \
    --company=sun-hydraulics,faster,enovation-controls,balboa-water-group,daman-products
  npm run bol:seed -- --org-id=<parent-uuid> --fixture=./fixtures/bol-sample.json --stub --dry-run
`);
}

function csv(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function loadFixtureRows(path: string): BolRow[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new Error(`Fixture ${path} must be a BolRow[] or { rows: BolRow[] }`);
  }
  return rows as BolRow[];
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('-h') || process.argv.length <= 2) {
    printUsage();
    process.exit(hasFlag('help') || hasFlag('-h') ? 0 : 1);
  }

  const parentOrgId = getArg('org-id');
  const customerName = getArg('customer-name');
  const seedTables = hasFlag('seed-tables');
  if (!parentOrgId && !customerName) {
    console.error('Error: --org-id=<uuid> or --customer-name=<name> is required\n');
    printUsage();
    process.exit(1);
  }

  const verbose = hasFlag('verbose') || hasFlag('-v');
  const dryRun = hasFlag('dry-run');
  const fixture = getArg('fixture');

  const rows = fixture ? loadFixtureRows(fixture) : undefined;
  const companies = csv(getArg('company'));
  const suppliers = csv(getArg('supplier'));
  if (!rows && !companies.length && !suppliers.length) {
    console.error('Error: provide a source (--company, --supplier, or --fixture)\n');
    printUsage();
    process.exit(1);
  }

  // --stub forces the offline gazetteer geocoder (no table, just built-ins).
  const geocoder = hasFlag('stub') ? createStubGeocoder({}) : undefined;
  const maxItems = Number(getArg('max-items') ?? 1000);

  // Onboard path (creates parent + optionally seeds relational tables) when a
  // customer name is given or --seed-tables is set; else the legacy context-only
  // seed under an existing parent org id.
  const useOnboard = Boolean(customerName) || seedTables;
  const target = customerName ? `"${customerName}"` : parentOrgId;
  console.log(`Seeding BOL data under parent ${target}`);
  console.log('(one child organization is created per branded subsidiary)');
  if (useOnboard && seedTables) console.log('(seeding relational Supplier/Carrier/Shipment tables)');
  if (dryRun) console.log('(DRY RUN — no database changes will be made)');

  const result = useOnboard
    ? await onboardCustomerFromBol({
        parentOrganizationId: parentOrgId,
        customerName,
        companies,
        suppliers,
        maxItems,
        rows,
        geocoder,
        dryRun,
        verbose,
      })
    : await syncBolContextForSubsidiaries(parentOrgId!, {
        companies,
        suppliers,
        maxItems,
        rows,
        geocoder,
        dryRun,
        verbose,
      });

  console.log('\nSeed Result:');
  console.log(`  Success:        ${result.success ? '✓' : '✗'}`);
  console.log(`  Parent org:     ${result.parent_organization_id}`);
  if ('parent_created' in result) {
    console.log(`  Parent:         ${result.parent_created ? 'created' : 'existing'}`);
  }
  console.log(`  Rows fetched:   ${result.rows_fetched}`);
  console.log(`  Subsidiaries:   ${result.subsidiaries.length}`);
  for (const s of result.subsidiaries) {
    const tag = dryRun ? '(dry-run)' : s.created ? '(created)' : '(updated)';
    console.log(
      `    - ${s.subsidiary} ${tag}: ` +
        `${s.records_synced.suppliers} suppliers, ${s.records_synced.plants} plants, ` +
        `${s.records_synced.shipping_lanes} lanes (${s.rows} rows)`
    );
    if (s.tables_synced) {
      console.log(
        `        tables: ${s.tables_synced.suppliers} suppliers, ` +
          `${s.tables_synced.carriers} carriers, ${s.tables_synced.shipments} shipments`
      );
    }
  }
  console.log(`  Timestamp:      ${result.sync_timestamp}`);
  if (result.errors?.length) {
    console.log('\n  Errors / warnings:');
    result.errors.forEach((e) => { console.log(`    - ${e}`); });
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
