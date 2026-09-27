/**
 * Shared descendant-walk for `?includeSubsidiaries=true` rollups.
 *
 * The org tree is deeper than one level in production (Pericles root → a
 * parent company → its branded children), but every rollup endpoint used to
 * expand only DIRECT children — so a root-org user on the default org (the
 * root) saw just its child and none of the grandchildren, where the data
 * actually lives: Atlas rendered 2 stale events, 0 shipments, 0 suppliers
 * while the DB held ~1445 events under the children.
 *
 * `collectSubtreeIds` returns the org plus every descendant at any depth, so
 * the rollup finally matches `checkOrganizationAccess`, which already grants
 * ancestor→descendant read across the whole chain.
 */
/**
 * Minimal structural slice of PrismaClient the walk needs — keeps test mocks
 * to a single `findMany` while any real PrismaClient satisfies it.
 */
export interface OrgTreeClient {
  organization: {
    findMany(args: {
      select: { id: true; parent_organization_id: true };
    }): Promise<Array<{ id: string; parent_organization_id: string | null }>>;
  };
}

/**
 * `rootId` plus all organizations below it, any depth. Always includes
 * `rootId` itself. Reads the (small) org table once and walks parent links
 * in memory; a defensive seen-set keeps a write-time-unvalidated link cycle
 * from looping forever.
 */
export async function collectSubtreeIds(rootId: string, client: OrgTreeClient): Promise<string[]> {
  const rows = await client.organization.findMany({
    select: { id: true, parent_organization_id: true },
  });

  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_organization_id) continue;
    const siblings = childrenByParent.get(row.parent_organization_id);
    if (siblings) {
      siblings.push(row.id);
    } else {
      childrenByParent.set(row.parent_organization_id, [row.id]);
    }
  }

  // Breadth-first over the children map. Iterating `subtree` while pushing
  // into it visits appended entries too (the array iterator reads by index),
  // which is exactly the queue we want — no shift, no non-null assertions.
  const subtree = [rootId];
  const seen = new Set(subtree);
  for (const current of subtree) {
    for (const child of childrenByParent.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        subtree.push(child);
      }
    }
  }
  return subtree;
}
