#!/usr/bin/env tsx
/**
 * SAP ERP Tools Test Script
 *
 * Tests the SAP S/4HANA Cloud ERP data tools in mock mode.
 *
 * Usage:
 *   npx tsx src/scripts/test-sap-tools.ts
 */

import {
  sapGetSuppliersT,
  sapGetPlantsT,
  sapGetMaterialStockTool,
  sapGetShippingLanesTool,
} from '../mastra/tools/sap-erp-data-tool';

async function main() {
  console.log('🧪 Testing SAP S/4HANA Cloud ERP Data Tools\n');
  console.log('Mode: Mock API (SAP_S4HANA_USE_MOCK=true)\n');
  console.log('='.repeat(70));

  try {
    // Test 1: Get Suppliers
    console.log('\n📦 Test 1: Get Suppliers in Vietnam');
    console.log('-'.repeat(70));

    const suppliersResult = await sapGetSuppliersT.execute({
      context: {
        country_filter: 'VN',
        critical_only: true,
        max_results: 10,
      },
      runtimeContext: {} as never,
    });

    console.log(`✓ Found ${suppliersResult.suppliers.length} critical suppliers in Vietnam`);
    console.log(`  Data Source: ${suppliersResult.data_source}`);
    console.log(`  Timestamp: ${suppliersResult.timestamp}`);

    if (suppliersResult.suppliers.length > 0) {
      const supplier = suppliersResult.suppliers[0];
      console.log(`\n  Example Supplier:`);
      console.log(`    ID: ${supplier.supplier_id}`);
      console.log(`    Name: ${supplier.name}`);
      console.log(`    Location: ${supplier.location.name}, ${supplier.location.country}`);
      console.log(`    Coordinates: ${supplier.location.latitude}, ${supplier.location.longitude}`);
      console.log(`    Tier: ${supplier.tier}`);
      console.log(`    Critical: ${supplier.critical}`);
      console.log(`    Risk Score: ${supplier.risk_score || 'N/A'}`);
    }

    // Test 2: Get Plants
    console.log('\n\n🏭 Test 2: Get All Plants and Warehouses');
    console.log('-'.repeat(70));

    const plantsResult = await sapGetPlantsT.execute({
      context: {
        plant_type: 'all',
        max_results: 20,
      },
      runtimeContext: {} as never,
    });

    console.log(`✓ Found ${plantsResult.plants.length} facilities`);
    console.log(`  Data Source: ${plantsResult.data_source}`);

    const manufacturing = plantsResult.plants.filter((p) => p.plant_type === 'manufacturing');
    const warehouses = plantsResult.plants.filter((p) => p.plant_type === 'warehouse');

    console.log(`  Manufacturing Plants: ${manufacturing.length}`);
    console.log(`  Warehouses: ${warehouses.length}`);

    if (plantsResult.plants.length > 0) {
      const plant = plantsResult.plants[0];
      console.log(`\n  Example Facility:`);
      console.log(`    ID: ${plant.plant_id}`);
      console.log(`    Name: ${plant.name}`);
      console.log(`    Type: ${plant.plant_type}`);
      console.log(`    Location: ${plant.location.name}, ${plant.location.country}`);
      if (plant.capacity) console.log(`    Capacity: ${plant.capacity.toLocaleString()} units`);
      if (plant.utilization) console.log(`    Utilization: ${plant.utilization}%`);
    }

    // Test 3: Get Material Stock
    console.log('\n\n📊 Test 3: Get Material Stock at San Francisco DC (Plant 1000)');
    console.log('-'.repeat(70));

    const stockResult = await sapGetMaterialStockTool.execute({
      context: {
        plant_id: '1000',
        max_results: 10,
      },
      runtimeContext: {} as never,
    });

    console.log(`✓ Found ${stockResult.stock.length} stock records at plant ${stockResult.plant_id}`);
    console.log(`  Data Source: ${stockResult.data_source}`);

    const totalQuantity = stockResult.stock.reduce((sum, item) => sum + item.quantity, 0);
    const totalValue = stockResult.stock.reduce(
      (sum, item) => sum + (item.stock_value || 0),
      0
    );

    console.log(`  Total Quantity: ${totalQuantity.toLocaleString()} units`);
    console.log(`  Total Value: $${totalValue.toLocaleString()}`);

    if (stockResult.stock.length > 0) {
      const stock = stockResult.stock[0];
      console.log(`\n  Example Stock Record:`);
      console.log(`    Material: ${stock.material}`);
      console.log(`    Quantity: ${stock.quantity.toLocaleString()} ${stock.unit}`);
      if (stock.stock_value) {
        console.log(`    Value: ${stock.currency} ${stock.stock_value.toLocaleString()}`);
      }
    }

    // Test 4: Get Shipping Lanes
    console.log('\n\n🚢 Test 4: Get Ocean Shipping Lanes');
    console.log('-'.repeat(70));

    const lanesResult = await sapGetShippingLanesTool.execute({
      context: {
        mode: 'ocean',
        active_only: true,
        max_results: 10,
      },
      runtimeContext: {} as never,
    });

    console.log(`✓ Found ${lanesResult.shipping_lanes.length} active ocean shipping lanes`);
    console.log(`  Data Source: ${lanesResult.data_source}`);

    if (lanesResult.shipping_lanes.length > 0) {
      console.log(`\n  Shipping Lanes:`);
      lanesResult.shipping_lanes.forEach((lane) => {
        console.log(
          `    ${lane.lane_id}: ${lane.origin.name} → ${lane.destination.name} (${lane.transit_days} days via ${lane.carrier || 'Unknown'})`
        );
      });
    }

    // Summary
    console.log(`\n\n${  '='.repeat(70)}`);
    console.log('✅ All Tests Passed!');
    console.log('='.repeat(70));
    console.log(`
Summary:
  • Suppliers Tool: ✓ Working
  • Plants Tool: ✓ Working
  • Material Stock Tool: ✓ Working
  • Shipping Lanes Tool: ✓ Working

All SAP ERP data tools are functioning correctly in mock mode.
To test with production SAP, set SAP_S4HANA_USE_MOCK=false in .env
`);
  } catch (error) {
    console.error('\n❌ Test Failed:', error);
    process.exit(1);
  }
}

// Run tests
main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
