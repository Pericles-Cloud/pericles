/**
 * refreshClientExposureProfile (D29, #76): skips the root org, never throws.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  organization: { findUnique: vi.fn() },
  clientExposureProfile: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  supplier: { findMany: vi.fn() },
  shipment: { findMany: vi.fn() },
  carrier: { findMany: vi.fn() },
  organizationContext: { findUnique: vi.fn() },
}));

const orgMemory = vi.hoisted(() => ({
  getStrategicPriorities: vi.fn(),
  getKeyAccountCommitments: vi.fn(),
  getStatedConcerns: vi.fn(),
}));
vi.mock('./org-memory.js', () => orgMemory);

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));

import { refreshClientExposureProfile, syncClientExposureProfile, canonicalJson, writeProfileContent } from './client-exposure-profile.js';

const PROFILE = { id: 'p-1', organization_id: 'org-1', profile_version: 4 };

beforeEach(() => {
  fake.organization.findUnique.mockReset();
  fake.clientExposureProfile.findUnique.mockReset().mockResolvedValue(PROFILE);
  fake.clientExposureProfile.findUniqueOrThrow.mockReset().mockResolvedValue(PROFILE);
  fake.clientExposureProfile.upsert.mockReset().mockResolvedValue(PROFILE);
  fake.clientExposureProfile.update.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...PROFILE, profile_version: 'profile_version' in data ? 5 : 4 })
  );
  fake.$transaction.mockReset().mockImplementation((fn: (tx: unknown) => unknown) => fn(fake));
  fake.$queryRaw.mockReset().mockResolvedValue([]);
  fake.supplier.findMany.mockReset().mockResolvedValue([]);
  fake.shipment.findMany.mockReset().mockResolvedValue([]);
  fake.carrier.findMany.mockReset().mockResolvedValue([]);
  fake.organizationContext.findUnique.mockReset().mockResolvedValue(null);
  orgMemory.getStrategicPriorities.mockReset().mockResolvedValue([]);
  orgMemory.getKeyAccountCommitments.mockReset().mockResolvedValue([]);
  orgMemory.getStatedConcerns.mockReset().mockResolvedValue([]);
});

const versionBumped = () =>
  fake.clientExposureProfile.update.mock.calls.some((c) => 'profile_version' in c[0].data);
const writtenField = (field: string) =>
  fake.clientExposureProfile.update.mock.calls.map((c) => c[0].data).find((d) => field in d)?.[field];

describe('refreshClientExposureProfile', () => {
  it('skips the root organization (the operator, not a customer)', async () => {
    fake.organization.findUnique.mockResolvedValue({ is_root: true });
    expect(await refreshClientExposureProfile('root', 'periodic')).toBeNull();
    expect(fake.clientExposureProfile.findUnique).not.toHaveBeenCalled();
  });

  it('never throws, so a profile problem cannot fail the data sync that triggered it', async () => {
    fake.organization.findUnique.mockRejectedValue(new Error('db down'));
    await expect(refreshClientExposureProfile('org-1', 'bol_sync')).resolves.toBeNull();
  });
});

describe('syncClientExposureProfile', () => {
  it('builds own facilities and ERP-only suppliers from OrganizationContext (SAP/BOL)', async () => {
    fake.supplier.findMany.mockResolvedValue([
      { id: 's-db', name: 'Acme', latitude: 1, longitude: 2, country_code: 'US', hs_codes: [] },
    ]);
    fake.organizationContext.findUnique.mockResolvedValue({
      plants: [{ plant_id: 'P1', name: 'Plant 1', plant_type: 'manufacturing', location: { latitude: 10, longitude: 20 }, country: 'DE' }],
      warehouses: [{ warehouse_id: 'W1', name: 'WH 1', location: { latitude: 11, longitude: 21 }, country: 'DE' }],
      suppliers: [
        { supplier_id: 'S-ACME', name: 'acme ', location: { latitude: 1, longitude: 2 }, country: 'US', tier: 1, critical: false },
        { supplier_id: 'S-SAP', name: 'Only In SAP', location: { latitude: 3, longitude: 4 }, country: 'MX', tier: 2, critical: true },
      ],
    });

    await syncClientExposureProfile('org-1');

    expect((writtenField('own_facilities') as Array<{ id: string }>).map((f) => f.id)).toEqual(['plant:P1', 'warehouse:W1']);
    // Context supplier with the same name as a table supplier is not duplicated.
    expect((writtenField('suppliers') as Array<{ id: string }>).map((s) => s.id)).toEqual(['s-db', 'S-SAP']);
  });

  const unchangedRow = {
    ...PROFILE,
    own_facilities: [],
    suppliers: [],
    products: [],
    logistics: { routes: [], carriers: [] }, // jsonb key order differs: still "unchanged"
    shipments_in_transit: [],
    strategic_priorities: null,
    key_account_commitments: null,
    stated_concerns: null,
  };

  it('does not bump the profile version when content did not change', async () => {
    fake.clientExposureProfile.findUniqueOrThrow.mockResolvedValue(unchangedRow);
    const result = await syncClientExposureProfile('org-1');
    expect(versionBumped()).toBe(false);
    expect(result.profileVersion).toBe(4);
  });

  it('bumps the version when content changed, in the same transaction as the write, under the row lock', async () => {
    fake.clientExposureProfile.findUniqueOrThrow.mockResolvedValue({ ...unchangedRow, suppliers: [{ id: 'old' }] });
    const result = await syncClientExposureProfile('org-1');
    expect(versionBumped()).toBe(true);
    expect(result.profileVersion).toBe(5);
    expect(fake.clientExposureProfile.update).toHaveBeenCalledTimes(1);
    expect((fake.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?')).toMatch(/FOR UPDATE/);
  });

  it('treats (0, 0) coordinates from SAP as missing, not a real site', async () => {
    fake.organizationContext.findUnique.mockResolvedValue({
      plants: [{ plant_id: 'P0', name: 'No coords', location: { latitude: 0, longitude: 0 }, country: 'XX' }],
      warehouses: [],
      suppliers: [],
    });
    await syncClientExposureProfile('org-1');
    expect(writtenField('own_facilities')).toEqual([
      expect.objectContaining({ id: 'plant:P0', type: 'plant', latitude: null, longitude: null }),
    ]);
  });
});

describe('canonicalJson', () => {
  it('ignores object key order (jsonb reorders keys) but not array order or values', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(null)).toBe(canonicalJson(undefined));
  });
});

describe('syncClientExposureProfile — round 3', () => {
  it('creates no profile for an org with no exposure-relevant data', async () => {
    fake.clientExposureProfile.findUnique.mockResolvedValue(null);
    const result = await syncClientExposureProfile('org-empty');
    expect(result.profileVersion).toBe(0);
    expect(fake.clientExposureProfile.upsert).not.toHaveBeenCalled();
  });

  it('does not rewrite content when nothing changed (only the sync stamps)', async () => {
    fake.clientExposureProfile.findUniqueOrThrow.mockResolvedValue({
      ...PROFILE,
      own_facilities: [],
      suppliers: [],
      products: [],
      logistics: { carriers: [], routes: [] },
      shipments_in_transit: [],
      strategic_priorities: null,
      key_account_commitments: null,
      stated_concerns: null,
    });
    await syncClientExposureProfile('org-1');
    const data = fake.clientExposureProfile.update.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['last_erp_sync', 'last_org_memory_sync', 'last_shipment_sync']);
  });

  it('keeps the context tier/critical flags on a supplier that is also in the Supplier table', async () => {
    fake.supplier.findMany.mockResolvedValue([
      { id: 's-db', name: 'Acme', latitude: 1, longitude: 2, country_code: 'US', hs_codes: [] },
    ]);
    fake.organizationContext.findUnique.mockResolvedValue({
      plants: [],
      warehouses: [],
      suppliers: [{ supplier_id: 'S-ACME', name: 'ACME', tier: 1, critical: true, location: { latitude: 1, longitude: 2 } }],
    });
    await syncClientExposureProfile('org-1');
    expect(writtenField('suppliers')).toEqual([expect.objectContaining({ id: 's-db', tier: 1, critical: true })]);
  });

  it('caps in-transit shipments to those arriving soonest', async () => {
    await syncClientExposureProfile('org-1');
    const inTransit = fake.shipment.findMany.mock.calls.map((c) => c[0]).find((q) => q.take === 500);
    expect(inTransit.orderBy).toEqual([{ estimated_arrival_date: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]);
  });

  it('retries once when a concurrent first writer created the profile row', async () => {
    fake.clientExposureProfile.findUniqueOrThrow.mockResolvedValue({ ...PROFILE, suppliers: [{ id: 'old' }] });
    fake.$transaction
      .mockImplementationOnce(() => Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })))
      .mockImplementation((fn: (tx: unknown) => unknown) => fn(fake));
    const result = await syncClientExposureProfile('org-1');
    expect(fake.$transaction).toHaveBeenCalledTimes(2);
    expect(result.profileVersion).toBe(5);
  });
});

describe('syncClientExposureProfile — round 4', () => {
  it('namespaces facility ids by kind and drops entries without an id', async () => {
    fake.organizationContext.findUnique.mockResolvedValue({
      plants: [{ plant_id: '1000', name: 'Plant', location: { latitude: 1, longitude: 1 } }, { name: 'No id' }],
      warehouses: [{ warehouse_id: '1000', name: 'WH', location: { latitude: 2, longitude: 2 } }],
      suppliers: [],
    });
    await syncClientExposureProfile('org-1');
    expect((writtenField('own_facilities') as Array<{ id: string }>).map((f) => f.id)).toEqual([
      'plant:1000',
      'warehouse:1000',
    ]);
  });
});

describe('round 5', () => {
  it('treats a single zero coordinate from SAP as missing', async () => {
    fake.organizationContext.findUnique.mockResolvedValue({
      plants: [{ plant_id: 'P', name: 'Half', location: { latitude: 0, longitude: 103.8 } }],
      warehouses: [],
      suppliers: [],
    });
    await syncClientExposureProfile('org-1');
    expect(writtenField('own_facilities')).toEqual([expect.objectContaining({ latitude: null, longitude: null })]);
  });

  it('skips context suppliers without an id, adds duplicate names once, and defaults tier/critical', async () => {
    fake.supplier.findMany.mockResolvedValue([
      { id: 's-db', name: 'Table Only', latitude: 1, longitude: 2, country_code: 'US', hs_codes: [] },
    ]);
    fake.organizationContext.findUnique.mockResolvedValue({
      plants: [],
      warehouses: [],
      suppliers: [
        { name: 'No Id', location: { latitude: 5, longitude: 5 } },
        { supplier_id: 'A1', name: 'Acme', location: { latitude: 5, longitude: 5 } },
        { supplier_id: 'A2', name: 'ACME', location: { latitude: 6, longitude: 6 } },
      ],
    });
    await syncClientExposureProfile('org-1');
    const suppliers = writtenField('suppliers') as Array<{ id: string; tier: number; critical: boolean }>;
    expect(suppliers.map((x) => x.id)).toEqual(['s-db', 'A1']);
    expect(suppliers[0]).toMatchObject({ tier: 1, critical: false });
  });

  it('no writer creates a profile from an all-empty patch', async () => {
    fake.clientExposureProfile.findUnique.mockResolvedValue(null);
    const result = await writeProfileContent('org-x', { strategic_priorities: null, stated_concerns: [] });
    expect(result).toEqual({ profileVersion: 0, changed: false });
    expect(fake.$transaction).not.toHaveBeenCalled();
  });
});

