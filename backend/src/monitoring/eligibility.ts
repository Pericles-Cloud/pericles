/**
 * Whether one organization is monitored — the same rule the per-org cron
 * (run-once resolveOrganizationIds) and the client_monitoring fan-out apply:
 * not the root org, has an OrganizationContext, and its EFFECTIVE
 * monitoring_agent_enabled is on (read from its settings owner up the
 * hierarchy; no settings row means on). Using one rule everywhere means an org
 * the fan-out queues is never then refused by the org-scoped evaluation.
 */

import type { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './db-client.js';
import { resolveSettingsOwnership } from '../organizations/settings-resolution.js';

export async function isOrganizationMonitored(organizationId: string, client?: PrismaClient): Promise<boolean> {
  const prisma = client ?? getPrismaClient();
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { is_root: true, context: { select: { id: true } } },
  });
  if (!org || org.is_root || !org.context) return false;
  const ownerId = (await resolveSettingsOwnership(organizationId, prisma)).owner.id;
  const settings = await prisma.organizationSettings.findUnique({
    where: { organization_id: ownerId },
    select: { monitoring_agent_enabled: true },
  });
  return settings?.monitoring_agent_enabled ?? true;
}
