/**
 * onboardCustomerFromBol — dry-run safety tests (Vitest, per pericles-testing).
 *
 * Guards the fix that a dry run never writes: the parent customer org must not be
 * created (and no child orgs / context) when dryRun is set. Uses an injected fake
 * Prisma client and the offline stub geocoder — no DB, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { onboardCustomerFromBol } from './onboard.js';
import { createStubGeocoder } from './geocode.js';
import type { BolRow } from './types.js';

const geocoder = createStubGeocoder({});

const rows: BolRow[] = [
  { bol_number: 'S1', shipment_date: '2026-05-01', consignee_name: 'Sun Hydraulics', consignee_slug: 'sun-hydraulics', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', carrier_scac: 'MAEU' },
  { bol_number: 'S2', shipment_date: '2026-05-02', consignee_name: 'Sun Hydraulics', consignee_slug: 'sun-hydraulics', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', carrier_scac: 'MAEU' },
  { bol_number: 'F1', shipment_date: '2026-05-03', consignee_name: 'Faster', consignee_slug: 'faster', supplier_name: 'Milano Servo SRL', supplier_city: 'Milan', supplier_country: 'IT', destination_city: 'Newark', destination_state: 'NJ', destination_country: 'US', carrier_scac: 'MSCU' },
  { bol_number: 'F2', shipment_date: '2026-05-04', consignee_name: 'Faster', consignee_slug: 'faster', supplier_name: 'Milano Servo SRL', supplier_city: 'Milan', supplier_country: 'IT', destination_city: 'Newark', destination_state: 'NJ', destination_country: 'US', carrier_scac: 'MSCU' },
];

/** Fake Prisma where the customer does not yet exist (forces the create path). */
function makePrisma() {
  return {
    organization: {
      findFirst: vi.fn(() => Promise.resolve(null)), // no existing parent / child
      findUnique: vi.fn(() => Promise.resolve(null)), // parent check (dry-run tolerant)
      create: vi.fn(() => Promise.resolve({ id: 'should-not-create' })),
    },
    organizationContext: { upsert: vi.fn(() => Promise.resolve({})) },
  };
}

describe('onboardCustomerFromBol — dry run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT create the parent org (or any child/context) on a dry run', async () => {
    const prisma = makePrisma();
    const res = await onboardCustomerFromBol({
      customerName: 'Helios Technologies',
      rows,
      geocoder,
      dryRun: true,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(res.success).toBe(true);
    expect(res.parent_created).toBe(true); // "would create"
    // The whole point: nothing is written on a dry run.
    expect(prisma.organization.create).not.toHaveBeenCalled();
    expect(prisma.organizationContext.upsert).not.toHaveBeenCalled();
    // Counts are still previewed from the fixture rows.
    expect(res.subsidiaries.map((s) => s.subsidiary).sort()).toEqual(['Faster', 'Sun Hydraulics']);
  });

  it('requires a parent id or customer name', async () => {
    const prisma = makePrisma();
    await expect(
      onboardCustomerFromBol({ rows, geocoder, prisma: prisma as unknown as PrismaClient }),
    ).rejects.toThrow('parentOrganizationId or customerName');
  });
});
