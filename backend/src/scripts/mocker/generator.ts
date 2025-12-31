/**
 * Mock Shipment Generator
 *
 * Generates realistic mock shipment data for testing the Monitoring Agent.
 * Creates suppliers, carriers, and shipments with configurable risk scenarios.
 */

import { PrismaClient } from '@prisma/client';
import type { MockerConfig, MockerResult, ShipmentStatus } from './types';
import { DEFAULT_MOCKER_CONFIG } from './types';
import {
  MOCK_CARRIERS,
  MOCK_PRODUCTS,
  getSuppliersByRisk,
  getRoutesByRisk,
  randomElement,
  randomBetween,
  generateBolNumber,
  generateContainerId,
} from './data';

const prisma = new PrismaClient();

// ============================================================================
// GENERATOR CLASS
// ============================================================================

export class MockShipmentGenerator {
  private config: MockerConfig;

  constructor(config: Partial<MockerConfig> = {}) {
    this.config = { ...DEFAULT_MOCKER_CONFIG, ...config };
  }

  /**
   * Generate all mock data
   */
  async generate(): Promise<MockerResult> {
    console.log('\n🏭 Starting mock data generation...\n');
    console.log(`Configuration:`);
    console.log(`  - Shipments: ${this.config.shipmentCount}`);
    console.log(`  - Risk scenarios: ${this.config.riskScenarios.length > 0 ? this.config.riskScenarios.join(', ') : 'all'}`);
    console.log(`  - ID prefix: ${this.config.idPrefix}`);
    console.log(`  - Organization: ${this.config.organizationId}`);
    console.log('');

    // Ensure organization exists
    await this.ensureOrganization();

    // Generate data
    const suppliersCreated = await this.generateSuppliers();
    const carriersCreated = await this.generateCarriers();
    const shipmentsCreated = await this.generateShipments();

    // Update organization context
    await this.updateOrganizationContext();

    const result: MockerResult = {
      organizationId: this.config.organizationId,
      suppliersCreated,
      carriersCreated,
      shipmentsCreated,
      riskScenariosUsed: this.config.riskScenarios.length > 0
        ? this.config.riskScenarios
        : ['typhoon', 'earthquake', 'port_congestion', 'labor_strike', 'geopolitical', 'pandemic', 'cyber_risk', 'tariff_risk', 'piracy', 'flood'],
      timestamp: new Date(),
    };

    console.log('\n✅ Mock data generation complete!');
    console.log(`  - Suppliers: ${suppliersCreated}`);
    console.log(`  - Carriers: ${carriersCreated}`);
    console.log(`  - Shipments: ${shipmentsCreated}`);

    return result;
  }

  /**
   * Reset (delete) all mock data
   */
  async reset(): Promise<{ deleted: { suppliers: number; carriers: number; shipments: number } }> {
    console.log('\n🗑️  Resetting mock data...\n');
    console.log(`Deleting records with prefix: ${this.config.idPrefix}`);

    // Delete shipments first (foreign key constraints)
    const shipmentResult = await prisma.shipment.deleteMany({
      where: {
        id: { startsWith: this.config.idPrefix },
        organization_id: this.config.organizationId,
      },
    });
    console.log(`  - Deleted ${shipmentResult.count} shipments`);

    // Delete suppliers
    const supplierResult = await prisma.supplier.deleteMany({
      where: {
        id: { startsWith: this.config.idPrefix },
        organization_id: this.config.organizationId,
      },
    });
    console.log(`  - Deleted ${supplierResult.count} suppliers`);

    // Delete carriers (not org-scoped, but prefix-scoped)
    const carrierResult = await prisma.carrier.deleteMany({
      where: {
        id: { startsWith: this.config.idPrefix },
      },
    });
    console.log(`  - Deleted ${carrierResult.count} carriers`);

    console.log('\n✅ Mock data reset complete!');

    return {
      deleted: {
        suppliers: supplierResult.count,
        carriers: carrierResult.count,
        shipments: shipmentResult.count,
      },
    };
  }

  /**
   * Get status of mock data
   */
  async getStatus(): Promise<{
    suppliers: number;
    carriers: number;
    shipments: number;
    byRiskScenario: Record<string, number>;
    byStatus: Record<string, number>;
  }> {
    const suppliers = await prisma.supplier.count({
      where: {
        id: { startsWith: this.config.idPrefix },
        organization_id: this.config.organizationId,
      },
    });

    const carriers = await prisma.carrier.count({
      where: {
        id: { startsWith: this.config.idPrefix },
      },
    });

    const shipments = await prisma.shipment.count({
      where: {
        id: { startsWith: this.config.idPrefix },
        organization_id: this.config.organizationId,
      },
    });

    // Get shipments with risk scenario metadata (stored in shipping_route field)
    const allShipments = await prisma.shipment.findMany({
      where: {
        id: { startsWith: this.config.idPrefix },
        organization_id: this.config.organizationId,
      },
      select: {
        shipping_route: true,
      },
    });

    // Count by risk scenario (parsed from shipping_route)
    const byRiskScenario: Record<string, number> = {};
    const riskRegex = /\[RISK:([\w,]+)\]/;
    for (const shipment of allShipments) {
      const route = shipment.shipping_route || '';
      const riskMatch = riskRegex.exec(route);
      if (riskMatch) {
        const risks = riskMatch[1].split(',');
        for (const risk of risks) {
          byRiskScenario[risk] = (byRiskScenario[risk] || 0) + 1;
        }
      }
    }

    // Note: Status is not stored in the current schema, so we'll return empty
    const byStatus: Record<string, number> = {};

    return {
      suppliers,
      carriers,
      shipments,
      byRiskScenario,
      byStatus,
    };
  }

  /**
   * Ensure the organization exists
   */
  private async ensureOrganization(): Promise<void> {
    const org = await prisma.organization.findUnique({
      where: { id: this.config.organizationId },
    });

    if (!org) {
      console.log('Creating Levi Strauss organization...');
      await prisma.organization.create({
        data: {
          id: this.config.organizationId,
          name: 'Levi Strauss & Co.',
          email_domain: 'levi.com',
          is_root: false,
          address_line1: '1155 Battery Street',
          city: 'San Francisco',
          state: 'CA',
          zip_code: '94111',
          country: 'United States',
          customer_type: 'Enterprise',
        },
      });
      console.log('✓ Organization created');
    }
  }

  /**
   * Generate mock suppliers
   */
  private async generateSuppliers(): Promise<number> {
    console.log('Generating suppliers...');

    const suppliers = getSuppliersByRisk(this.config.riskScenarios);
    let count = 0;

    for (const supplier of suppliers) {
      const supplierId = `${this.config.idPrefix}sup-${count + 1}`;

      await prisma.supplier.upsert({
        where: { id: supplierId },
        create: {
          id: supplierId,
          organization_id: this.config.organizationId,
          name: supplier.name,
          address: `${supplier.location.city}, ${supplier.location.country}`,
          country: supplier.location.country,
          country_code: supplier.location.countryCode,
          latitude: supplier.location.latitude,
          longitude: supplier.location.longitude,
          total_shipments: randomBetween(10, 500),
          destination_ports: [],
          departure_ports: [],
          hs_codes: supplier.hsCodes,
        },
        update: {
          name: supplier.name,
          updated_at: new Date(),
        },
      });

      count++;
    }

    console.log(`✓ Created ${count} suppliers`);
    return count;
  }

  /**
   * Generate mock carriers
   */
  private async generateCarriers(): Promise<number> {
    console.log('Generating carriers...');

    let count = 0;

    for (const carrier of MOCK_CARRIERS) {
      const carrierId = `${this.config.idPrefix}carrier-${carrier.scacCode}`;

      await prisma.carrier.upsert({
        where: { id: carrierId },
        create: {
          id: carrierId,
          scac_code: `${this.config.idPrefix}${carrier.scacCode}`,
          name: carrier.name,
          total_shipments: randomBetween(100, 10000),
        },
        update: {
          name: carrier.name,
          updated_at: new Date(),
        },
      });

      count++;
    }

    console.log(`✓ Created ${count} carriers`);
    return count;
  }

  /**
   * Generate mock shipments
   */
  private async generateShipments(): Promise<number> {
    console.log(`Generating ${this.config.shipmentCount} shipments...`);

    const suppliers = await prisma.supplier.findMany({
      where: {
        id: { startsWith: this.config.idPrefix },
        organization_id: this.config.organizationId,
      },
    });

    const carriers = await prisma.carrier.findMany({
      where: {
        id: { startsWith: this.config.idPrefix },
      },
    });

    if (suppliers.length === 0 || carriers.length === 0) {
      console.log('⚠️  No suppliers or carriers found. Generate them first.');
      return 0;
    }

    const routes = getRoutesByRisk(this.config.riskScenarios);
    const statuses: ShipmentStatus[] = this.generateStatusDistribution();

    let count = 0;

    for (let i = 0; i < this.config.shipmentCount; i++) {
      const shipmentId = `${this.config.idPrefix}ship-${i + 1}`;
      const supplier = randomElement(suppliers);
      const carrier = randomElement(carriers);
      const route = randomElement(routes);
      const product = randomElement(MOCK_PRODUCTS);
      const status = statuses[i % statuses.length];

      // Calculate dates based on status
      const now = new Date();
      const arrivalDate = this.calculateArrivalDate(status, now);
      const estimatedArrival = new Date(arrivalDate);
      estimatedArrival.setDate(estimatedArrival.getDate() + randomBetween(-3, 3));

      // Generate container info
      const containerCount = randomBetween(1, 5);
      const containerIds: string[] = [];
      const containerSizes: string[] = [];
      const containerTypes: string[] = [];

      for (let c = 0; c < containerCount; c++) {
        containerIds.push(generateContainerId());
        containerSizes.push(randomElement(['20', '40', '40HC', '45']));
        containerTypes.push(randomElement(['DRY', 'REEFER', 'FLAT']));
      }

      // Build shipping route description with risk metadata
      const routeDescription = `${route.departurePort.city} → ${route.destinationPort.city} [RISK:${route.riskScenarios.join(',')}]`;

      await prisma.shipment.create({
        data: {
          id: shipmentId,
          organization_id: this.config.organizationId,
          supplier_id: supplier.id,
          carrier_id: carrier.id,
          bol_number: generateBolNumber(),
          master_bol_number: Math.random() > 0.5 ? generateBolNumber() : null,
          containers_count: containerCount,
          shipping_route: routeDescription,
          value_usd: randomBetween(this.config.valueRange.min, this.config.valueRange.max),
          arrival_date: arrivalDate,
          estimated_arrival_date: estimatedArrival,
          destination_port: route.destinationPort.name,
          destination_port_code: route.destinationPort.portCode,
          departure_port: route.departurePort.name,
          departure_port_code: route.departurePort.portCode,
          last_visit_foreign_port: route.transshipmentPorts?.[0]?.name || null,
          vessel_name: randomElement(MOCK_CARRIERS.find((c) => c.scacCode === carrier.scac_code?.replace(this.config.idPrefix, ''))?.vesselNames || ['Unknown Vessel']),
          vessel_code: `V${randomBetween(100, 999)}`,
          voyage: `${randomBetween(1, 52)}W`,
          container_ids: containerIds,
          container_sizes: containerSizes,
          container_types: containerTypes,
          hs_codes: [product.hsCode],
          hs_code_descriptions: [product.description],
          product_description: `${product.description} - ${randomElement(['Spring Collection', 'Fall Collection', 'Core Essentials', 'Premium Line'])}`,
          quantity: randomBetween(100, 5000),
          quantity_unit: 'PCS',
          teu: containerCount * (randomElement([1, 2, 2.25])),
          weight: randomBetween(1000, 25000),
        },
      });

      count++;

      if (count % 10 === 0) {
        console.log(`  Progress: ${count}/${this.config.shipmentCount}`);
      }
    }

    console.log(`✓ Created ${count} shipments`);
    return count;
  }

  /**
   * Update organization context with mock supplier locations
   */
  private async updateOrganizationContext(): Promise<void> {
    console.log('Updating organization context...');

    const suppliers = await prisma.supplier.findMany({
      where: {
        id: { startsWith: this.config.idPrefix },
        organization_id: this.config.organizationId,
      },
    });

    const supplierLocations = suppliers
      .filter((s): s is typeof s & { latitude: number; longitude: number } =>
        s.latitude !== null && s.longitude !== null
      )
      .map((s) => ({
        supplier_id: s.id,
        name: s.name,
        location: {
          city: s.address?.split(',')[0] || 'Unknown',
          country: s.country || 'Unknown',
          latitude: s.latitude,
          longitude: s.longitude,
        },
        tier: 1,
      }));

    await prisma.organizationContext.upsert({
      where: { organization_id: this.config.organizationId },
      create: {
        organization_id: this.config.organizationId,
        plants: [],
        warehouses: [],
        suppliers: supplierLocations,
        shipping_lanes: [],
        monitored_risk_types: this.config.riskScenarios,
        geographic_radius_km: 200,
        severity_threshold: 0.4,
        last_erp_sync: new Date(),
      },
      update: {
        suppliers: supplierLocations,
        monitored_risk_types: this.config.riskScenarios,
        last_erp_sync: new Date(),
        updated_at: new Date(),
      },
    });

    console.log(`✓ Organization context updated with ${supplierLocations.length} supplier locations`);
  }

  /**
   * Generate status distribution based on config
   */
  private generateStatusDistribution(): ShipmentStatus[] {
    const statuses: ShipmentStatus[] = [];
    const dist = this.config.statusDistribution;

    for (let i = 0; i < dist.in_transit; i++) statuses.push('in_transit');
    for (let i = 0; i < dist.at_port; i++) statuses.push('at_port');
    for (let i = 0; i < dist.customs_hold; i++) statuses.push('customs_hold');
    for (let i = 0; i < dist.delivered; i++) statuses.push('delivered');
    for (let i = 0; i < dist.delayed; i++) statuses.push('delayed');

    // Shuffle
    return statuses.sort(() => Math.random() - 0.5);
  }

  /**
   * Calculate arrival date based on status
   */
  private calculateArrivalDate(status: ShipmentStatus, now: Date): Date {
    const date = new Date(now);

    switch (status) {
      case 'delivered':
        // Past date
        date.setDate(date.getDate() - randomBetween(1, this.config.dateRange.pastDays));
        break;
      case 'at_port':
      case 'customs_hold':
        // Near future (1-7 days)
        date.setDate(date.getDate() + randomBetween(1, 7));
        break;
      case 'in_transit':
        // Future (7-30 days)
        date.setDate(date.getDate() + randomBetween(7, 30));
        break;
      case 'delayed':
        // Should have arrived but delayed
        date.setDate(date.getDate() - randomBetween(1, 14));
        break;
    }

    return date;
  }

  /**
   * Disconnect from database
   */
  async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }
}
