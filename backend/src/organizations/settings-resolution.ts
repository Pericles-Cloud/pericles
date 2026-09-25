import { PrismaClient } from '@prisma/client';
import type { Prisma, OrganizationContext, OrganizationSettings } from '@prisma/client';

/**
 * Settings ownership & inheritance for the org hierarchy.
 *
 * An org with `parent_organization_id` set does NOT own its configuration by
 * default: `custom_settings_enabled = false` (the column default) means every
 * settings read — OrganizationSettings, the monitoring-config fields on
 * OrganizationContext, and API keys/secrets — resolves UP the parent chain to
 * the first org that has no parent or has custom settings enabled ("the
 * owner"). The parent's edits therefore reach all inheriting descendants live.
 *
 * When `custom_settings_enabled = true`, the child's own row is authoritative
 * (it was copied from the owner at enable time) and later parent edits do NOT
 * flow down. Turning the flag back off reverts the child to live inheritance.
 *
 * API keys and secrets are a deliberate exception to the flag: they always
 * resolve to the owner, even in custom mode (credentials are parent-owned).
 *
 * `client` is injectable for tests; it defaults to the module Prisma client.
 */

const prisma = new PrismaClient();

/** Same bound as auth/middleware.ts uses for the ancestor walk. */
export const MAX_SETTINGS_HIERARCHY_DEPTH = 16;

// Code-level defaults mirroring OrganizationContext column defaults — used when
// copying monitoring config at custom-enable and when the owner has no context.
const DEFAULT_RADIUS_KM = 100;
const DEFAULT_SEVERITY_THRESHOLD = 0.5;

export interface OrgRef {
  id: string;
  name: string;
}

export interface SettingsOwnership {
  /** The org whose settings were asked for. */
  requested: OrgRef;
  /** The org whose rows are authoritative for `requested`. */
  owner: OrgRef;
  /** Immediate parent of `requested`, if any (UI display). */
  parent: OrgRef | null;
  /** True when effective settings come from a different org. */
  inherited: boolean;
  /** `requested`'s custom flag (always false while inherited). */
  customSettingsEnabled: boolean;
  /** True when `requested` has a parent at all (toggle is possible). */
  hasParent: boolean;
}

interface OrgNode {
  id: string;
  name: string;
  parent_organization_id: string | null;
  custom_settings_enabled: boolean;
  parent_organization: { id: string; name: string } | null;
}

/**
 * Walk up the hierarchy to the org that owns `organizationId`'s settings.
 *
 * Stops at the first org with no parent OR with custom settings enabled.
 * Cycles and runaway depths degrade to the deepest node reached (logged),
 * never a throw — corrupt hierarchy data must not 500 every settings read.
 */
export async function resolveSettingsOwnership(
  organizationId: string,
  client: PrismaClient = prisma
): Promise<SettingsOwnership> {
  const load = (id: string): Promise<OrgNode | null> =>
    client.organization.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        parent_organization_id: true,
        custom_settings_enabled: true,
        parent_organization: { select: { id: true, name: true } },
      },
    });

  const start = await load(organizationId);
  if (!start) {
    throw new Error(`Settings resolution: organization ${organizationId} not found`);
  }

  const visited = new Set<string>([start.id]);
  let node = start;
  let depth = 0;

  while (node.parent_organization_id && !node.custom_settings_enabled) {
    if (++depth > MAX_SETTINGS_HIERARCHY_DEPTH) {
      console.warn(`[SettingsResolution] Hierarchy deeper than ${MAX_SETTINGS_HIERARCHY_DEPTH} from ${organizationId}; stopping at ${node.id}`);
      break;
    }
    const next = await load(node.parent_organization_id);
    if (!next) break; // dangling parent (onDelete SetNull should prevent this)
    if (visited.has(next.id)) {
      console.warn(`[SettingsResolution] Cycle in org hierarchy at ${next.id} (from ${organizationId}); stopping at ${node.id}`);
      break;
    }
    visited.add(next.id);
    node = next;
  }

  return {
    requested: { id: start.id, name: start.name },
    owner: { id: node.id, name: node.name },
    parent: start.parent_organization,
    inherited: node.id !== start.id,
    customSettingsEnabled: start.custom_settings_enabled,
    hasParent: start.parent_organization_id !== null,
  };
}

/**
 * The settings row that effectively applies to `organizationId` — the OWNER's
 * row, never the child's while inherited. Returns null when the owner has no
 * row (callers fall back to code/column defaults; the GET route materializes
 * a row on the OWNER, not the child).
 */
export async function getEffectiveSettings(
  organizationId: string,
  client: PrismaClient = prisma
): Promise<{ settings: OrganizationSettings | null; ownership: SettingsOwnership }> {
  const ownership = await resolveSettingsOwnership(organizationId, client);
  const settings = await client.organizationSettings.findUnique({
    where: { organization_id: ownership.owner.id },
  });
  return { settings, ownership };
}

/**
 * The OrganizationContext whose monitoring-config fields (geo radius, severity
 * threshold, monitored risk types) apply to `organizationId`. Data fields on
 * the context (plants/suppliers/…) are per-org and are NEVER inherited — only
 * callers that read config fields should use this.
 */
export async function getEffectiveMonitoringContext(
  organizationId: string,
  client: PrismaClient = prisma
): Promise<{ context: OrganizationContext | null; ownership: SettingsOwnership }> {
  const ownership = await resolveSettingsOwnership(organizationId, client);
  const context = await client.organizationContext.findUnique({
    where: { organization_id: ownership.owner.id },
  });
  return { context, ownership };
}

/**
 * Credentials (secrets / API keys) are parent-owned for EVERY child org,
 * custom settings or not: walk to the topmost ancestor regardless of the
 * custom flag. Top-level orgs own their own keys.
 */
export async function resolveCredentialsOwner(
  organizationId: string,
  client: PrismaClient = prisma
): Promise<OrgRef> {
  const load = (id: string): Promise<Pick<OrgNode, 'id' | 'name' | 'parent_organization_id'> | null> =>
    client.organization.findUnique({
      where: { id },
      select: { id: true, name: true, parent_organization_id: true },
    });

  let node = await load(organizationId);
  if (!node) throw new Error(`Credentials resolution: organization ${organizationId} not found`);

  const visited = new Set<string>([node.id]);
  let depth = 0;
  while (node.parent_organization_id) {
    if (++depth > MAX_SETTINGS_HIERARCHY_DEPTH) {
      console.warn(`[SettingsResolution] Hierarchy deeper than ${MAX_SETTINGS_HIERARCHY_DEPTH} from ${organizationId}; stopping at ${node.id}`);
      break;
    }
    const next = await load(node.parent_organization_id);
    if (!next) break;
    if (visited.has(next.id)) {
      console.warn(`[SettingsResolution] Cycle in org hierarchy at ${next.id} (from ${organizationId}); stopping at ${node.id}`);
      break;
    }
    visited.add(next.id);
    node = next;
  }
  return { id: node.id, name: node.name };
}

/**
 * Who may flip a child's custom-settings switch: OWNER/ADMIN of the org that
 * would own the child's settings (i.e. of the chain owner above it), or a
 * root-org OWNER/ADMIN. Child-org admins never qualify — the parent owns the
 * settings. A top-level org has no toggle and returns false.
 */
export async function canManageCustomSettings(
  userId: string,
  ownership: SettingsOwnership,
  client: PrismaClient = prisma
): Promise<boolean> {
  if (!ownership.parent) return false;

  // The authority for this child = the owner of its PARENT's settings.
  // For an inherited child that is `ownership.owner`; for a custom child it is
  // the org whose settings it would revert to.
  const parentOwnership = await resolveSettingsOwnership(ownership.parent.id, client);
  const authorityOrgId = parentOwnership.owner.id;

  const membership = await client.userOrganization.findUnique({
    where: { user_id_organization_id: { user_id: userId, organization_id: authorityOrgId } },
    select: { role: true, status: true },
  });
  if (membership?.status === 'active' && ['OWNER', 'ADMIN'].includes(membership.role)) {
    return true;
  }

  // Root-org admins manage every tenant.
  const rootMembership = await client.userOrganization.findFirst({
    where: { user_id: userId, status: 'active', organization: { is_root: true } },
    select: { role: true },
  });
  return !!rootMembership && ['OWNER', 'ADMIN'].includes(rootMembership.role);
}

/**
 * Turn a child's custom settings on or off.
 *
 * ON: copy the owner's effective values into the child's own row (so parent
 * edits stop flowing down), and pin the child's monitoring-config fields to
 * the owner's current effective values — but ONLY when the child already has
 * an OrganizationContext; creating one just to copy config would also make a
 * previously context-less child eligible for monitoring.
 *
 * OFF: clear the flag; the child's row goes dormant and reads resolve up the
 * chain again (the dormant row is reused as a baseline if custom is re-enabled).
 */
export async function setCustomSettings(
  organizationId: string,
  enabled: boolean,
  client: PrismaClient = prisma
): Promise<SettingsOwnership> {
  const ownership = await resolveSettingsOwnership(organizationId, client);
  if (!ownership.hasParent) {
    throw new Error('Only a child organization can change custom settings');
  }

  // Idempotency guard: re-enabling an already-custom child must NOT re-copy
  // the owner's values over the child's existing customizations.
  if (enabled && ownership.customSettingsEnabled) {
    return ownership;
  }

  if (!enabled) {
    await client.organization.update({
      where: { id: organizationId },
      data: { custom_settings_enabled: false },
    });
    // Re-resolve: with the flag cleared, ownership now walks up the chain.
    return resolveSettingsOwnership(organizationId, client);
  }

  // Enabling requires an actual owner to copy from (the parent chain's owner).
  const source = await resolveSettingsOwnership(ownership.parent!.id, client);
  const ownerSettings = await client.organizationSettings.findUnique({
    where: { organization_id: source.owner.id },
  });

  if (ownerSettings) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, organization_id, created_at, updated_at, ...rest } = ownerSettings;
    // Reads type JSON columns as JsonValue (null included) while writes take
    // InputJsonValue; this is an unmodified DB row, so a cast is safe here.
    const columns = rest as unknown as Prisma.OrganizationSettingsUncheckedUpdateInput;
    await client.organizationSettings.upsert({
      where: { organization_id: organizationId },
      create: { organization_id: organizationId, ...rest } as Prisma.OrganizationSettingsUncheckedCreateInput,
      update: columns,
    });
  } else {
    // Owner uses column defaults; drop any dormant child row so the child
    // materializes the same defaults on next read.
    await client.organizationSettings.deleteMany({ where: { organization_id: organizationId } });
  }

  const childContext = await client.organizationContext.findUnique({
    where: { organization_id: organizationId },
  });
  if (childContext) {
    const ownerContext = await client.organizationContext.findUnique({
      where: { organization_id: source.owner.id },
    });
    await client.organizationContext.update({
      where: { organization_id: organizationId },
      data: {
        geographic_radius_km: ownerContext?.geographic_radius_km ?? DEFAULT_RADIUS_KM,
        severity_threshold: ownerContext?.severity_threshold ?? DEFAULT_SEVERITY_THRESHOLD,
        monitored_risk_types: ownerContext?.monitored_risk_types ?? [],
      },
    });
  }

  await client.organization.update({
    where: { id: organizationId },
    data: { custom_settings_enabled: true },
  });

  // Re-resolve: the child is now its own owner (custom mode).
  return resolveSettingsOwnership(organizationId, client);
}
