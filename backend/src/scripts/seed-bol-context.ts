#!/usr/bin/env tsx
/**
 * BOL Trial Context Seed Script
 *
 * Seeds a tenant's OrganizationContext from public bill-of-lading data so Atlas
 * renders without a live ERP. Mirrors sync-sap-erp.ts.
 *
 * Usage:
 *   # Live pull via Apify (needs APIFY_TOKEN; GOOGLE_MAPS_API_KEY for geocoding)
 *   npm run bol:seed -- --org-id=<uuid> --company=allient --verbose
 *
 *   # Multiple importer slugs (comma-separated)
 *   npm run bol:seed -- --org-id=<uuid> --company=sun-hydraulics,faster --verbose
 *
 *   # Fully offline: rows from a JSON fixture + the built-in gazetteer geocoder
 *   npm run bol:seed -- --org-id=<uuid> --fixture=./fixtures/bol-sample.json --stub
 *
 *   # Preview without writing
 *   npm run bol:seed -- --org-id=<uuid> --company=allient --dry-run --verbose
 *
 * Environment Variables:
 *   APIFY_TOKEN           Apify token (required for live pulls; not for --fixture)
 *   APIFY_BOL_ACTOR       Override the ImportYeti-style actor id
 *   GOOGLE_MAPS_API_KEY   Google Geocoding key (falls back to offline gazetteer)
 */

import { readFileSync } from 'node:fs';
import { syncBolContextForOrganization } from '../integrations/bol/sync-service.js';
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
  npm run bol:seed -- --org-id=<uuid> [source] [options]

Source (choose one):
  --company=<slugs>     Importer slug(s), comma-separated (actor input: companies)
  --supplier=<slugs>    Foreign supplier slug(s), comma-separated (input: suppliers)
  --input-file=<path>   Raw JSON passed straight to the Apify actor
  --fixture=<path>      Load normalized BolRow[] from a JSON file (no network)

Options:
  --stub                Use the offline gazetteer-only geocoder (no Google calls)
  --dry-run             Compute context but do not write to the database
  --verbose, -v         Verbose logging
  --help, -h            Show this help

Examples:
  npm run bol:seed -- --org-id=00000000-0000-0000-0000-000000000001 --company=allient -v
  npm run bol:seed -- --org-id=<uuid> --fixture=./fixtures/bol-sample.json --stub --dry-run
`);
}

function csv(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function buildInput(): Record<string, unknown> | undefined {
  const companies = csv(getArg('company'));
  const suppliers = csv(getArg('supplier'));
  const inputFile = getArg('input-file');
  if (inputFile) return JSON.parse(readFileSync(inputFile, 'utf8')) as Record<string, unknown>;
  // Default ImportYeti actor input shape: { companies, suppliers } (slugs).
  if (companies.length || suppliers.length) return { companies, suppliers };
  return undefined;
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

  const orgId = getArg('org-id');
  if (!orgId) {
    console.error('Error: --org-id=<uuid> is required\n');
    printUsage();
    process.exit(1);
  }

  const verbose = hasFlag('verbose') || hasFlag('-v');
  const dryRun = hasFlag('dry-run');
  const fixture = getArg('fixture');

  const rows = fixture ? loadFixtureRows(fixture) : undefined;
  const input = rows ? undefined : buildInput();
  if (!rows && !input) {
    console.error('Error: provide a source (--company, --supplier, --input-file, or --fixture)\n');
    printUsage();
    process.exit(1);
  }

  // --stub forces the offline gazetteer geocoder (no table, just built-ins).
  const geocoder = hasFlag('stub') ? createStubGeocoder({}) : undefined;

  console.log(`Seeding BOL context for organization: ${orgId}`);
  if (dryRun) console.log('(DRY RUN — no database changes will be made)');

  const result = await syncBolContextForOrganization(orgId, {
    input,
    rows,
    geocoder,
    dryRun,
    verbose,
  });

  console.log('\nSeed Result:');
  console.log(`  Success:        ${result.success ? '✓' : '✗'}`);
  console.log(`  Organization:   ${result.organization_id}`);
  console.log(`  Rows fetched:   ${result.rows_fetched}`);
  console.log(`  Plants:         ${result.records_synced.plants}`);
  console.log(`  Warehouses:     ${result.records_synced.warehouses}`);
  console.log(`  Suppliers:      ${result.records_synced.suppliers}`);
  console.log(`  Shipping Lanes: ${result.records_synced.shipping_lanes}`);
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
