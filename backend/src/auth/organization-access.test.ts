/**
 * checkOrganizationAccess — hierarchy-aware access tests (Vitest, per pericles-testing).
 *
 * Security/tenant-isolation path: verifies direct membership, root-org global
 * access, and the parent→descendant rollup (a holding-company member reaches its
 * branded subsidiaries) — while siblings, children-of-target, and unrelated orgs
 * stay denied. Uses an injected fake Prisma client; no DB.
 */
import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkOrganizationAccess } from './middleware.js';

// Org tree:
//   root (is_root)         standex (unrelated parent)
//   helios (parent)
//     ├─ sun ─ subsub (grandchild)
//     └─ faster
interface Org { id: string; parent_organization_id: string | null; is_root: boolean }
const ORGS: Record<string, Org> = {
  root: { id: 'root', parent_organization_id: null, is_root: true },
  helios: { id: 'helios', parent_organization_id: null, is_root: false },
  sun: { id: 'sun', parent_organization_id: 'helios', is_root: false },
  subsub: { id: 'subsub', parent_organization_id: 'sun', is_root: false },
  faster: { id: 'faster', parent_organization_id: 'helios', is_root: false },
  standex: { id: 'standex', parent_organization_id: null, is_root: false },
};

interface Membership { user_id: string; organization_id: string; role: string; status: string }

function makeClient(memberships: Membership[], orgs: Record<string, Org> = ORGS) {
  return {
    userOrganization: {
      findUnique: ({ where, include }: {
        where: { user_id_organization_id: { user_id: string; organization_id: string } };
        include?: { organization?: { select?: { is_root?: boolean } } };
      }) => {
        const { user_id, organization_id } = where.user_id_organization_id;
        const m = memberships.find((x) => x.user_id === user_id && x.organization_id === organization_id);
        if (!m) return Promise.resolve(null);
        const out: Membership & { organization?: { is_root: boolean } } = { ...m };
        if (include?.organization?.select?.is_root) {
          out.organization = { is_root: orgs[m.organization_id]?.is_root ?? false };
        }
        return Promise.resolve(out);
      },
      findFirst: ({ where }: { where: { user_id: string } }) =>
        Promise.resolve(
          memberships.find(
            (x) => x.user_id === where.user_id && x.status === 'active' && orgs[x.organization_id]?.is_root
          ) ?? null
        ),
    },
    organization: {
      findUnique: ({ where }: { where: { id: string } }) => Promise.resolve(orgs[where.id] ?? null),
    },
  };
}

const active = (user_id: string, organization_id: string, role = 'MEMBER'): Membership =>
  ({ user_id, organization_id, role, status: 'active' });

function call(memberships: Membership[], userId: string, orgId: string, orgs?: Record<string, Org>) {
  return checkOrganizationAccess(userId, orgId, makeClient(memberships, orgs) as unknown as PrismaClient);
}

describe('checkOrganizationAccess', () => {
  it('grants direct membership (not via hierarchy)', async () => {
    const res = await call([active('u', 'sun', 'ADMIN')], 'u', 'sun');
    expect(res).toMatchObject({ hasAccess: true, membership: { role: 'ADMIN', isRootOrgMember: false, viaHierarchy: false } });
  });

  it('grants root-org members global access to any org', async () => {
    const res = await call([active('u', 'root', 'OWNER')], 'u', 'faster');
    expect(res).toMatchObject({ hasAccess: true, membership: { role: 'OWNER', isRootOrgMember: true, viaHierarchy: false } });
  });

  it('grants a parent-org member access to a child org (rollup)', async () => {
    const res = await call([active('u', 'helios', 'ADMIN')], 'u', 'sun');
    expect(res).toMatchObject({ hasAccess: true, membership: { role: 'ADMIN', isRootOrgMember: false, viaHierarchy: true } });
  });

  it('grants access across multiple hierarchy levels (grandparent → grandchild)', async () => {
    const res = await call([active('u', 'helios')], 'u', 'subsub');
    expect(res).toMatchObject({ hasAccess: true, membership: { viaHierarchy: true } });
  });

  it('denies a sibling org (child member cannot see a sibling)', async () => {
    const res = await call([active('u', 'sun')], 'u', 'faster');
    expect(res).toEqual({ hasAccess: false, reason: 'not_member' });
  });

  it('denies a child member access to the parent (no upward access)', async () => {
    const res = await call([active('u', 'sun')], 'u', 'helios');
    expect(res).toEqual({ hasAccess: false, reason: 'not_member' });
  });

  it('denies an unrelated org', async () => {
    const res = await call([active('u', 'helios')], 'u', 'standex');
    expect(res).toEqual({ hasAccess: false, reason: 'not_member' });
  });

  it('does not grant hierarchy access from an inactive ancestor membership', async () => {
    const inactive: Membership = { user_id: 'u', organization_id: 'helios', role: 'ADMIN', status: 'invited' };
    const res = await call([inactive], 'u', 'sun');
    expect(res).toEqual({ hasAccess: false, reason: 'not_member' });
  });

  it('returns not_found for a non-existent target org (non-root user)', async () => {
    const res = await call([active('u', 'helios')], 'u', 'ghost');
    expect(res).toEqual({ hasAccess: false, reason: 'not_found' });
  });

  it('terminates on a cyclic hierarchy instead of looping forever', async () => {
    const cyclic: Record<string, Org> = {
      a: { id: 'a', parent_organization_id: 'b', is_root: false },
      b: { id: 'b', parent_organization_id: 'a', is_root: false },
    };
    const res = await call([active('u', 'unrelated')], 'u', 'a', cyclic);
    expect(res).toEqual({ hasAccess: false, reason: 'not_member' });
  });
});
