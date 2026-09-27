/**
 * getPositionFeed tests (Vitest, per pericles-testing).
 *
 * The mock feed MUST be a process singleton: motion is measured from each plan's
 * reference clock, so a fresh feed per request would reset that clock and freeze
 * the dots. These guard that the route-facing factory reuses one feed and that a
 * shared feed advances over time. Deterministic, offline (gazetteer geocoder).
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getPositionFeed, getOrganizationPositions } from './index.js';
import type { TrackableShipment } from './types.js';

const ship: TrackableShipment = {
  id: 'shp_idx_1',
  vessel_name: 'TEST VESSEL',
  departure_port: 'Shanghai',
  destination_port: 'Savannah',
  arrival_date: null,
  estimated_arrival_date: null,
  supplier: { name: 'Shanghai Co', latitude: 31.23, longitude: 121.47 },
};

describe('getPositionFeed', () => {
  it('returns a process singleton so the reference clock persists across polls', () => {
    expect(getPositionFeed()).toBe(getPositionFeed());
  });

  it('advances a shipment between two polls at different times', async () => {
    const feed = getPositionFeed();
    const t0 = Date.parse('2026-06-05T00:00:00Z');
    const [a] = await feed.getPositions([ship], t0);
    const [b] = await feed.getPositions([ship], t0 + 60_000); // +1 min of wall time
    // Same plan (cached at t0); a later sample must have moved the dot.
    expect(b.position).not.toEqual(a.position);
    expect(b.percent).not.toBe(a.percent);
  });
});

describe('getOrganizationPositions (subsidiary rollup)', () => {
  // Full tree incl. parent links: the rollup now walks the whole subtree
  // (collectSubtreeIds reads findMany with no where) before the id-scoped org
  // lookup (where.id.in) and the shipment query.
  const tree = [
    { id: 'parent', name: 'Helios', parent_organization_id: null },
    { id: 'subA', name: 'Sun Hydraulics', parent_organization_id: 'parent' },
    { id: 'subB', name: 'Faster', parent_organization_id: 'parent' },
    { id: 'grandchild', name: 'Balboa Water Group', parent_organization_id: 'subA' },
  ];
  const shipments = [
    { id: 'shipA', organization_id: 'subA', vessel_name: 'V1', departure_port: null, destination_port: 'Sarasota', destination_latitude: 27.3, destination_longitude: -82.5, arrival_date: null, estimated_arrival_date: null, supplier: { name: 'S', latitude: 31.23, longitude: 121.47 } },
    { id: 'shipB', organization_id: 'subB', vessel_name: 'V2', departure_port: null, destination_port: 'Maumee', destination_latitude: 41.5, destination_longitude: -83.6, arrival_date: null, estimated_arrival_date: null, supplier: { name: 'S2', latitude: 45.46, longitude: 9.19 } },
    { id: 'shipG', organization_id: 'grandchild', vessel_name: 'V3', departure_port: null, destination_port: 'Rotterdam', destination_latitude: 51.92, destination_longitude: 4.48, arrival_date: null, estimated_arrival_date: null, supplier: { name: 'S3', latitude: 52.37, longitude: 4.9 } },
  ];
  const prisma = {
    organization: {
      findMany: vi.fn(({ where }: { where?: { id?: { in: string[] } } }) => {
        if (!where) return Promise.resolve(tree); // subtree walk
        if (where.id?.in) {
          const ids = where.id.in;
          return Promise.resolve(tree.filter((o) => ids.includes(o.id)));
        }
        return Promise.resolve(tree.filter((o) => o.id === (where as { id?: string }).id));
      }),
    },
    shipment: {
      findMany: vi.fn(({ where }: { where: { organization_id: { in: string[] } } }) =>
        Promise.resolve(shipments.filter((s) => where.organization_id.in.includes(s.organization_id))),
      ),
    },
  };

  it('rolls up subsidiaries and tags each position with its owning org', async () => {
    const positions = await getOrganizationPositions(prisma as unknown as PrismaClient, 'parent', {
      includeSubsidiaries: true,
    });
    expect(positions).toHaveLength(3);
    const byShip = Object.fromEntries(positions.map((p) => [p.shipmentId, p]));
    expect(byShip.shipA.organizationName).toBe('Sun Hydraulics');
    expect(byShip.shipA.organizationId).toBe('subA');
    expect(byShip.shipB.organizationName).toBe('Faster');
    // Grandchild org (data lives two levels down in prod) rolls up too.
    expect(byShip.shipG.organizationName).toBe('Balboa Water Group');
    expect(byShip.shipG.organizationId).toBe('grandchild');
  });
});
