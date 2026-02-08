#!/usr/bin/env node
/**
 * Mock Shipment Generator CLI
 *
 * Generates mock shipment data for testing the Monitoring Agent.
 *
 * Usage:
 *   npm run mock:create              # Create default mock data (50 shipments)
 *   npm run mock:create -- --count 100    # Create 100 shipments
 *   npm run mock:create -- --scenarios typhoon,flood  # Only typhoon and flood scenarios
 *   npm run mock:reset               # Delete all mock data
 *   npm run mock:status              # Show current mock data status
 *
 * Or directly:
 *   npx tsx src/scripts/mocker/index.ts create --count 100
 *   npx tsx src/scripts/mocker/index.ts reset
 *   npx tsx src/scripts/mocker/index.ts status
 */

import { MockShipmentGenerator } from './generator.js';
import type { RiskScenario, MockerConfig } from './types.js';
import { DEFAULT_MOCKER_CONFIG } from './types.js';

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

interface CliArgs {
  action: 'create' | 'reset' | 'status' | 'help';
  count: number;
  scenarios: RiskScenario[];
  prefix: string;
  orgId: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    action: 'help',
    count: DEFAULT_MOCKER_CONFIG.shipmentCount,
    scenarios: [],
    prefix: DEFAULT_MOCKER_CONFIG.idPrefix,
    orgId: DEFAULT_MOCKER_CONFIG.organizationId,
  };

  // First positional arg is the action
  if (args.length > 0 && !args[0].startsWith('-')) {
    const action = args[0].toLowerCase();
    if (action === 'create' || action === 'reset' || action === 'status' || action === 'help') {
      result.action = action;
    }
  }

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--count':
      case '-c':
        if (nextArg) {
          result.count = parseInt(nextArg, 10);
          i++;
        }
        break;

      case '--scenarios':
      case '-s':
        if (nextArg) {
          result.scenarios = nextArg.split(',').map((s) => s.trim() as RiskScenario);
          i++;
        }
        break;

      case '--prefix':
      case '-p':
        if (nextArg) {
          result.prefix = nextArg;
          i++;
        }
        break;

      case '--org':
      case '-o':
        if (nextArg) {
          result.orgId = nextArg;
          i++;
        }
        break;

      case '--help':
      case '-h':
        result.action = 'help';
        break;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    PERICLES MOCK SHIPMENT GENERATOR                          ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Generate mock shipment data for testing the Monitoring Agent against various
  supply chain risk scenarios.

USAGE:
  npx tsx src/scripts/mocker/index.ts <action> [options]

ACTIONS:
  create    Generate mock suppliers, carriers, and shipments
  reset     Delete all mock data (by prefix)
  status    Show current mock data statistics
  help      Show this help message

OPTIONS:
  --count, -c <number>      Number of shipments to generate (default: 50)
  --scenarios, -s <list>    Comma-separated risk scenarios to include
  --prefix, -p <string>     ID prefix for mock data (default: mock-)
  --org, -o <uuid>          Organization ID (default: Levi Strauss)

RISK SCENARIOS:
  typhoon         Typhoon-prone regions (Philippines, Taiwan, Japan)
  earthquake      Seismic zones (Japan, Taiwan, California)
  port_congestion Congested ports (LA, Long Beach, Shanghai)
  labor_strike    Labor dispute regions (US West Coast, India)
  geopolitical    Conflict/sanction zones (Taiwan Strait, Middle East)
  pandemic        Health alert regions
  cyber_risk      Tech/cyber vulnerability (China tech exports)
  tariff_risk     Tariff-affected trade (US-China)
  piracy          High-risk maritime zones (Malacca, Gulf of Aden)
  flood           Flood-prone regions (Bangladesh, Vietnam)

EXAMPLES:
  # Create 100 shipments with all risk scenarios
  npx tsx src/scripts/mocker/index.ts create --count 100

  # Create shipments only for typhoon and flood risks
  npx tsx src/scripts/mocker/index.ts create --scenarios typhoon,flood

  # Create shipments with custom prefix for easy cleanup
  npx tsx src/scripts/mocker/index.ts create --prefix test-run-1-

  # Check current mock data status
  npx tsx src/scripts/mocker/index.ts status

  # Delete all mock data
  npx tsx src/scripts/mocker/index.ts reset

NPM SCRIPTS:
  npm run mock:create               # Create default mock data
  npm run mock:create -- --count 100
  npm run mock:reset                # Delete all mock data
  npm run mock:status               # Show mock data status
`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.action === 'help') {
    printHelp();
    process.exit(0);
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    PERICLES MOCK SHIPMENT GENERATOR                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  const config: Partial<MockerConfig> = {
    shipmentCount: args.count,
    riskScenarios: args.scenarios,
    idPrefix: args.prefix,
    organizationId: args.orgId,
  };

  const generator = new MockShipmentGenerator(config);

  try {
    switch (args.action) {
      case 'create': {
        const result = await generator.generate();
        console.log('\n📊 Generation Summary:');
        console.log(`  Organization: ${result.organizationId}`);
        console.log(`  Suppliers: ${result.suppliersCreated}`);
        console.log(`  Carriers: ${result.carriersCreated}`);
        console.log(`  Shipments: ${result.shipmentsCreated}`);
        console.log(`  Risk scenarios: ${result.riskScenariosUsed.join(', ')}`);
        break;
      }

      case 'reset': {
        const result = await generator.reset();
        console.log('\n📊 Reset Summary:');
        console.log(`  Suppliers deleted: ${result.deleted.suppliers}`);
        console.log(`  Carriers deleted: ${result.deleted.carriers}`);
        console.log(`  Shipments deleted: ${result.deleted.shipments}`);
        break;
      }

      case 'status': {
        const status = await generator.getStatus();
        console.log('\n📊 Mock Data Status:');
        console.log(`  Suppliers: ${status.suppliers}`);
        console.log(`  Carriers: ${status.carriers}`);
        console.log(`  Shipments: ${status.shipments}`);

        if (Object.keys(status.byRiskScenario).length > 0) {
          console.log('\n  Shipments by Risk Scenario:');
          for (const [scenario, count] of Object.entries(status.byRiskScenario)) {
            console.log(`    - ${scenario}: ${count}`);
          }
        }
        break;
      }

      default:
        printHelp();
    }
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await generator.disconnect();
  }

  console.log('');
}

// Run if called directly
main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
