/**
 * BOL trial adapter — sync-service tests (Vitest, per pericles-testing).
 *
 * Covers the consequential persistence path with an injected fake Prisma client
 * and the stub geocoder — fully offline and deterministic. Asserts tenant
 * isolation (no write when the org is absent), the upsert payload shape, and
 * dry-run behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { syncBolContextForOrganization } from './sync-service.js';
import { createStubGeocoder } from './geocode.js';
import type { BolRow } from './types.js';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const geocoder = createStubGeocoder({});

const rows: BolRow[] = [
  { bol_number: 'A1', shipment_date: '2026-05-01', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', consignee_name: 'Allient Inc', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', carrier_scac: 'MAEU' },
  { bol_number: 'A2', shipment_date: '2026-05-03', supplier_name: 'Shenzhen Precision Motors', supplier_city: 'Shenzhen', supplier_country: 'CN', consignee_name: 'Allient Inc', destination_city: 'Long Beach', destination_state: 'CA', destination_country: 'US', carrier_scac: 'MAEU' },
];

interface FakePrisma {
  organization: { findUnique: ReturnType<typeof vi.fn> };
  organizationContext: { upsert: ReturnType<typeof vi.fn> };
}

function makePrisma(orgExists: boolean): FakePrisma {
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue(orgExists ? { id: ORG_ID, name: 'Allient Inc' } : null),
    },
    organizationContext: {
      upsert: vi.fn().mockResolvedValue({ organization_id: ORG_ID }),
    },
  };
}

describe('syncBolContextForOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts OrganizationContext from injected rows', async () => {
    const prisma = makePrisma(true);
    const result = await syncBolContextForOrganization(ORG_ID, {
      rows,
      geocoder,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(result.success).toBe(true);
    expect(result.rows_fetched).toBe(2);
    expect(result.records_synced.suppliers).toBe(1);
    expect(prisma.organizationContext.upsert).toHaveBeenCalledTimes(1);

    const arg = prisma.organizationContext.upsert.mock.calls[0][0] as {
      where: { organization_id: string };
      create: { organization_id: string; monitored_risk_types: string[]; last_erp_sync: Date };
    };
    expect(arg.where.organization_id).toBe(ORG_ID);
    expect(arg.create.organization_id).toBe(ORG_ID);
    expect(arg.create.monitored_risk_types).toHaveLength(10);
    expect(arg.create.last_erp_sync).toBeInstanceOf(Date);
  });

  it('refuses to write when the organization does not exist (tenant isolation)', async () => {
    const prisma = makePrisma(false);
    const result = await syncBolContextForOrganization(ORG_ID, {
      rows,
      geocoder,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('not found');
    expect(prisma.organizationContext.upsert).not.toHaveBeenCalled();
  });

  it('does not write on dry run but still reports counts', async () => {
    const prisma = makePrisma(true);
    const result = await syncBolContextForOrganization(ORG_ID, {
      rows,
      geocoder,
      dryRun: true,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(result.success).toBe(true);
    expect(result.records_synced.suppliers).toBe(1);
    expect(prisma.organizationContext.upsert).not.toHaveBeenCalled();
  });

  it('fails clearly when neither rows nor input is provided', async () => {
    const prisma = makePrisma(true);
    const result = await syncBolContextForOrganization(ORG_ID, {
      geocoder,
      prisma: prisma as unknown as PrismaClient,
    });

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('`rows` or `input`');
    expect(prisma.organizationContext.upsert).not.toHaveBeenCalled();
  });
});
