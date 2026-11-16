/**
 * isOrganizationMonitored: one rule for fan-out, org gate and cron (#76).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  organization: { findUnique: vi.fn() },
  organizationSettings: { findUnique: vi.fn() },
}));
const ownership = vi.hoisted(() => vi.fn());

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));
vi.mock('../organizations/settings-resolution.js', () => ({ resolveSettingsOwnership: ownership }));

import { isOrganizationMonitored } from './eligibility.js';

beforeEach(() => {
  fake.organization.findUnique.mockReset().mockResolvedValue({ is_root: false, context: { id: 'c' } });
  fake.organizationSettings.findUnique.mockReset().mockResolvedValue(null);
  ownership.mockReset().mockResolvedValue({ owner: { id: 'parent' } });
});

describe('isOrganizationMonitored', () => {
  it("reads the setting from the settings owner (inheritance), defaulting to on", async () => {
    expect(await isOrganizationMonitored('child')).toBe(true);
    expect(fake.organizationSettings.findUnique.mock.calls[0][0].where).toEqual({ organization_id: 'parent' });

    fake.organizationSettings.findUnique.mockResolvedValue({ monitoring_agent_enabled: false });
    expect(await isOrganizationMonitored('child')).toBe(false);
  });

  it('excludes the root org and orgs without an OrganizationContext', async () => {
    fake.organization.findUnique.mockResolvedValue({ is_root: true, context: { id: 'c' } });
    expect(await isOrganizationMonitored('root')).toBe(false);
    fake.organization.findUnique.mockResolvedValue({ is_root: false, context: null });
    expect(await isOrganizationMonitored('no-context')).toBe(false);
  });
});
