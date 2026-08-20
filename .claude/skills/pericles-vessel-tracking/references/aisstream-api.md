# AISstream API — reference

Captured from https://aisstream.io/documentation on 2026-08-13. Service is in
**BETA** — the docs state there are "no guarantees and provide no SLA for
uptime." Re-check before relying on any limit below.

## Endpoint

```
wss://stream.aisstream.io/v0/stream
```

WSS only. Authentication is the API key inside the subscription message —
there is no header auth. Keys are created on the API Keys page after GitHub
sign-in. The docs note keys "were not designed to be shared on the open
internet," which is why ours are per-org server-side secrets and never reach
the browser.

## Subscription message

Sent by the client immediately after connect:

```json
{
   "APIKey": "<your api key>",
   "BoundingBoxes": [[[-90, -180], [90, 180]]],
   "FiltersShipMMSI": ["368207620", "367719770", "211476060"],
   "FilterMessageTypes": ["PositionReport"]
}
```

- `BoundingBoxes` — `[[[lat1, long1], [lat2, long2]]]`; latitude -90.0…90.0,
  longitude -180.0…180.0. Required.
- `FiltersShipMMSI` — **maximum 50 MMSI values**.
- `FilterMessageTypes` — omit for all types.

### Constraints

| Constraint | Value |
|---|---|
| Subscription must be sent within | **3 seconds** of connection |
| Max MMSIs per subscription | **50** |
| Max subscription updates | **1 per second** |
| Global-subscription throughput | ~**300 messages/second** |
| Slow consumer | connection closed if the queue exceeds a threshold |

A subscription update **replaces** the previous one — "the updated
subscription will not be the merger of the two subscriptions." Always send the
complete set.

## Response envelope

```json
{
  "MessageType": "<Message Type>",
  "Metadata": {
    "Latitude": -54.0,
    "Longitude": -87.0,
    "MMSI": 259000420,
    "ShipName": "AUGUSTSON",
    "time_utc": "2022-12-29 18:22:32.318353 +0000 UTC"
  },
  "Message": {
    "<Message Type Key>": { }
  }
}
```

`Message` is keyed by the message type name, so the payload path is
`Message.PositionReport`, `Message.ShipStaticData`, etc.

Note `time_utc` is **not ISO 8601** — it is Go's default time format
(`2006-01-02 15:04:05.000000 -0700 MST`). Parse it explicitly; `new Date()` on
it is unreliable across engines.

## Error

```json
{ "error": "Api Key Is Not Valid" }
```

## Message types

`PositionReport`, `ShipStaticData`, `BaseStationReport`,
`ExtendedClassBPositionReport`, `StandardClassBPositionReport`,
`SafetyBroadcastMessage`, `AidsToNavigationReport`,
`StandardSearchAndRescueAircraftReport`, `StaticDataReport`,
`SingleSlotBinaryMessage`, `MultiSlotBinaryMessage`, `Interrogation`,
`LongRangeAisBroadcastMessage`, `GnssBroadcastBinaryMessage`,
`DataLinkManagementMessage`, `AddressedSafetyMessage`,
`AddressedBinaryMessage`, `CoordinatedUTCInquiry`, `BinaryAcknowledge`,
`ChannelManagement`, `AssignedModeCommand`.

Two matter for Pericles:

- **`PositionReport`** — Class A position; the live dot.
- **`ShipStaticData`** — carries `ShipName` *and* MMSI (plus IMO, dimensions,
  destination), which is how the name → MMSI resolver seeds itself.

## PositionReport fields

| Field | Type / range | Notes |
|---|---|---|
| `Latitude` | -90.0…90.0 | 91 = not available |
| `Longitude` | -180.0…180.0 | 181 = not available |
| `SOG` | double | speed over ground, knots |
| `COG` | double | course over ground, degrees |
| `TrueHeading` | int 0-359 | **511 = not available** |
| `NavigationalStatus` | int code | 0 under way using engine, 1 at anchor, 5 moored, … |
| `Timestamp` | int 0-63 | UTC second of the report, not a full timestamp |
| `UserID` | int | the MMSI |

`Timestamp` is a second-of-minute, not an epoch — use `Metadata.time_utc` for
actual recency, and treat `Timestamp` values 60-63 as status codes rather than
seconds.

## Support

Issues: https://github.com/aisstream/issues
