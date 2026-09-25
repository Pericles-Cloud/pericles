/**
 * settings-resolution — ROOT-ORG BOUNDARY tests (Vitest, per pericles-testing).
 *
 * Pericles (the root org, `is_root`) is the platform manager, NOT a settings
 * donor: customer orgs directly under it own their own settings and API keys,
 * and inheritance only happens inside a customer's own tree. Every settings
 * read, API-key lookup, and monitoring-config call funnels through these
 * walks, so the boundary is asserted here.
 *
 * Uses an injected fake Prisma client; no DB.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  canManageCustomSettings,
  resolveCredentialsOwner,
  resolveSettingsOwnership,
} from './settings-resolution.js';

interface FakeOrg {
  id: string;
  name?: string;
  is_root?: boolean;
  parent?: string | null;
  custom?: boolean;
}

/**
 * Minimal stand-in for `organization.findUnique`, returning every row in the
 * shape the walks select (chain fields + parent relation). Extra fields the
 * narrower credentials select omits are harmless.
 */
function fakeClient(orgs: FakeOrg[]) {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const findUnique = vi.fn((args: { where: { id: string } }) => {
    const org = byId.get(args.where.id);
    if (!org) return Promise.resolve(null);
    const parent = org.parent ? (byId.get(org.parent) ?? null) : null;
    return Promise.resolve({
      id: org.id,
      name: org.name ?? org.id,
      is_root: org.is_root ?? false,
      parent_organization_id: org.parent ?? null,
      custom_settings_enabled: org.custom ?? false,
      parent_organization: parent
        ? { id: parent.id, name: parent.name ?? parent.id, is_root: parent.is_root ?? false }
        : null,
    });
  });
  return { client: { organization: { findUnique } } as unknown as PrismaClient, findUnique };
}

// ---------------------------------------------------------------------------
// resolveSettingsOwnership
// ---------------------------------------------------------------------------

describe('resolveSettingsOwnership — root boundary', () => {
  it('a direct child of Pericles owns its own settings (walk stops below root)', async () => {
    const { client } = fakeClient([
      { id: 'root', is_root: true, name: 'Pericles, Inc.' },
      { id: 'acme', parent: 'root', name: 'Acme Corp' },
    ]);

    const ownership = await resolveSettingsOwnership('acme', client);

    expect(ownership.owner).toEqual({ id: 'acme', name: 'Acme Corp' });
    expect(ownership.inherited).toBe(false);
    expect(ownership.hasParent).toBe(false); // root never enables the toggle
    expect(ownership.parent).toEqual({ id: 'root', name: 'Pericles, Inc.' }); // hierarchy parent, display only
  });

  it('inherits only within the customer tree: sub → customer, stopping below root', async () => {
    const { client } = fakeClient([
      { id: 'root', is_root: true, name: 'Pericles, Inc.' },
      { id: 'acme', parent: 'root', name: 'Acme Corp' },
      { id: 'acme-eu', parent: 'acme', name: 'Acme EU' },
      { id: 'acme-eu-west', parent: 'acme-eu', name: 'Acme EU West' },
    ]);

    const ownership = await resolveSettingsOwnership('acme-eu-west', client);

    expect(ownership.owner).toEqual({ id: 'acme', name: 'Acme Corp' });
    expect(ownership.inherited).toBe(true);
    expect(ownership.hasParent).toBe(true);
  });

  it('custom settings stop the walk at the child itself', async () => {
    const { client } = fakeClient([
      { id: 'root', is_root: true },
      { id: 'acme', parent: 'root' },
      { id: 'acme-eu', parent: 'acme', custom: true },
    ]);

    const ownership = await resolveSettingsOwnership('acme-eu', client);

    expect(ownership.owner).toEqual({ id: 'acme-eu', name: 'acme-eu' });
    expect(ownership.inherited).toBe(false);
  });

  it('a top-level org with no parent is its own owner', async () => {
    const { client } = fakeClient([{ id: 'solo' }]);

    const ownership = await resolveSettingsOwnership('solo', client);

    expect(ownership.owner.id).toBe('solo');
    expect(ownership.inherited).toBe(false);
    expect(ownership.hasParent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveCredentialsOwner
// ---------------------------------------------------------------------------

describe('resolveCredentialsOwner — keys never come from Pericles', () => {
  it('a direct child of Pericles owns its own keys', async () => {
    const { client } = fakeClient([
      { id: 'root', is_root: true, name: 'Pericles, Inc.' },
      { id: 'acme', parent: 'root', name: 'Acme Corp' },
    ]);

    expect(await resolveCredentialsOwner('acme', client)).toEqual({ id: 'acme', name: 'Acme Corp' });
  });

  it('walks to the customer top even when the child has custom settings', async () => {
    const { client } = fakeClient([
      { id: 'root', is_root: true },
      { id: 'acme', parent: 'root' },
      { id: 'acme-eu', parent: 'acme', custom: true },
    ]);

    expect((await resolveCredentialsOwner('acme-eu', client)).id).toBe('acme');
  });

  it('the root org itself resolves to itself', async () => {
    const { client } = fakeClient([{ id: 'root', is_root: true }]);

    expect((await resolveCredentialsOwner('root', client)).id).toBe('root');
  });
});

// ---------------------------------------------------------------------------
// canManageCustomSettings
// ---------------------------------------------------------------------------

describe('canManageCustomSettings — no toggle below Pericles', () => {
  it('is false for a direct child of Pericles without touching the DB', async () => {
    const { client, findUnique } = fakeClient([]);
    const ownership = {
      requested: { id: 'acme', name: 'Acme Corp' },
      owner: { id: 'acme', name: 'Acme Corp' },
      parent: { id: 'root', name: 'Pericles, Inc.' },
      inherited: false,
      customSettingsEnabled: false,
      hasParent: false, // root boundary
    };

    expect(await canManageCustomSettings('user-1', ownership, client)).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
