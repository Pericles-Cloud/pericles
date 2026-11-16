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

vi.mock('./org-memory.js', () => ({
  getStrategicPriorities: vi.fn().mockResolvedValue([]),
  getKeyAccountCommitments: vi.fn().mockResolvedValue([]),
  getStatedConcerns: vi.fn().mockResolvedValue([]),
}));

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));

import { refreshClientExposureProfile, syncClientExposureProfile, canonicalJson } from './client-exposure-profile.js';

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

    expect((writtenField('own_facilities') as Array<{ id: string }>).map((f) => f.id)).toEqual(['P1', 'W1']);
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
      expect.objectContaining({ id: 'P0', type: 'plant', latitude: null, longitude: null }),
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

