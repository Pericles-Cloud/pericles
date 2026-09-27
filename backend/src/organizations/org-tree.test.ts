/**
 * collectSubtreeIds — the shared includeSubsidiaries descendant-walk.
 *
 * Regression contract for Atlas "events/shipments/suppliers not showing up":
 * the old rollups expanded only direct children, so the default root-org view
 * (root → parent → branded children, data on the children) came back empty.
 * These lock deep expansion, the org's own inclusion, and the cycle guard.
 */
import { describe, it, expect, vi } from 'vitest';
import { collectSubtreeIds } from './org-tree.js';

interface Row {
  id: string;
  parent_organization_id: string | null;
}

const clientOf = (rows: Row[]) => ({
  organization: {
    findMany: vi.fn().mockResolvedValue(rows),
  },
});

const TREE: Row[] = [
  { id: 'root', parent_organization_id: null },
  { id: 'parent', parent_organization_id: 'root' },
  { id: 'other', parent_organization_id: 'root' },
  { id: 'childA', parent_organization_id: 'parent' },
  { id: 'childB', parent_organization_id: 'parent' },
  { id: 'grandchild', parent_organization_id: 'childA' },
];

describe('collectSubtreeIds', () => {
  it('walks the full depth from the root (root + all descendants)', async () => {
    const ids = await collectSubtreeIds('root', clientOf(TREE));
    expect([...ids].sort()).toEqual(
      ['root', 'parent', 'other', 'childA', 'childB', 'grandchild'].sort()
    );
    expect(ids[0]).toBe('root');
  });

  it('scopes a mid-tree org to itself and its descendants only', async () => {
    const ids = await collectSubtreeIds('parent', clientOf(TREE));
    expect([...ids].sort()).toEqual(['parent', 'childA', 'childB', 'grandchild'].sort());
  });

  it('returns a leaf as itself', async () => {
    expect(await collectSubtreeIds('grandchild', clientOf(TREE))).toEqual(['grandchild']);
  });

  it('returns the org itself even when absent from the org table', async () => {
    expect(await collectSubtreeIds('ghost', clientOf(TREE))).toEqual(['ghost']);
  });

  it('terminates on a parent-link cycle (defensive)', async () => {
    const cyclic: Row[] = [
      { id: 'a', parent_organization_id: 'b' },
      { id: 'b', parent_organization_id: 'a' },
    ];
    const ids = await collectSubtreeIds('a', clientOf(cyclic));
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('reads the org table exactly once per call', async () => {
    const client = clientOf(TREE);
    await collectSubtreeIds('root', client);
    expect(client.organization.findMany).toHaveBeenCalledTimes(1);
  });
});
