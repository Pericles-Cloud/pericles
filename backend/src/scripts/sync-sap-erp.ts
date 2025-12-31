#!/usr/bin/env tsx
/**
 * SAP S/4HANA ERP Data Sync Script
 *
 * This script synchronizes supply chain data from SAP S/4HANA Cloud
 * into the Pericles OrganizationContext for risk monitoring.
 *
 * Usage:
 *   # Sync single organization
 *   npx tsx src/scripts/sync-sap-erp.ts --org-id=550e8400-e29b-41d4-a716-446655440000
 *
 *   # Sync all organizations
 *   npx tsx src/scripts/sync-sap-erp.ts --all
 *
 *   # Dry run (no database changes)
 *   npx tsx src/scripts/sync-sap-erp.ts --all --dry-run
 *
 *   # Test SAP connection
 *   npx tsx src/scripts/sync-sap-erp.ts --test
 *
 * Environment Variables:
 *   SAP_S4HANA_BASE_URL       - SAP API base URL
 *   SAP_S4HANA_CLIENT_ID      - OAuth client ID
 *   SAP_S4HANA_CLIENT_SECRET  - OAuth client secret
 *   SAP_S4HANA_USE_MOCK       - Set to 'false' for production (default: true)
 */

import {
  syncSAPDataForOrganization,
  syncSAPDataForAllOrganizations,
  testSAPConnection,
} from '../integrations/sap/sync-service';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  orgId: args.find((arg) => arg.startsWith('--org-id='))?.split('=')[1],
  all: args.includes('--all'),
  dryRun: args.includes('--dry-run'),
  test: args.includes('--test'),
  verbose: args.includes('--verbose') || args.includes('-v'),
  help: args.includes('--help') || args.includes('-h'),
};

function printUsage() {
  console.log(`
SAP S/4HANA ERP Data Sync Script

Usage:
  npx tsx src/scripts/sync-sap-erp.ts [options]

Options:
  --org-id=<uuid>    Sync specific organization by ID
  --all              Sync all active organizations
  --dry-run          Preview changes without modifying database
  --test             Test SAP S/4HANA connection
  --verbose, -v      Enable verbose logging
  --help, -h         Show this help message

Examples:
  # Sync Levi Strauss organization
  npx tsx src/scripts/sync-sap-erp.ts --org-id=550e8400-e29b-41d4-a716-446655440000 --verbose

  # Sync all organizations
  npx tsx src/scripts/sync-sap-erp.ts --all

  # Dry run for all organizations
  npx tsx src/scripts/sync-sap-erp.ts --all --dry-run --verbose

  # Test SAP connection
  npx tsx src/scripts/sync-sap-erp.ts --test

Environment Variables:
  SAP_S4HANA_BASE_URL       SAP API base URL (e.g., https://my123456-api.s4hana.ondemand.com)
  SAP_S4HANA_CLIENT_ID      OAuth 2.0 client ID
  SAP_S4HANA_CLIENT_SECRET  OAuth 2.0 client secret
  SAP_S4HANA_USE_MOCK       Use mock SAP API (default: true, set to 'false' for production)
  SAP_S4HANA_TIMEOUT        Request timeout in ms (default: 30000)
  `);
}

async function main() {
  // Show help
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  // Test SAP connection
  if (options.test) {
    console.log('Testing SAP S/4HANA Cloud connection...\n');

    const result = await testSAPConnection();

    console.log('Connection Test Result:');
    console.log(`  Status:    ${result.status}`);
    console.log(`  Mode:      ${result.mode}`);
    console.log(`  Timestamp: ${result.timestamp}`);

    if (result.error) {
      console.log(`  Error:     ${result.error}`);
      process.exit(1);
    }

    console.log('\n✓ SAP connection successful!');
    process.exit(0);
  }

  // Sync specific organization
  if (options.orgId) {
    console.log(`Syncing organization: ${options.orgId}`);
    if (options.dryRun) {
      console.log('(DRY RUN - No database changes will be made)\n');
    }

    const result = await syncSAPDataForOrganization(options.orgId, {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    console.log('\nSync Result:');
    console.log(`  Success:        ${result.success ? '✓' : '✗'}`);
    console.log(`  Organization:   ${result.organization_id}`);
    console.log(`  Plants:         ${result.records_synced.plants}`);
    console.log(`  Warehouses:     ${result.records_synced.warehouses}`);
    console.log(`  Suppliers:      ${result.records_synced.suppliers}`);
    console.log(`  Shipping Lanes: ${result.records_synced.shipping_lanes}`);
    console.log(`  Timestamp:      ${result.sync_timestamp}`);

    if (result.errors && result.errors.length > 0) {
      console.log('\n  Errors:');
      result.errors.forEach((error) => { console.log(`    - ${error}`); });
    }

    process.exit(result.success ? 0 : 1);
  }

  // Sync all organizations
  if (options.all) {
    console.log('Syncing all active organizations...');
    if (options.dryRun) {
      console.log('(DRY RUN - No database changes will be made)\n');
    }

    const result = await syncSAPDataForAllOrganizations({
      dryRun: options.dryRun,
      verbose: options.verbose,
      concurrency: 3,
    });

    console.log('\nSync Summary:');
    console.log(`  Total:      ${result.total}`);
    console.log(`  Successful: ${result.successful} ✓`);
    console.log(`  Failed:     ${result.failed} ✗`);

    if (options.verbose) {
      console.log('\nDetailed Results:');
      result.results.forEach((r) => {
        const icon = r.success ? '✓' : '✗';
        console.log(
          `  ${icon} ${r.organization_id}: ` +
            `${r.records_synced.plants}P + ${r.records_synced.warehouses}W + ` +
            `${r.records_synced.suppliers}S + ${r.records_synced.shipping_lanes}L`
        );
        if (r.errors) {
          r.errors.forEach((err) => { console.log(`      Error: ${err}`); });
        }
      });
    }

    process.exit(result.failed > 0 ? 1 : 0);
  }

  // No valid options provided
  console.error('Error: Must specify --org-id, --all, or --test\n');
  printUsage();
  process.exit(1);
}

// Run main function
main().catch((error: unknown) => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
