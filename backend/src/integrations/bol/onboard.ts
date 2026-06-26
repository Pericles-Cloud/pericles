/**
 * BOL trial adapter — customer onboarding orchestrator.
 *
 * The single entry point to onboard a customer end-to-end from public
 * bill-of-lading data:
 *
 *   1. Resolve or create the PARENT customer Organization (e.g. Helios
 *      Technologies) with its business info.
 *   2. Pull BOL rows per branded subsidiary slug from ImportYeti via Apify
 *      (or accept pre-fetched/fixture rows offline).
 *   3. Create one child Organization per branded subsidiary under the parent.
 *   4. Seed each subsidiary's relational Supplier / Carrier / Shipment rows (the
 *      path Atlas + the position mocker read) AND its OrganizationContext rollup
 *      (the path the monitoring pipeline reads) — both from the same rows.
 *
 * This is the "onboard skill" entry: see pericles-customer-onboarding. The
 * scrape doctrine (actor id, slug discovery, cost) lives in
 * pericles-yetiscraper-mcp-apify; tenant isolation in pericles-tenant-isolation.
 */

import { PrismaClient } from '@prisma/client';
import {
  syncBolContextForSubsidiaries,
  type SyncBolSubsidiariesOptions,
  type SyncBolGroupResult,
} from './sync-service.js';

const defaultPrisma = new PrismaClient();

/** Business info for the parent customer org (all optional but recommended). */
export interface CustomerBusinessInfo {
  website?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  phone_number?: string;
  email_domains?: string[];
}

export interface OnboardCustomerOptions
  extends Omit<SyncBolSubsidiariesOptions, 'prisma'> {
  /** Existing parent org id. Provide this OR `customerName` to create one. */
  parentOrganizationId?: string;
  /** Customer name — used to find-or-create the parent org when no id is given. */
  customerName?: string;
  /** Business info applied to the parent org on create (and filled if missing). */
  businessInfo?: CustomerBusinessInfo;
  prisma?: PrismaClient;
}

export interface OnboardCustomerResult extends SyncBolGroupResult {
  /** True when this run created the parent customer org. */
  parent_created: boolean;
}

/**
 * Find-or-create the parent customer Organization, then seed all branded
 * subsidiaries (org hierarchy + relational tables + context) beneath it.
 */
export async function onboardCustomerFromBol(
  options: OnboardCustomerOptions,
): Promise<OnboardCustomerResult> {
  const {
    parentOrganizationId,
    customerName,
    businessInfo,
    prisma = defaultPrisma,
    verbose = false,
    ...syncOptions
  } = options;

  const log = (msg: string): void => {
    if (verbose) console.log(`[Onboard] ${msg}`);
  };

  if (!parentOrganizationId && !customerName) {
    throw new Error('Provide either parentOrganizationId or customerName');
  }

  // 1. Resolve or create the parent customer org.
  const { id: parentId, created: parentCreated } = await resolveOrCreateCustomer(
    prisma,
    { id: parentOrganizationId, name: customerName, businessInfo },
  );
  log(
    `${parentCreated ? 'Created' : 'Using'} parent customer org ${parentId}` +
      (customerName ? ` (${customerName})` : ''),
  );

  // 2-4. Seed every branded subsidiary, with the relational tables turned on so
  //      Atlas + the mocker have data to render.
  const group = await syncBolContextForSubsidiaries(parentId, {
    ...syncOptions,
    seedRelationalTables: true,
    verbose,
    prisma,
  });

  return { ...group, parent_created: parentCreated };
}

/** Find-or-create the parent customer org; never overwrites an existing name. */
async function resolveOrCreateCustomer(
  prisma: PrismaClient,
  spec: { id?: string; name?: string; businessInfo?: CustomerBusinessInfo },
): Promise<{ id: string; created: boolean }> {
  if (spec.id) {
    const existing = await prisma.organization.findUnique({
      where: { id: spec.id },
      select: { id: true },
    });
    if (!existing) throw new Error(`Parent organization ${spec.id} not found`);
    return { id: existing.id, created: false };
  }

  const name = spec.name!.trim();
  // Match a top-level org by name (parent_organization_id is null) so re-running
  // onboarding for the same customer is idempotent.
  const existing = await prisma.organization.findFirst({
    where: { name, parent_organization_id: null },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const info = spec.businessInfo ?? {};
  const child = await prisma.organization.create({
    data: {
      name,
      customer_type: 'customer',
      website: info.website ?? null,
      address_line1: info.address_line1 ?? null,
      city: info.city ?? null,
      state: info.state ?? null,
      zip_code: info.zip_code ?? null,
      country: info.country ?? 'US',
      phone_number: info.phone_number ?? null,
      email_domains: info.email_domains ?? [],
    },
    select: { id: true },
  });
  return { id: child.id, created: true };
}
