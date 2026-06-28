# LivePositionFeed contract (the swap target)

When real data access arrives, add `backend/src/integrations/tracking/live-feed.ts`
implementing `ShipmentPositionFeed`. It must emit the **same `PositionUpdate`**
the mock does, so Atlas and `/api/shipments/positions` change nothing.

## Sources

| Layer | Source | Notes |
|---|---|---|
| Status + ETA + milestones | **Terminal49** | Free Developer Key tracks up to 10 active containers; push webhooks on milestones/ETAs; all US terminals + major steamship lines. Paid for higher volume. |
| Vessel lat/lon + bearing | **AISstream.io** | Free AIS WebSocket (beta, no SLA). Subscribe by vessel MMSI / bounding box. **Cannot go browser-direct** — the HTTP/2 upgrade is flaky; connect via a Node proxy that forwards to the client. The feed server IS that proxy. |
| (later) predictive ETA / congestion | Vizion / SeaVantage / Kpler | Paid. Post-MVP. |

MarineTraffic is now a Kpler property — if licensed AIS is ever needed, evaluate
Kpler's container API rather than the legacy MarineTraffic endpoints.

## Rules (doctrine)

- Behind the MCP/untrusted-feed boundary (`pericles-external-feeds`): treat every
  response as untrusted, timeout-bounded, and degrade gracefully (skip a row,
  never throw the whole feed).
- Identifier source: live tracking needs container/BL numbers (Terminal49) and
  vessel MMSIs (AISstream) for **currently in-transit** shipments. Historical BOL
  rows don't carry these as "live" — they come from the customer's ERP/forwarder
  (`pericles-erp-adapter`) or a small live test set. This is exactly why the MVP
  mocks motion instead.

## Normalization

Map each source onto `PositionUpdate`:

- `position` ← AISstream PositionReport lat/lon (or last known).
- `bearing` ← AIS course-over-ground.
- `status` / `percent` / `eta` ← Terminal49 milestones + ETA.
- `covered_km` / `remaining_km` ← distance along the route vs AIS position.
- `polyline` ← the planned sea-route (reuse `searoute.ts`) OR the actual AIS
  track once enough points accrue.
- `source: 'live'`.

## Optional persistence

Live positions may persist last-known state for fast first paint. If so, add to
the `Shipment` model (migration — NOT needed for the mock):

```prisma
current_lat            Float?
current_lng            Float?
position_status        String?   // departing | in_transit | arriving | arrived
position_eta           DateTime?
position_updated_at    DateTime?
```

Keep `getPositions` the read path either way, so the seam holds.
