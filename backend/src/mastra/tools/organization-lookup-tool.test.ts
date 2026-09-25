/**
 * organization-lookup — ROOT EXCLUSION tests (Vitest, per pericles-testing).
 *
 * Pericles (root org, is_root) is the platform manager, never a customer: the
 * lookup tool is how the monitoring agent resolves a company to an id, so the
 * root org must not come back through ANY match path — including an
 * explicitly-supplied root UUID.
 *
 * Uses a mocked Prisma client (vi.mock of db-client); no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findFirst, findMany, findUnique } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../../monitoring/db-client.js', () => ({
  getPrismaClient: () => ({
    organization: { findFirst, findMany, findUnique },
  }),
}));

import { organizationLookupTool } from './organization-lookup-tool.js';

const ROOT_ID = '00000000-0000-0000-0000-000000000001';

// Mastra's returned tool takes the full invocation context; only `context`
// matters here.
/* eslint-disable @typescript-eslint/no-explicit-any */
const execute = (context: Record<string, unknown>): Promise<any> =>
  (organizationLookupTool as any).execute({ context }, {});
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue(null);
  findMany.mockReset().mockResolvedValue([]);
  findUnique.mockReset().mockResolvedValue(null);
});

describe('organization-lookup — root exclusion', () => {
  it('rejects the root org UUID even when explicitly supplied', async () => {
    const result = await execute({ query: ROOT_ID, match_type: 'id' });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ROOT_ID, is_root: false } })
    );
    expect(result.found).toBe(false);
    expect(result.message).toContain('No organization found');
  });

  it('never matches the root org by name', async () => {
    const result = await execute({ query: 'Pericles, Inc.', match_type: 'name' });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ is_root: false }),
      })
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ is_root: false }),
      })
    );
    expect(result.found).toBe(false);
  });

  it('never matches the root org by domain', async () => {
    const result = await execute({ query: 'pericles.cloud', match_type: 'domain' });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ is_root: false }),
      })
    );
    expect(result.found).toBe(false);
  });

  it('still resolves a customer org by name', async () => {
    const acme = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Acme Corp',
      email_domains: [],
      is_root: false,
      parent_organization_id: ROOT_ID,
      city: null,
      country: null,
      customer_type: null,
    };
    findFirst.mockResolvedValue(acme);

    const result = await execute({ query: 'Acme Corp', match_type: 'name' });

    expect(result.found).toBe(true);
    expect(result.organization?.id).toBe(acme.id);
  });
});
