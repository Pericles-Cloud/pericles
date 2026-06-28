# Real-time tracking integration (`integrations/tracking`)

Moving dots and progressing lines on Atlas — **simulated motion over real data**.

Suppliers, carriers, BOL rows, vessel names, and lanes are all real (seeded from
public customs data by `integrations/bol`). Only the *position-over-time* is
synthesized, so the MVP demos a live-looking map without a paid carrier/AIS feed.

## The seam

One interface, two implementations:

| | |
|---|---|
| `ShipmentPositionFeed` | the contract Atlas + the API depend on (`types.ts`) |
| `MockPositionFeed` | interpolates each shipment along a sea-route at simulated, time-compressed progress (`mock-feed.ts`) — **built** |
| `LivePositionFeed` | Terminal49 (status/ETA) + AISstream (lat/lon), normalized to the same `PositionUpdate` — **TODO**, drop-in swap |

Both emit identical `PositionUpdate` objects. Swapping mock→live is a config flip
(`TRACKING_MODE=live`); no UI and no schema change.

## Files

- `types.ts` — `PositionUpdate`, `VoyagePlan`, `ShipmentPositionFeed`, config.
- `searoute.ts` — sea-route geometry: routes origin→dest through the right canals
  (Panama / Suez / Gibraltar / Malacca) with great-circle legs; distance + bearing.
- `voyage.ts` — real shipment → route polyline + departure/arrival clock (anchors
  on the BOL arrival date, else a deterministic staggered window).
- `mock-feed.ts` — `MockPositionFeed`: pure, deterministic sampling at `now`.
- `index.ts` — `getPositionFeed()` factory + env config.

## Config (env)

| var | default | meaning |
|---|---|---|
| `TRACKING_MODE` | `mock` | `mock` \| `live` |
| `TRACKING_TIME_COMPRESSION` | `2000` | clock acceleration; higher = dots move faster in a demo |
| `TRACKING_LOOP` | `true` | wrap completed voyages so the map never goes static |
| `TRACKING_OCEAN_KM_PER_DAY` | `800` | ocean speed for transit estimation (~18 kn) |

## Consumed by

`GET /api/shipments/positions?organizationId=…` → `PositionUpdate[]`, polled by
the Atlas page (`frontend/src/lib/useShipmentPositions.ts`).

## When real data arrives

Add `live-feed.ts` implementing `ShipmentPositionFeed` from Terminal49 +
AISstream, behind the doctrine's MCP/untrusted-feed rules (`pericles-external-feeds`).
The mock stays as the offline/demo path. See build skill **pericles-atlas-mocker**.
