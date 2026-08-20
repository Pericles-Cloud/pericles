'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import Link from 'next/link';
import { Ship } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import {
  Shipment,
  Supplier,
  Event,
  TransportMode,
  getShipments,
  getSuppliers,
  getEvents,
} from '@/lib/api-client';
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Polyline,
  InfoWindow,
  OverlayView,
} from '@react-google-maps/api';
import { findPortCoordinates } from '@/lib/port-coordinates';
import { planSeaRoute, buildStraightPath } from '@/lib/searoute';
import { PERICLES, mapColors, severityLabel, subsidiaryColor } from '@/lib/atlas-brand';
import { getRiskBgColor, getRiskColor } from '@/lib/intelligence-utils';
import { TRANSPORT_MODES, MODE_MARKER_MODES, transportModeInfo } from '@/lib/transport-mode';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useShipmentPositions } from '@/lib/useShipmentPositions';
import { formatCurrencyUsd, formatShortDate } from '@/lib/format';
import { useResolvedDark } from '@/lib/use-resolved-dark';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

const containerStyle = { width: '100%', height: '100%' };
const defaultCenter = { lat: 20, lng: 0 };
const defaultZoom = 2;

// Roadmap styling, built from the brand ramps (applies in 'roadmap' only).
// The Maps API cannot read CSS custom properties, so these are literal hexes
// taken from the ramps in globals.css — keep them in sync.
const HIDDEN: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', stylers: [{ visibility: 'off' }] },
];

const mapStylesLight: google.maps.MapTypeStyle[] = [
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D7D1E0' }] }, // purple-200
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#F6F5F7' }] }, // grey-100
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#A4A0AB' }] }, // grey-400
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#5F5A68' }] }, // grey-600
  ...HIDDEN,
];

// Dark canvas: land sits just above the page background so the map reads as a
// surface, water drops below it, and labels lift to the muted foreground.
const mapStylesDark: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#423851' }] }, // purple-700
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0F0D11' }] }, // grey-950
  { elementType: 'labels.text.fill', stylers: [{ color: '#A4A0AB' }] }, // grey-400
  // grey-950 is the darkest step there is, so 1.76:1 vs the land is the most
  // separation a coastline can get here. (2.25:1 would need purple-600 land,
  // which drops the dark subsidiary palette to 2.60:1 — under the 3:1 floor the
  // whole per-mode palette exists to clear. The vessels win over the coastline.)
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0F0D11' }] }, // grey-950 — 1.76:1 vs land
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#423851' }] }, // purple-700 — NOT purple-600: that is the light-mode supplier-pin fill
  // grey-500, NOT grey-700: grey-700 is 1.07:1 on purple-700 land, so national
  // borders did not render at all. grey-500 is 2.56:1, matching the 2.36:1 the
  // light map gets from grey-400 on grey-100 land.
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#7D7887' }] }, // grey-500
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#A4A0AB' }] }, // grey-400
  ...HIDDEN,
];

interface ShipmentRoute {
  shipment: Shipment;
  origin: { lat: number; lng: number; name: string } | null;
  destination: { lat: number; lng: number; name: string } | null;
  path: Array<{ lat: number; lng: number }>;
}

interface MapPin {
  id: string;
  position: { lat: number; lng: number };
  type: 'origin' | 'destination';
  name: string;
  /** The actual shipments contributing to this pin (#11) — distinct from any
   * independently-seeded count from the ERP/BOL source. Count is always
   * shipments.length, not a separately-tracked field — two numbers for one
   * fact is a state-sync bug waiting to happen. */
  shipments: Shipment[];
}

type TimelinessFilter = 'all' | 'active' | 'completed';
type MapType = 'roadmap' | 'hybrid';
type EventTypeFilter = 'all' | 'conflict' | 'political-violence' | 'strike' | 'weather' | 'financial' | 'generic';

export default function AtlasPage() {
  const { currentOrganization } = useAuth();
  // Correct on the first paint — passing `styles: undefined` while next-themes
  // resolves would flash Google's stock roadmap (POIs, roads, transit).
  const isDarkMap = useResolvedDark();
  // Pins/routes must flip with the map: the light-mode brand purple cannot
  // reach 3:1 on any dark surface (see MAP_COLORS).
  const mapPalette = mapColors(isDarkMap);

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeliness, setTimeliness] = useState<TimelinessFilter>('all');
  const [mapType, setMapType] = useState<MapType>('roadmap');
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<ShipmentRoute | null>(null);
  // Collapsed by default so the map reads as the whole surface (GH #8).
  const [isFeedOpen, setIsFeedOpen] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>('all');
  // Shared geocoder for the location search box. A supplier-city reverse
  // geocode used to live here too (GH #11) but was removed when the origin pin
  // became the Port of Origin (GH #9) — origin pins are ports, whose names come
  // straight from the BOL, so no reverse-geocoding is needed anymore.
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  const mapRef = useRef<google.maps.Map | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });

  // Live vessel positions: mock-simulated motion over real BOL lanes today;
  // swaps to Terminal49 + AISstream when TRACKING_MODE=live, no UI change.
  // See backend/src/integrations/tracking + build skill pericles-atlas-mocker.
  // Roll up across the org's branded subsidiaries so a parent shows its whole
  // fleet; each vessel is tagged with its owning org for color-coding.
  const { positions: vesselPositions } = useShipmentPositions(currentOrganization?.id, 4000, true);

  // Assign a stable, distinct color per subsidiary (sorted by name) + the legend.
  const subsidiaries = useMemo(() => {
    const byId = new Map<string, { name: string; count: number }>();
    for (const v of vesselPositions) {
      if (!v.organizationId) continue;
      const e = byId.get(v.organizationId);
      if (e) e.count += 1;
      else byId.set(v.organizationId, { name: v.organizationName ?? 'Unknown', count: 1 });
    }
    const sorted = [...byId.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
    // Mode-aware: the light set is 2.03–2.42:1 on the dark land, under the 3:1
    // non-text floor, so subsidiary vessels/routes would vanish in dark mode.
    return sorted.map(([id, info], i) => ({ id, color: subsidiaryColor(i, isDarkMap), ...info }));
  }, [vesselPositions, isDarkMap]);

  const colorByOrg = useMemo(
    () => new Map(subsidiaries.map((s) => [s.id, s.color])),
    [subsidiaries],
  );
  // Falls back to the port colour for vessels with no subsidiary — mode-aware,
  // since gold-500 is unreadable on the dark map.
  const vesselColor = (orgId?: string): string =>
    (orgId ? colorByOrg.get(orgId) : undefined) ?? mapPalette.port;

  // Fetch data (BOL-shaped Supplier[] + Shipment[] + Event[]), tenant-scoped.
  useEffect(() => {
    if (!currentOrganization?.id) return;
    let isMounted = true;

    const fetchData = async () => {
      setIsLoading(true);
      // Roll up across branded subsidiaries so the stats + supplier/port lines
      // match the live vessel layer (which also rolls up). The server scopes to
      // the org + its subsidiaries, so no client-side org filter is needed.
      const [shipmentsRes, suppliersRes, eventsRes] = await Promise.all([
        getShipments(currentOrganization.id, { includeSubsidiaries: true }),
        getSuppliers({ organizationId: currentOrganization.id, includeSubsidiaries: true }),
        getEvents({ organizationId: currentOrganization.id, limit: 50, includeSubsidiaries: true }),
      ]);
      if (!isMounted) return;
      if (shipmentsRes.success && shipmentsRes.data) setShipments(shipmentsRes.data);
      if (suppliersRes.success && suppliersRes.data) {
        setSuppliers(suppliersRes.data);
      }
      if (eventsRes.success && eventsRes.data) setEvents(eventsRes.data.events);
      setIsLoading(false);
    };

    fetchData();
    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id]);

  // Routes: Port of Origin (departure port) → destination port. Maritime legs
  // follow the sea-route arcs through the canals (GH #9); air/rail/road legs
  // are straight lines — they don't follow water.
  const shipmentRoutes = useMemo((): ShipmentRoute[] => {
    return shipments
      .map((shipment) => {
        const supplier = suppliers.find((s) => s.id === shipment.supplierId);
        // Real lanes load at a port, so the route starts at the departure port
        // (the "Port of Origin"). Falls back to the supplier's own coordinates
        // when the departure port is unknown (real BOL data can name a
        // non-gazetteered origin port); a supplier-location origin still beats
        // no route at all.
        const portOfOrigin = findPortCoordinates(shipment.departurePort);
        const origin = portOfOrigin
          ? { lat: portOfOrigin.lat, lng: portOfOrigin.lng, name: portOfOrigin.name }
          : supplier?.latitude && supplier?.longitude
            ? { lat: supplier.latitude, lng: supplier.longitude, name: supplier.name }
            : null;
        const destPort = findPortCoordinates(shipment.destinationPort);
        const destination = destPort
          ? { lat: destPort.lat, lng: destPort.lng, name: destPort.name }
          : null;
        const path =
          origin && destination
            ? shipment.modeOfTransport === 'MARITIME'
              ? planSeaRoute(origin, destination)
              : buildStraightPath(origin, destination)
            : [];
        return { shipment, origin, destination, path };
      })
      .filter((route) => route.origin || route.destination);
  }, [shipments, suppliers]);

  const filteredRoutes = useMemo(() => {
    if (timeliness === 'all') return shipmentRoutes;
    return shipmentRoutes.filter((route) => {
      const hasArrived =
        route.shipment.arrivalDate && new Date(route.shipment.arrivalDate) < new Date();
      if (timeliness === 'completed') return hasArrived;
      if (timeliness === 'active') return !hasArrived;
      return true;
    });
  }, [shipmentRoutes, timeliness]);

  // Non-maritime mode icons at route origins (GH #10). One icon per
  // supplier+mode pair so overlapping air/rail/road legs from one supplier
  // don't stack badges. Maritime is the ocean-BOL default and reads via the
  // sea-route arcs + vessel layer, so it gets no origin marker.
  const modeMarkers = useMemo(() => {
    const seen = new Set<string>();
    const markers: { key: string; position: { lat: number; lng: number }; mode: TransportMode }[] = [];
    for (const route of filteredRoutes) {
      const mode = route.shipment.modeOfTransport;
      if (!MODE_MARKER_MODES.includes(mode)) continue;
      if (!route.origin) continue;
      const key = `${route.shipment.supplierId ?? 'no-supplier'}:${mode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({ key, position: { lat: route.origin.lat, lng: route.origin.lng }, mode });
    }
    return markers;
  }, [filteredRoutes]);

  // Ship positions keyed by shipment id, for the solid/dashed route split
  // (GH #9). Only maritime legs are tracked (see #10).
  const positionByShipment = useMemo(
    () => new Map(vesselPositions.map((v) => [v.shipmentId, v])),
    [vesselPositions],
  );

  // Pins, deduplicated by location. Built from filteredRoutes (not the full
  // shipmentRoutes), so the popup's shipment list/count always matches what the
  // active timeliness filter is actually showing on the map (#11 review
  // finding).
  const mapPins = useMemo((): MapPin[] => {
    const pins = new Map<string, MapPin>();
    const addToPin = (key: string, shipment: Shipment, build: () => MapPin) => {
      const existing = pins.get(key);
      if (existing) {
        existing.shipments.push(shipment);
      } else {
        pins.set(key, build());
      }
    };
    filteredRoutes.forEach((route) => {
      if (route.origin) {
        // Keyed by origin coordinates (GH #9): every shipment that loads at
        // the same Port of Origin shares one pin, even across suppliers. Two
        // distinct suppliers whose BOLs load at the same port merge here by
        // design — the popup lists each one separately.
        const key = `origin-${route.origin.lat}-${route.origin.lng}`;
        addToPin(key, route.shipment, () => ({
          id: key,
          position: { lat: route.origin!.lat, lng: route.origin!.lng },
          type: 'origin',
          name: route.origin!.name,
          shipments: [route.shipment],
        }));
      }
      if (route.destination) {
        const key = `destination-${route.destination.lat}-${route.destination.lng}`;
        addToPin(key, route.shipment, () => ({
          id: key,
          position: { lat: route.destination!.lat, lng: route.destination!.lng },
          type: 'destination',
          name: route.destination!.name,
          shipments: [route.shipment],
        }));
      }
    });

    return Array.from(pins.values());
  }, [filteredRoutes]);

  // Derived, not its own state: re-reads mapPins every render so the open
  // popup's shipment list/count always reflects the current timeliness
  // filter, and auto-closes (becomes null) if the filter removes every
  // shipment that placed this pin on the map (#11 review round 2).
  const selectedPin = useMemo(
    () => (selectedPinId ? (mapPins.find((p) => p.id === selectedPinId) ?? null) : null),
    [mapPins, selectedPinId]
  );

  const openEvents = useMemo(
    () => {
      let filtered = events.filter(
        (e) => e.validationStatus !== 'rejected' && e.validationStatus !== 'duplicate',
      );

      // Filter by event type
      if (eventTypeFilter !== 'all') {
        filtered = filtered.filter((e) => e.type === eventTypeFilter);
      }

      return filtered.slice(0, 10);
    },
    [events, eventTypeFilter],
  );

  // Stats reflect the org's actual (subsidiary-rolled-up) data, not just the pins
  // that resolve to coordinates — so the counter matches the live vessel layer.
  const supplierCount = suppliers.length;
  const portCount = new Set(
    shipments.map((s) => s.destinationPort).filter(Boolean),
  ).size;

  // Setters are stable, but the React Compiler infers them as dependencies and
  // refuses to preserve the memoization when they're omitted; listing them is
  // semantically identical.
  const handleMapClick = useCallback(() => {
    setSelectedPinId(null);
    setSelectedRoute(null);
  }, [setSelectedPinId, setSelectedRoute]);

  // Location search (§3.1.1): geocode the query and recenter the map.
  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const query = search.trim();
      if (!query || !mapRef.current) return;
      setSearchError(null);
      if (!geocoderRef.current) {
        geocoderRef.current = new google.maps.Geocoder();
      }
      geocoderRef.current.geocode({ address: query }, (results, status) => {
        if (status === 'OK' && results && results[0]) {
          mapRef.current?.panTo(results[0].geometry.location);
          mapRef.current?.setZoom(6);
        } else {
          setSearchError('Location not found');
        }
      });
    },
    [search],
  );

  if (!currentOrganization) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Please select an organization to view the Atlas</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card>
          <CardContent className="py-8 text-center">
            {/* risk-critical-text, not text-destructive: --destructive is the
                button fill (white on it is 5.61:1) and measures only 2.55:1 as
                TEXT on the dark card — this is the one message a user must be
                able to read when the map is broken. */}
            <p className="text-risk-critical-text">Error loading Google Maps</p>
            <p className="text-sm text-muted-foreground mt-2">Please check your API key configuration</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isLoaded || isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto"
            style={{ borderColor: mapPalette.supplier }}
          />
          <p className="mt-4 text-muted-foreground">Loading Atlas...</p>
        </div>
      </div>
    );
  }

  return (
    // The map owns the whole surface; every control floats above it (GH #8).
    <div className="relative h-full w-full">
      {/* Controls overlay. The wrapper ignores pointer events so map drags pass
          through the gaps between control clusters. */}
      <div className="pointer-events-none absolute left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] top-3 z-10 flex items-start gap-3">
        {/* The Events Feed used to sit in this row at a fixed w-80. On a 393px
            phone that left ~50px for these controls, and the w-56 input could
            not shrink into it — the two clusters rendered on top of each other.
            The feed is now its own bottom-anchored element below md. */}
        <div className="pointer-events-auto flex w-full min-w-0 flex-wrap items-center gap-2 rounded-lg bg-card/90 p-2 shadow-lg backdrop-blur sm:gap-3 md:w-auto">
          <form onSubmit={handleSearch} className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search country, city, or port…"
              className="w-full min-w-0 sm:w-56"
              aria-label="Search location"
            />
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>

          <div className="flex items-center gap-1">
            {(['all', 'active', 'completed'] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={timeliness === f ? 'default' : 'outline'}
                onClick={() => {
                  setTimeliness(f);
                  // Close any open popup rather than leave its id dangling —
                  // switching filters can remove its pin from mapPins, and
                  // switching back would otherwise silently reopen the same
                  // popup with no click, since pin ids are deterministic
                  // (#11 review round 4).
                  setSelectedPinId(null);
                }}
              >
                {f === 'all' ? 'All' : f === 'active' ? 'In Transit' : 'Arrived'}
              </Button>
            ))}
          </div>

          {/* Event type filter */}
          <div className="flex items-center gap-1">
            {(['all', 'conflict', 'political-violence', 'strike', 'weather', 'financial', 'generic'] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={eventTypeFilter === f ? 'default' : 'outline'}
                onClick={() => setEventTypeFilter(f as EventTypeFilter)}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>

          {/* View toggle (PRD §7.2) */}
          <div className="flex items-center overflow-hidden rounded-md border">
            {(['roadmap', 'hybrid'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setMapType(t)}
                className={cn(
                  'px-3 py-1.5 text-sm transition-colors',
                  mapType === t
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t === 'roadmap' ? 'Map' : 'Satellite'}
              </button>
            ))}
          </div>

          {/* Counts are secondary on a phone — they cost a whole wrapped row. */}
          <div className="hidden items-center gap-2 px-1 text-sm sm:flex">
            <span className="font-semibold">{shipments.length}</span>
            <span className="text-muted-foreground">shipments</span>
            <span className="text-muted-foreground">|</span>
            <span className="font-semibold">{supplierCount}</span>
            <span className="text-muted-foreground">suppliers</span>
            <span className="text-muted-foreground">|</span>
            <span className="font-semibold">{portCount}</span>
            <span className="text-muted-foreground">ports</span>
          </div>

          {searchError && <span className="text-sm text-risk-critical-text">{searchError}</span>}
        </div>

      </div>

      {/* Events Feed. Bottom-anchored and full width on a phone — the map is
          the point, and a fixed w-80 in the top row overlapped the controls at
          393px. From md it returns to the top-right. Expanding grows it upward,
          since the bottom edge is pinned. */}
      <div className="pointer-events-auto absolute inset-x-[max(0.75rem,env(safe-area-inset-left))] bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 flex flex-col overflow-hidden rounded-lg bg-card shadow-lg md:inset-x-auto md:bottom-auto md:right-[max(0.75rem,env(safe-area-inset-right))] md:top-3 md:w-80">
          <button
            onClick={() => setIsFeedOpen((open) => !open)}
            aria-expanded={isFeedOpen}
            aria-controls="atlas-events-feed"
            className="flex items-center gap-2 px-4 py-3 text-left font-medium transition-colors hover:bg-muted/50"
          >
            <svg
              className="size-5 shrink-0"
              style={{ color: mapPalette.port }}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              />
            </svg>
            <span className="flex-1">Events Feed</span>
            {openEvents.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                {openEvents.length}
              </span>
            )}
            <svg
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                isFeedOpen && 'rotate-180',
              )}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {isFeedOpen && (
            <div
              id="atlas-events-feed"
              // Offset by --app-header-h, not a bare 4rem: under viewportFit
              // 'cover' the header grows by the top inset and the feed would
              // overflow the map by exactly that much.
              className="max-h-[calc(100dvh-var(--app-header-h)-7rem)] overflow-y-auto border-t"
            >
              {openEvents.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  <p>No active events</p>
                  <p className="mt-1 text-xs">
                    Events appear here once the monitoring pipeline is connected.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {openEvents.map((event) => (
                    <EventFeedItem key={event.id} event={event} />
                  ))}
                </div>
              )}
            </div>
          )}
      </div>

      {/* Legend (brand-aligned) */}
      {/* bottom-20 below md so it clears the bottom-anchored Events Feed. */}
      <div className="absolute bottom-20 left-4 z-10 bg-card rounded-lg shadow-lg p-3 text-sm md:bottom-4">
        <div className="font-medium mb-2">Legend</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: mapPalette.supplier }} />
            <span>Port of Origin</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: mapPalette.port }} />
            <span>Destination Port</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5" style={{ backgroundColor: mapPalette.route }} />
            <span>Shipping Route · completed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 border-t border-dashed border-grey-500" />
            <span>Shipping Route · upcoming</span>
          </div>
          <div className="flex items-center gap-2">
            <Ship className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
            <span>Vessel position</span>
          </div>
        </div>

        <div className="mt-2 pt-2 border-t border-border">
          <div className="font-medium mb-1">Transport mode</div>
          <div className="space-y-1">
            {TRANSPORT_MODES.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.mode} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                  <span>{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {subsidiaries.length > 1 && (
          <div className="mt-2 pt-2 border-t border-border">
            <div className="font-medium mb-1">Subsidiaries · vessels</div>
            <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
              {subsidiaries.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="flex-1 truncate" title={s.name}>{s.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <GoogleMap
        mapContainerStyle={containerStyle}
        center={defaultCenter}
        zoom={defaultZoom}
        mapTypeId={mapType}
        onClick={handleMapClick}
        onLoad={(map) => {
          mapRef.current = map;
        }}
        onUnmount={() => {
          mapRef.current = null;
        }}
        options={{
          // Satellite carries its own imagery; only the roadmap is themed.
          // useResolvedDark reads the `dark` class off <html> (which next-themes
          // writes before hydration), so this resolves to the right array on the
          // first paint — next-themes' own `resolvedTheme` is undefined until
          // after mount and would flash a white map at a dark-mode user.
          styles:
            mapType === 'roadmap' ? (isDarkMap ? mapStylesDark : mapStylesLight) : undefined,
          // One-finger pan on touch; the default ('auto') demands two fingers
          // inside a scrollable page and feels broken on a phone.
          gestureHandling: 'greedy',
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          // The map already fills the viewport, and the control would sit
          // under the Events Feed bar (GH #8).
          fullscreenControl: false,
          minZoom: 2,
          maxZoom: 15,
        }}
      >
        {filteredRoutes.map((route, index) => {
          if (route.path.length === 0) return null;
          const highlight = selectedRoute?.shipment.id === route.shipment.id;
          const lineColor = highlight ? mapPalette.port : mapPalette.route;
          const position =
            route.shipment.modeOfTransport === 'MARITIME'
              ? positionByShipment.get(route.shipment.id)
              : undefined;

          // Split at the vessel's current progress (GH #9): solid behind the
          // ship, dashed ahead, ship icon at the seam. Routes without a live
          // position (non-maritime legs, or maritime legs the feed hasn't
          // resolved) render as one solid line.
          if (position && position.percent > 0 && position.percent < 1) {
            const splitIndex = Math.max(
              1,
              Math.min(route.path.length - 2, Math.round(position.percent * (route.path.length - 1))),
            );
            const completed = route.path.slice(0, splitIndex + 1);
            const upcoming = route.path.slice(splitIndex);
            const shipColor = vesselColor(position.organizationId);
            return (
              <Fragment key={`route-${route.shipment.id}-${index}`}>
                <Polyline
                  path={completed}
                  options={{
                    strokeColor: lineColor,
                    strokeOpacity: highlight ? 1 : 0.6,
                    strokeWeight: highlight ? 3 : 2,
                    geodesic: false,
                    clickable: true,
                  }}
                  onClick={() => setSelectedRoute(route)}
                />
                <Polyline
                  path={upcoming}
                  options={{
                    strokeColor: lineColor,
                    strokeOpacity: highlight ? 0.9 : 0.5,
                    strokeWeight: highlight ? 3 : 2,
                    geodesic: false,
                    clickable: true,
                    // "Distance to go" dashed (GH #9): repeated dash glyphs over
                    // a faint base, so it reads clearly against the solid
                    // behind-the-ship segment — and without the old moving-arrow
                    // glyphs, which #9 asked to remove.
                    icons: [
                      {
                        icon: {
                          path: 'M 0 -1 L 0 1',
                          strokeColor: lineColor,
                          strokeOpacity: 1,
                          strokeWeight: highlight ? 3 : 2,
                          scale: 1.2,
                        },
                        offset: '0',
                        repeat: '16px',
                      },
                    ],
                  }}
                  onClick={() => setSelectedRoute(route)}
                />
                <OverlayView
                  position={route.path[splitIndex]}
                  mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  getPixelPositionOffset={(width, height) => ({ x: -(width / 2), y: -(height / 2) })}
                >
                  <div
                    title={
                      [position.organizationName, position.vesselName].filter(Boolean).join(' · ') ||
                      'Vessel'
                    }
                    className="pointer-events-none flex h-6 w-6 items-center justify-center rounded-full border-2 bg-card shadow-md"
                    style={{ borderColor: shipColor }}
                  >
                    <Ship
                      className="h-4 w-4"
                      style={{ color: shipColor }}
                      aria-hidden
                    />
                  </div>
                </OverlayView>
              </Fragment>
            );
          }

          return (
            <Polyline
              key={`route-${route.shipment.id}-${index}`}
              path={route.path}
              options={{
                strokeColor: lineColor,
                strokeOpacity: highlight ? 1 : 0.6,
                strokeWeight: highlight ? 3 : 2,
                geodesic: false,
                clickable: true,
              }}
              onClick={() => setSelectedRoute(route)}
            />
          );
        })}

        {/* Event markers: different icons for different event types */}
        {events.map((event) => {
          if (!event.latitude || !event.longitude) return null;
          if (eventTypeFilter !== 'all' && event.type !== eventTypeFilter) return null;

          const typeToColor: Record<string, string> = {
            conflict: '#EF4444',
            'political-violence': '#F97316',
            strike: '#F59E0B',
            weather: '#3B82F6',
            financial: '#10B981',
            generic: '#6B7280',
          };


          const color = typeToColor[event.type] || typeToColor.generic;
          return (
            <Marker
              key={`event-${event.id}`}
              position={{ lat: event.latitude, lng: event.longitude }}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 6,
                fillColor: color,
                fillOpacity: 1,
                strokeColor: PERICLES.white,
                strokeWeight: 2,
              }}
            />
          );
        })}


        {modeMarkers.map((marker) => {
          const info = transportModeInfo(marker.mode);
          const Icon = info.icon;
          return (
            <OverlayView
              key={`mode-${marker.key}`}
              position={marker.position}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
              getPixelPositionOffset={(width, height) => ({ x: width / 2 + 18, y: -(height / 2) })}
            >
              <div
                title={`${info.label} leg`}
                className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card shadow-md"
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </div>
            </OverlayView>
          );
        })}

        {mapPins.map((pin) => (
          <Marker
            key={pin.id}
            position={pin.position}
            onClick={() => setSelectedPinId(pin.id)}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8 + Math.min(pin.shipments.length * 2, 10),
              fillColor: pin.type === 'origin' ? mapPalette.supplier : mapPalette.port,
              fillOpacity: 1,
              strokeColor: PERICLES.white,
              strokeWeight: 2,
            }}
          />
        ))}

        {/* InfoWindow content uses the grey RAMP, not role tokens. Google's
            bubble (.gm-style-iw-c) is always white and the map style array
            can't theme it, but the content renders inside the app DOM where
            `.dark` applies — role tokens would give near-white text on a white
            bubble. Re-scoping --foreground here would not help either: it is
            resolved into --color-foreground at :root.

            grey-600 is the FLOOR on this white bubble: grey-500 is 4.28:1, under
            AA for the 12–14px labels here. The label/value hierarchy is kept by
            darkening the values to grey-800 rather than lightening the labels. */}
        {selectedPin && (
          <InfoWindow position={selectedPin.position} onCloseClick={() => setSelectedPinId(null)}>
            <div className="p-2 w-[260px]">
              <div className="font-medium text-grey-900">{selectedPin.name}</div>
              <div className="text-sm text-grey-600 mt-1">
                {selectedPin.type === 'origin' ? 'Port of Origin' : 'Destination Port'}
              </div>
              {(() => {
                // Suppliers whose cargo loads (origin) or discharges (destination)
                // at this port, with per-supplier shipment counts. Distinct from
                // the old per-supplier pin: a port aggregates several suppliers,
                // so this lists each one with its volume instead of one total.
                const suppliersByName = new Map<string, number>();
                for (const s of selectedPin.shipments) {
                  const name = s.supplier?.name ?? 'Unknown supplier';
                  suppliersByName.set(name, (suppliersByName.get(name) ?? 0) + 1);
                }
                return (
                  <div className="text-xs text-grey-800 mt-2">
                    <span className="text-grey-600">Suppliers:</span>{' '}
                    {[...suppliersByName.entries()]
                      .map(([name, count]) => `${name}${count > 1 ? ` · ${count}` : ''}`)
                      .join(', ')}
                  </div>
                );
              })()}
              <div className="mt-2 max-h-40 overflow-y-auto border-t border-grey-200 pt-2 space-y-2">
                {selectedPin.shipments.map((shipment) => (
                  <div key={shipment.id} className="text-xs">
                    <div className="font-mono text-grey-900">{shipment.bolNumber}</div>
                    {shipment.supplier?.name && (
                      <div className="text-grey-600">{shipment.supplier.name}</div>
                    )}
                    <div className="text-grey-600">
                      {selectedPin.type === 'origin'
                        ? (shipment.destinationPort ?? 'Destination unknown')
                        : (shipment.departurePort ?? 'Origin unknown')}
                      {shipment.valueUsd != null && ` · ${formatCurrencyUsd(shipment.valueUsd)}`}
                    </div>
                    {shipment.estimatedArrivalDate ? (
                      <div className="text-grey-600">ETA: {formatShortDate(shipment.estimatedArrivalDate)}</div>
                    ) : (
                      shipment.arrivalDate && (
                        <div className="text-grey-600">Arrived: {formatShortDate(shipment.arrivalDate)}</div>
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          </InfoWindow>
        )}

        {selectedRoute && selectedRoute.destination && (
          <InfoWindow
            position={selectedRoute.destination}
            onCloseClick={() => setSelectedRoute(null)}
          >
            <div className="p-2 min-w-[200px]">
              <div className="font-medium text-grey-900 font-mono text-sm">
                {selectedRoute.shipment.bolNumber}
              </div>
              <div className="text-sm text-grey-800 mt-2 space-y-1">
                <div>
                  <span className="text-grey-600">From:</span>{' '}
                  {selectedRoute.origin?.name || selectedRoute.shipment.departurePort || 'Unknown'}
                </div>
                <div>
                  <span className="text-grey-600">To:</span>{' '}
                  {selectedRoute.destination?.name ||
                    selectedRoute.shipment.destinationPort ||
                    'Unknown'}
                </div>
                {selectedRoute.shipment.vesselName && (
                  <div>
                    <span className="text-grey-600">Vessel:</span>{' '}
                    {selectedRoute.shipment.vesselName}
                  </div>
                )}
                {selectedRoute.shipment.arrivalDate && (
                  <div>
                    <span className="text-grey-600">Arrival:</span>{' '}
                    {formatShortDate(selectedRoute.shipment.arrivalDate)}
                  </div>
                )}
              </div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  );
}

function EventFeedItem({ event }: { event: Event }) {
  // Click through to the event's detail in Intelligence (GH #12).
  return (
    <Link
      href={`/intelligence?event=${encodeURIComponent(event.id)}`}
      className="block p-4 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        {/* Same reason as the label below: the map hexes are 2.55:1 on the
            dark card, under the 3:1 non-text floor. The role token's dark
            `-accent` step is lifted for exactly this. */}
        <div className={cn('w-1 min-h-[40px] rounded-full', getRiskBgColor(event.severity))} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm leading-tight line-clamp-2">{event.title}</h4>
          </div>
          {/* Role token, NOT severityColor(): those hexes are tuned for map
              markers on satellite/roadmap imagery and drop to ~2.6:1 as text on
              the dark card. */}
          <span
            className={cn(
              'mt-1 inline-block text-[10px] font-semibold uppercase tracking-wide',
              getRiskColor(event.severity),
            )}
          >
            {severityLabel(event.severity)}
          </span>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{event.description}</p>
          {event.locationName && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <svg
                className="size-3"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                />
              </svg>
              {event.locationName}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
