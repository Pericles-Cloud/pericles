/**
 * Load Levi Strauss Data from CSV Files
 *
 * This script loads:
 * 1. Organization data from levi_strauss_data.csv
 * 2. Suppliers from levis-strauss-suppliers_geocoded_google.csv
 * 3. Shipments from levis-strauss-bols.csv
 * 4. Carriers (extracted from shipments)
 * 5. OrganizationContext with suppliers as locations
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

const DATA_DIR = '/Users/gary/Development/bigdecibel/pericles.ai/data';
const ORGANIZATION_ID = '550e8400-e29b-41d4-a716-446655440000'; // Levi Strauss

// Helper function to parse CSV
function parseCSV(content: string): any[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

async function loadOrganizationData() {
  console.log('[1/5] Loading organization data...');

  const orgContent = fs.readFileSync(
    path.join(DATA_DIR, 'levi_strauss_data.csv'),
    'utf-8'
  );
  const orgData = parseCSV(orgContent)[0];

  if (!orgData) {
    throw new Error('No organization data found');
  }

  await prisma.organization.upsert({
    where: { id: ORGANIZATION_ID },
    create: {
      id: ORGANIZATION_ID,
      name: orgData.company_name || 'Levi Strauss & Co',
      email_domain: 'levi.com',
      is_root: false,
      address_line1: orgData.address_line1,
      city: orgData.city,
      state: orgData.state,
      zip_code: orgData.zip_code,
      country: orgData.country,
      phone_number: orgData.phone_number,
      website: orgData.website,
      customer_type: orgData.customer_type,
    },
    update: {
      address_line1: orgData.address_line1,
      city: orgData.city,
      state: orgData.state,
      zip_code: orgData.zip_code,
      country: orgData.country,
      phone_number: orgData.phone_number,
      website: orgData.website,
      customer_type: orgData.customer_type,
      updated_at: new Date(),
    },
  });

  console.log('✓ Organization created/updated');
}

async function loadSuppliers() {
  console.log('[2/5] Loading suppliers...');

  const supplierContent = fs.readFileSync(
    path.join(DATA_DIR, 'levis-strauss-suppliers_geocoded_google.csv'),
    'utf-8'
  );
  const suppliers = parseCSV(supplierContent);

  console.log(`Found ${suppliers.length} suppliers`);

  let count = 0;
  for (const supplier of suppliers) {
    if (!supplier['Supplier Name']) continue;

    const supplierId = `sup-${count + 1}`;
    const destinationPorts = supplier['Destination Port'] ? [supplier['Destination Port']] : [];
    const departurePorts = supplier['Departure Port'] ? [supplier['Departure Port']] : [];
    const hsCodes = supplier['HS Code'] ? supplier['HS Code'].split(',').map((c: string) => c.trim()) : [];

    await prisma.supplier.upsert({
      where: { id: supplierId },
      create: {
        id: supplierId,
        name: supplier['Supplier Name'],
        address: supplier['Supplier Addresses'],
        website: supplier['Supplier Websites'],
        contact_info: supplier['Supplier Contact Info'],
        country: supplier.country_name || supplier['Supplier Country'],
        country_code: supplier.country_code,
        latitude: supplier.latitude ? parseFloat(supplier.latitude) : null,
        longitude: supplier.longitude ? parseFloat(supplier.longitude) : null,
        total_shipments: supplier.Shipments ? parseInt(supplier.Shipments, 10) : 0,
        destination_ports: destinationPorts,
        departure_ports: departurePorts,
        hs_codes: hsCodes,
        notify_party_name: supplier['Notify Party Name'],
        notify_party_address: supplier['Notify Party Address'],
        updated_at: new Date(),
        organization: {
          connect: { id: ORGANIZATION_ID }
        }
      },
      update: {
        name: supplier['Supplier Name'],
        address: supplier['Supplier Addresses'],
        total_shipments: supplier.Shipments ? parseInt(supplier.Shipments, 10) : 0,
        updated_at: new Date(),
      },
    });

    count++;
  }

  console.log(`✓ Loaded ${count} suppliers`);
  return count;
}

async function loadCarriersAndShipments() {
  console.log('[3/5] Loading shipments and extracting carriers...');

  const shipmentContent = fs.readFileSync(
    path.join(DATA_DIR, 'levis-strauss-bols.csv'),
    'utf-8'
  );
  const shipments = parseCSV(shipmentContent);

  console.log(`Found ${shipments.length} shipments`);

  // Extract unique carriers
  const carrierMap = new Map<string, { scac: string; name: string }>();
  for (const shipment of shipments) {
    const scac = shipment['Carrier SCAC Code'];
    if (scac && scac !== '') {
      const parts = scac.split(' - ');
      const code = parts[0]?.trim();
      const name = parts.slice(1).join(' - ').trim() || code;

      if (code && !carrierMap.has(code)) {
        carrierMap.set(code, { scac: code, name });
      }
    }
  }

  // Insert carriers
  console.log(`[3.1/5] Inserting ${carrierMap.size} carriers...`);
  for (const [_code, carrier] of carrierMap.entries()) {
    await prisma.carrier.upsert({
      where: { scac_code: carrier.scac },
      create: {
        id: `carrier-${carrier.scac}`,
        scac_code: carrier.scac,
        name: carrier.name,
        total_shipments: 0,
        updated_at: new Date(),
      },
      update: {
        name: carrier.name,
        updated_at: new Date(),
      },
    });
  }
  console.log(`✓ Loaded ${carrierMap.size} carriers`);

  // Insert shipments
  console.log('[3.2/5] Inserting shipments...');
  let count = 0;
  for (const shipment of shipments) {
    if (!shipment['Bol Number']) continue;

    const shipmentId = `ship-${count + 1}`;
    const scacCode = shipment['Carrier SCAC Code']?.split(' - ')[0]?.trim();
    const carrierId = scacCode ? `carrier-${scacCode}` : null;

    // Find supplier by name (simple match)
    const supplierName = shipment['Supplier Name'];
    let supplierId = null;
    if (supplierName) {
      const supplier = await prisma.supplier.findFirst({
        where: {
          organization_id: ORGANIZATION_ID,
          name: { contains: supplierName.substring(0, 20) }, // Partial match
        },
      });
      supplierId = supplier?.id || null;
    }

    await prisma.shipment.create({
      data: {
        id: shipmentId,
        organization_id: ORGANIZATION_ID,
        supplier_id: supplierId,
        carrier_id: carrierId,
        bol_number: shipment['Bol Number'],
        master_bol_number: shipment['Master Bol Number'],
        containers_count: shipment['Containers Count'] ? parseInt(shipment['Containers Count'], 10) : null,
        shipping_route: shipment['Shipping Route'],
        value_usd: shipment['Value in USD (CIF)'] ? parseFloat(shipment['Value in USD (CIF)']) : null,
        arrival_date: shipment['Arrival Date'] ? new Date(shipment['Arrival Date']) : null,
        estimated_arrival_date: shipment['Estimated Arrival Date'] ? new Date(shipment['Estimated Arrival Date']) : null,
        destination_port: shipment['Destination Port'],
        destination_port_code: shipment['Destination Port Code'],
        departure_port: shipment['Departure Port'],
        departure_port_code: shipment['Departure Port Code'],
        last_visit_foreign_port: shipment['Last Visit Foreign Port'],
        vessel_name: shipment['Vessel Name'],
        vessel_code: shipment['Vessel Code'],
        voyage: shipment.Voyage,
        container_ids: shipment['Container ID'] ? [shipment['Container ID']] : [],
        container_sizes: shipment['Container Size'] ? [shipment['Container Size']] : [],
        container_types: shipment['Container Type'] ? [shipment['Container Type']] : [],
        hs_codes: shipment['HS Code'] ? shipment['HS Code'].split(',').map((c: string) => c.trim()) : [],
        hs_code_descriptions: shipment['HS Code Description'] ? [shipment['HS Code Description']] : [],
        product_description: shipment['Product Description'],
        product_description_raw: shipment['Product Description Raw'],
        quantity: shipment.Quantity ? parseFloat(shipment.Quantity) : null,
        quantity_unit: shipment['Quantity Unit'],
        teu: shipment.TEU ? parseFloat(shipment.TEU) : null,
        weight: shipment.Weight ? parseFloat(shipment.Weight) : null,
        marks_numbers: shipment['Marks & Numbers'],
        marks_numbers_raw: shipment['Marks Numbers Raw'],
        notify_party_name: shipment['Notify Party Name'],
        notify_party_address: shipment['Notify Party Address'],
        notify_party_country_code: shipment['Notify Party Country Code'],
        updated_at: new Date(),
      },
    });

    count++;
    if (count % 100 === 0) {
      console.log(`  Processed ${count} shipments...`);
    }
  }

  console.log(`✓ Loaded ${count} shipments`);
  return count;
}

async function createOrganizationContext() {
  console.log('[4/5] Creating OrganizationContext...');

  // Get all suppliers for this organization
  const suppliers = await prisma.supplier.findMany({
    where: { organization_id: ORGANIZATION_ID },
    take: 50, // Limit for context
  });

  // Convert suppliers to OrganizationContext format
  const supplierLocations = suppliers
    .filter(s => s.latitude && s.longitude)
    .map(s => ({
      supplier_id: s.id,
      name: s.name,
      location: {
        city: s.address?.split(',')[0] || 'Unknown',
        country: s.country || 'Unknown',
        latitude: s.latitude!,
        longitude: s.longitude!,
      },
      tier: 1, // Assume tier 1 for all
    }));

  await prisma.organizationContext.upsert({
    where: { organization_id: ORGANIZATION_ID },
    create: {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      organization_id: ORGANIZATION_ID,
      plants: [],
      warehouses: [],
      suppliers: supplierLocations,
      shipping_lanes: [],
      monitored_risk_types: [],
      geographic_radius_km: 100,
      severity_threshold: 0.5,
      strategic_documents: {},
      last_erp_sync: new Date(),
      updated_at: new Date(),
    },
    update: {
      suppliers: supplierLocations,
      last_erp_sync: new Date(),
      updated_at: new Date(),
    },
  });

  console.log(`✓ OrganizationContext created with ${supplierLocations.length} supplier locations`);
}

async function displaySummary() {
  console.log('\n[5/5] Summary:');

  const orgCount = await prisma.organization.count({ where: { id: ORGANIZATION_ID } });
  const supplierCount = await prisma.supplier.count({ where: { organization_id: ORGANIZATION_ID } });
  const carrierCount = await prisma.carrier.count();
  const shipmentCount = await prisma.shipment.count({ where: { organization_id: ORGANIZATION_ID } });

  console.log(`\n✓ Data Load Complete!`);
  console.log(`  - Organizations: ${orgCount}`);
  console.log(`  - Suppliers: ${supplierCount}`);
  console.log(`  - Carriers: ${carrierCount}`);
  console.log(`  - Shipments: ${shipmentCount}`);
  console.log(`\nOrganization ID: ${ORGANIZATION_ID}`);
}

async function main() {
  console.log('Loading Levi Strauss data from CSV files...\n');

  try {
    await loadOrganizationData();
    await loadSuppliers();
    await loadCarriersAndShipments();
    await createOrganizationContext();
    await displaySummary();
  } catch (error) {
    console.error('Error loading data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
