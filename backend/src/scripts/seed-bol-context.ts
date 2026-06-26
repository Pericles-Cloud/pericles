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

Source (choose one):
  --company=<slugs>     Importer slug(s), comma-separated (actor input: companies)
  --supplier=<slugs>    Foreign supplier slug(s), comma-separated (input: suppliers)
  --fixture=<path>      Load normalized BolRow[] from a JSON file (no network)

Options:
  --max-items=<n>       Cap total actor records (default 1000; 0 = no cap). The
                        actor's own default is 50, so set this to pull more.
  --stub                Use the offline gazetteer-only geocoder (no Google calls)
  --dry-run             Compute context but do not write to the database
  --verbose, -v         Verbose logging
  --help, -h            Show this help

Examples:
  npm run bol:seed -- --org-id=<parent-uuid> --company=sun-hydraulics,faster -v
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
  if (!parentOrgId) {
    console.error('Error: --org-id=<uuid> (parent organization) is required\n');
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

  console.log(`Seeding BOL context under parent organization: ${parentOrgId}`);
  console.log('(one child organization is created per branded subsidiary)');
  if (dryRun) console.log('(DRY RUN — no database changes will be made)');

  const result = await syncBolContextForSubsidiaries(parentOrgId, {
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
  console.log(`  Rows fetched:   ${result.rows_fetched}`);
  console.log(`  Subsidiaries:   ${result.subsidiaries.length}`);
  for (const s of result.subsidiaries) {
    const tag = dryRun ? '(dry-run)' : s.created ? '(created)' : '(updated)';
    console.log(
      `    - ${s.subsidiary} ${tag}: ` +
        `${s.records_synced.suppliers} suppliers, ${s.records_synced.plants} plants, ` +
        `${s.records_synced.shipping_lanes} lanes (${s.rows} rows)`
    );
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
