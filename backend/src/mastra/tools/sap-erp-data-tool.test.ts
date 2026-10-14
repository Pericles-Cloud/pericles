/**
 * SAP ERP tools — tenant-context guard tests (Vitest, per pericles-testing).
 *
 * Every SAP tool must require `organization_id` (CLAUDE.md tenant isolation).
 * These tests cover the schema requirement and the execute-time guard, and
 * confirm that a rejected call never reaches the SAP client.
 *
 * The SAP client is mocked; no network access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getPlants } = vi.hoisted(() => ({
  getPlants: vi.fn(),
}));

vi.mock('../../integrations/sap/client.js', () => ({
  sapClient: Promise.resolve({ getPlants }),
}));

import { sapGetPlantsT } from './sap-erp-data-tool.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';

/* eslint-disable @typescript-eslint/no-explicit-any */
const execute = (context: Record<string, unknown>): Promise<any> =>
  (sapGetPlantsT as any).execute({ context }, {});
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  getPlants.mockReset().mockResolvedValue({ d: { results: [] } });
});

describe('sap-get-plants — tenant context', () => {
  it('schema rejects input without organization_id', () => {
    const result = sapGetPlantsT.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('schema rejects an empty organization_id', () => {
    const result = sapGetPlantsT.inputSchema.safeParse({ organization_id: '' });
    expect(result.success).toBe(false);
  });

  it('execute refuses to call SAP when organization_id is missing', async () => {
    // Mastra validates input against inputSchema before execute runs, and
    // returns the failure as { error: true, message } rather than throwing.
    const result = await execute({ plant_type: 'all' });

    expect(result.error).toBe(true);
    expect(result.message).toMatch(/organization_id/);
    expect(getPlants).not.toHaveBeenCalled();
  });

  it('execute runs when organization_id is supplied', async () => {
    const result = await execute({ organization_id: ORG_ID, plant_type: 'all' });

    expect(getPlants).toHaveBeenCalledTimes(1);
    expect(result.plants).toEqual([]);
    expect(result.total_count).toBe(0);
  });
});
