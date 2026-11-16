/**
 * Org Memory writes refresh the profile's strategic context (D29, #76).
 * Mocked Prisma client; no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  keyValueStore: { deleteMany: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  clientExposureProfile: { findUnique: vi.fn(), update: vi.fn() },
}));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('./db-client.js', () => ({ getPrismaClient: () => fake }));
vi.mock('./client-exposure-profile.js', () => ({ refreshClientExposureProfile: refresh }));

import { deleteDocument } from './org-memory.js';

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  fake.keyValueStore.deleteMany.mockReset().mockResolvedValue({ count: 1 });
  fake.keyValueStore.findMany.mockReset().mockResolvedValue([]);
  fake.clientExposureProfile.findUnique.mockReset().mockResolvedValue({ id: 'p-1' });
  fake.clientExposureProfile.update.mockReset().mockResolvedValue({});
  refresh.mockReset();
});

describe('deleteDocument', () => {
  it("refreshes the existing profile's strategic fields (cheap path), not a full rebuild", async () => {
    expect(await deleteDocument(ORG, 'doc-1')).toBe(true);

    const data = fake.clientExposureProfile.update.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(['strategic_priorities', 'key_account_commitments', 'stated_concerns'])
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('builds the full profile when the org has none yet', async () => {
    fake.clientExposureProfile.findUnique.mockResolvedValue(null);
    await deleteDocument(ORG, 'doc-1');
    expect(refresh).toHaveBeenCalledWith(ORG, 'org_memory');
  });

  it('does nothing to the profile when no document was deleted', async () => {
    fake.keyValueStore.deleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteDocument(ORG, 'missing')).toBe(false);
    expect(fake.clientExposureProfile.update).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
