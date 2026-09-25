/**
 * erp-context — ROOT EXCLUSION tests (Vitest, per pericles-testing).
 *
 * The ERP tool is the monitoring agent's footprint entry point; asking it for
 * the Pericles root org must refuse before any context row is read.
 *
 * Only the root-refusal path is tested: the customer path continues into
 * `getEffectiveMonitoringContext`, which uses the module Prisma client and
 * would need a DB (out of scope for a unit test).
 *
 * Uses a mocked Prisma client (vi.mock of db-client); no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, orgContextFindUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  orgContextFindUnique: vi.fn(),
}));

vi.mock('../../monitoring/db-client.js', () => ({
  getPrismaClient: () => ({
    organization: { findUnique },
    organizationContext: { findUnique: orgContextFindUnique },
  }),
}));

import { erpContextTool } from './erp-context-tool.js';

const ROOT_ID = '00000000-0000-0000-0000-000000000001';

/* eslint-disable @typescript-eslint/no-explicit-any */
const execute = (context: Record<string, unknown>): Promise<any> =>
  (erpContextTool as any).execute({ context }, {});
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  findUnique.mockReset();
  orgContextFindUnique.mockReset().mockResolvedValue(null);
});

describe('erp-context — root exclusion', () => {
  it('refuses the root org before reading any context', async () => {
    findUnique.mockResolvedValue({ is_root: true });

    await expect(execute({ organization_id: ROOT_ID })).rejects.toThrow(
      /excluded from monitoring/
    );

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROOT_ID },
        select: { is_root: true },
      })
    );
    expect(orgContextFindUnique).not.toHaveBeenCalled();
  });

  it('rethrows the refusal untouched (not wrapped as a database failure)', async () => {
    findUnique.mockResolvedValue({ is_root: true });

    await expect(execute({ organization_id: ROOT_ID })).rejects.toMatchObject({
      name: 'OrganizationExcludedError',
      message: expect.stringMatching(/root organization \(Pericles, Inc\.\)/),
    });
  });
});
