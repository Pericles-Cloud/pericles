/**
 * refreshClientExposureProfile (D29, #76): skips the root org, never throws.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  organization: { findUnique: vi.fn() },
  clientExposureProfile: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));

import { refreshClientExposureProfile } from './client-exposure-profile.js';

beforeEach(() => {
  fake.organization.findUnique.mockReset();
  fake.clientExposureProfile.findUnique.mockReset();
  fake.clientExposureProfile.create.mockReset();
  fake.clientExposureProfile.update.mockReset();
});

describe('refreshClientExposureProfile', () => {
  it('skips the root organization (the operator, not a customer)', async () => {
    fake.organization.findUnique.mockResolvedValue({ is_root: true });
    expect(await refreshClientExposureProfile('root', 'periodic')).toBeNull();
    expect(fake.clientExposureProfile.findUnique).not.toHaveBeenCalled();
  });

  it('never throws, so a profile problem cannot fail the data sync that triggered it', async () => {
    fake.organization.findUnique.mockRejectedValue(new Error('db down'));
    await expect(refreshClientExposureProfile('org-1', 'bol_sync')).resolves.toBeNull();
  });
});
