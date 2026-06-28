/**
 * BOL trial adapter — per-subsidiary seeding tests (Vitest, per pericles-testing).
 *
 * Verifies that syncBolContextForSubsidiaries models branded subsidiaries as
 * child Organizations (pericles-data-model Rule 5): one child org + one
 * OrganizationContext per brand, brand-isolated suppliers, idempotent re-runs,
 * tenant-safe parent verification, and dry-run. Uses a stateful fake Prisma and
 * the offline stub geocoder — fully deterministic, no DB, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { syncBolContextForSubsidiaries } from './sync-service.js';
import { createStubGeocoder } from './geocode.js';
import type { BolRow } from './types.js';

const PARENT_ID = '00000000-0000-0000-0000-000000000001';
const geocoder = createStubGeocoder({});

// Two branded subsidiaries under one parent: Sun Hydraulics (China supplier) and
// Faster (Italy supplier). Two rows each so the supplier clears the default
// minShipmentsPerSupplier=2 threshold.
const rows: BolRow[] = [
  { bol_number: 'S1', shipment_date: '2026-05-01', consignee_name: 'Sun Hydraulics', consignee_slug: 'sun-hydraulics', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', carrier_scac: 'MAEU' },
  { bol_number: 'S2', shipment_date: '2026-05-02', consignee_name: 'Sun Hydraulics', consignee_slug: 'sun-hydraulics', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', carrier_scac: 'MAEU' },
  { bol_number: 'F1', shipment_date: '2026-05-03', consignee_name: 'Faster', consignee_slug: 'faster', supplier_name: 'Milano Servo SRL', supplier_city: 'Milan', supplier_country: 'IT', destination_city: 'Newark', destination_state: 'NJ', destination_country: 'US', carrier_scac: 'MSCU' },
  { bol_number: 'F2', shipment_date: '2026-05-04', consignee_name: 'Faster', consignee_slug: 'faster', supplier_name: 'Milano Servo SRL', supplier_city: 'Milan', supplier_country: 'IT', destination_city: 'Newark', destination_state: 'NJ', destination_country: 'US', carrier_scac: 'MSCU' },
];

interface FakeOrg { id: string; parent_organization_id?: string; name: string }

function makePrisma(opts: { parentExists?: boolean; seeded?: FakeOrg[] } = {}) {
  const { parentExists = true, seeded = [] } = opts;
  const children: FakeOrg[] = [...seeded];
  let seq = 0;
  const upserts: Array<{ where: { organization_id: string }; create: Record<string, unknown> }> = [];

  const prisma = {
    organization: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === PARENT_ID
            ? (parentExists ? { id: PARENT_ID, name: 'Helios Technologies' } : null)
            : (children.find((c) => c.id === where.id) ?? null)
        )
      ),
      findFirst: vi.fn(({ where }: { where: { parent_organization_id: string; name: string } }) =>
        Promise.resolve(
          children.find(
            (c) => c.parent_organization_id === where.parent_organization_id && c.name === where.name
          ) ?? null
        )
      ),
      create: vi.fn(({ data }: { data: FakeOrg }) => {
        const org: FakeOrg = { ...data, id: `child-${++seq}` };
        children.push(org);
        return Promise.resolve({ id: org.id });
      }),
    },
    organizationContext: {
      upsert: vi.fn((arg: { where: { organization_id: string }; create: Record<string, unknown> }) => {
        upserts.push(arg);
        return Promise.resolve({ organization_id: arg.where.organization_id });
      }),
    },
  };

  return { prisma, children, upserts };
}

/** Supplier names persisted into a given child org's context upsert. */
function suppliersFor(
  upserts: Array<{ where: { organization_id: string }; create: Record<string, unknown> }>,
  orgId: string
): string[] {
  const u = upserts.find((x) => x.where.organization_id === orgId);
  const list = (u?.create.suppliers ?? []) as Array<{ name: string }>;
  return list.map((s) => s.name);
}

describe('syncBolContextForSubsidiaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates one child org + one context per brand, with suppliers isolated', async () => {
    const { prisma, children, upserts } = makePrisma();
    const res = await syncBolContextForSubsidiaries(PARENT_ID, {
      rows,
      geocoder,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(res.success).toBe(true);
    expect(res.rows_fetched).toBe(4);
    expect(res.subsidiaries).toHaveLength(2);
    expect(prisma.organization.create).toHaveBeenCalledTimes(2);
    expect(prisma.organizationContext.upsert).toHaveBeenCalledTimes(2);

    // Both children are under the parent and branded.
    const names = children.map((c) => c.name).sort();
    expect(names).toEqual(['Faster', 'Sun Hydraulics']);
    expect(children.every((c) => c.parent_organization_id === PARENT_ID)).toBe(true);

    // Brand isolation: each child's context holds only its own supplier.
    const sun = children.find((c) => c.name === 'Sun Hydraulics')!;
    const faster = children.find((c) => c.name === 'Faster')!;
    expect(suppliersFor(upserts, sun.id)).toEqual(['Shenzhen Precision Motors']);
    expect(suppliersFor(upserts, faster.id)).toEqual(['Milano Servo SRL']);
  });

  it('is idempotent — reuses an existing child instead of duplicating it', async () => {
    const { prisma, upserts } = makePrisma({
      seeded: [{ id: 'existing-sun', parent_organization_id: PARENT_ID, name: 'Sun Hydraulics' }],
    });
    const res = await syncBolContextForSubsidiaries(PARENT_ID, {
      rows,
      geocoder,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(res.success).toBe(true);
    // Only Faster is newly created; Sun Hydraulics is reused.
    expect(prisma.organization.create).toHaveBeenCalledTimes(1);
    expect(prisma.organizationContext.upsert).toHaveBeenCalledTimes(2);
    const sun = res.subsidiaries.find((s) => s.subsidiary === 'Sun Hydraulics');
    expect(sun?.created).toBe(false);
    expect(sun?.organization_id).toBe('existing-sun');
    // The reused child's context is still refreshed.
    expect(suppliersFor(upserts, 'existing-sun')).toEqual(['Shenzhen Precision Motors']);
  });

  it('refuses to write when the parent organization is missing (tenant isolation)', async () => {
    const { prisma } = makePrisma({ parentExists: false });
    const res = await syncBolContextForSubsidiaries(PARENT_ID, {
      rows,
      geocoder,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(res.success).toBe(false);
    expect(res.errors?.[0]).toContain('not found');
    expect(prisma.organization.create).not.toHaveBeenCalled();
    expect(prisma.organizationContext.upsert).not.toHaveBeenCalled();
  });

  it('does not write on dry run but still reports per-subsidiary counts', async () => {
    const { prisma } = makePrisma();
    const res = await syncBolContextForSubsidiaries(PARENT_ID, {
      rows,
      geocoder,
      dryRun: true,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(res.success).toBe(true);
    expect(res.subsidiaries).toHaveLength(2);
    expect(res.subsidiaries.every((s) => s.records_synced.suppliers === 1)).toBe(true);
    expect(res.subsidiaries.every((s) => s.organization_id === '')).toBe(true);
    expect(prisma.organization.create).not.toHaveBeenCalled();
    expect(prisma.organizationContext.upsert).not.toHaveBeenCalled();
  });

  it('fails clearly when neither rows nor companies/suppliers are provided', async () => {
    const { prisma } = makePrisma();
    const res = await syncBolContextForSubsidiaries(PARENT_ID, {
      geocoder,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(res.success).toBe(false);
    expect(res.errors?.[0]).toContain('`rows` or `companies`');
    expect(prisma.organizationContext.upsert).not.toHaveBeenCalled();
  });

  it('skips the paid Apify fetch on a dry run with no rows (cost-safety)', async () => {
    const { prisma } = makePrisma();
    // No `rows` and no geocoder: if it tried to fetch it would hit the network
    // (no token) and fail, so success:true proves the fetch was skipped.
    const res = await syncBolContextForSubsidiaries(PARENT_ID, {
      companies: ['sun-hydraulics', 'faster'],
      dryRun: true,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(res.success).toBe(true);
    expect(res.rows_fetched).toBe(0);
    expect(res.subsidiaries).toHaveLength(0);
    // Returns before the parent lookup and any write.
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.organizationContext.upsert).not.toHaveBeenCalled();
  });
});
