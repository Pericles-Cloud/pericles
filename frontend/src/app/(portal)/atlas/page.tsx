'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/providers/auth-provider';
import {
  Shipment,
  Supplier,
  Event,
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
} from '@react-google-maps/api';
import { findPortCoordinates, generateCurvedPath } from '@/lib/port-coordinates';
import { PERICLES, mapColors, severityLabel, subsidiaryColor } from '@/lib/atlas-brand';
import { getRiskBgColor, getRiskColor } from '@/lib/intelligence-utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useShipmentPositions } from '@/lib/useShipmentPositions';
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
  type: 'supplier' | 'port';
  name: string;
  shipmentCount: number;
  supplier?: Supplier;
  /** The actual shipments contributing to this pin (#11) — distinct from
   * supplier.totalShipments, which is the org-wide count from the ERP/BOL
   * source regardless of what's plotted on THIS map right now. */
  shipments: Shipment[];
}

/** Shared by the geocode effect (write) and the popup render (read) so the
 * cache key can't drift between the two call sites (#11 review round 3). */
const supplierGeocodeCacheKey = (position: { lat: number; lng: number }) =>
  `${position.lat},${position.lng}`;

type TimelinessFilter = 'all' | 'active' | 'completed';
type MapType = 'roadmap' | 'hybrid';

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
  // Supplier city (#11): no city field exists on Supplier — the BOL/ImportYeti
  // pipeline never populates `address` — so this is reverse-geocoded from the
  // supplier's own lat/lng on demand when its pin is opened, using the same
  // Google Maps script Atlas already loads (no new vendor, no extra library
  // param: Geocoder is part of the core Maps JS API). Cached per lat/lng pair
  // so reopening the same pin in one session doesn't re-call the API.
  const [supplierCities, setSupplierCities] = useState<Record<string, string | null>>({});
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const pendingGeocodesRef = useRef<Set<string>>(new Set());

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

  // Routes: supplier (origin) → destination port, with a curved path.
  const shipmentRoutes = useMemo((): ShipmentRoute[] => {
    return shipments
      .map((shipment) => {
        const supplier = suppliers.find((s) => s.id === shipment.supplierId);
        const origin =
          supplier?.latitude && supplier?.longitude
            ? { lat: supplier.latitude, lng: supplier.longitude, name: supplier.name }
            : null;
        const destPort = findPortCoordinates(shipment.destinationPort);
        const destination = destPort
          ? { lat: destPort.lat, lng: destPort.lng, name: destPort.name }
          : null;
        const path =
          origin && destination
            ? generateCurvedPath(
                { lat: origin.lat, lng: origin.lng },
                { lat: destination.lat, lng: destination.lng },
              )
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

  // Pins, deduplicated by location; supplier pins carry the Supplier for
  // detail. Built from filteredRoutes (not the full shipmentRoutes), so the
  // popup's shipment list/count always matches what the active timeliness
  // filter is actually showing on the map (#11 review finding).
  const mapPins = useMemo((): MapPin[] => {
    const pins = new Map<string, MapPin>();
    filteredRoutes.forEach((route) => {
      if (route.origin) {
        // Keyed by supplier id, not coordinates (#11 review round 3): two
        // distinct suppliers can geocode to the same city-level lat/lng
        // (BOL/ImportYeti ingestion resolves origins at city granularity),
        // and merging them into one pin would misattribute one supplier's
        // BOL/value/ETA list to another's name in the popup.
        const key = `supplier-${route.shipment.supplierId}`;
        const existing = pins.get(key);
        if (existing) {
          existing.shipmentCount++;
          existing.shipments.push(route.shipment);
        } else {
          pins.set(key, {
            id: key,
            position: { lat: route.origin.lat, lng: route.origin.lng },
            type: 'supplier',
            name: route.origin.name,
            shipmentCount: 1,
            supplier: suppliers.find((s) => s.id === route.shipment.supplierId),
            shipments: [route.shipment],
          });
        }
      }
      if (route.destination) {
        const key = `port-${route.destination.lat}-${route.destination.lng}`;
        const existing = pins.get(key);
        if (existing) {
          existing.shipmentCount++;
          existing.shipments.push(route.shipment);
        } else {
          pins.set(key, {
            id: key,
            position: { lat: route.destination.lat, lng: route.destination.lng },
            type: 'port',
            name: route.destination.name,
            shipmentCount: 1,
            shipments: [route.shipment],
          });
        }
      }
    });
    return Array.from(pins.values());
  }, [filteredRoutes, suppliers]);

  // Derived, not its own state: re-reads mapPins every render so the open
  // popup's shipment list/count always reflects the current timeliness
  // filter, and auto-closes (becomes null) if the filter removes every
  // shipment that placed this pin on the map (#11 review round 2).
  const selectedPin = useMemo(
    () => (selectedPinId ? (mapPins.find((p) => p.id === selectedPinId) ?? null) : null),
    [mapPins, selectedPinId]
  );

  useEffect(() => {
    if (!isLoaded || !selectedPin || selectedPin.type !== 'supplier') return;
    const cacheKey = supplierGeocodeCacheKey(selectedPin.position);
    // Also guard against an in-flight request for the same key (e.g. the pin
    // is closed and reopened before the first geocode call resolves) — the
    // cache alone can't catch that since it isn't written until the
    // callback fires.
    if (cacheKey in supplierCities || pendingGeocodesRef.current.has(cacheKey)) return;

    if (!geocoderRef.current) {
      geocoderRef.current = new google.maps.Geocoder();
    }
    pendingGeocodesRef.current.add(cacheKey);

    // The Geocoder API takes a callback, not a Promise/AbortSignal, so a
    // stalled response is timed out manually — required per this repo's
    // external-call convention (CLAUDE.md's "External API Integration
    // Pattern").
    const timeoutId = setTimeout(() => {
      if (!pendingGeocodesRef.current.has(cacheKey)) return;
      pendingGeocodesRef.current.delete(cacheKey);
      setSupplierCities((prev) => ({ ...prev, [cacheKey]: null }));
    }, 8000);

    geocoderRef.current.geocode(
      { location: selectedPin.position },
      (results, status) => {
        if (!pendingGeocodesRef.current.has(cacheKey)) return; // already timed out
        clearTimeout(timeoutId);
        pendingGeocodesRef.current.delete(cacheKey);
        if (status !== google.maps.GeocoderStatus.OK || !results?.length) {
          setSupplierCities((prev) => ({ ...prev, [cacheKey]: null }));
          return;
        }
        const cityComponent = results
          .flatMap((r) => r.address_components)
          .find((c) => c.types.includes('locality') || c.types.includes('postal_town'));
        setSupplierCities((prev) => ({ ...prev, [cacheKey]: cityComponent?.long_name ?? null }));
      }
    );
  }, [isLoaded, selectedPin, supplierCities]);

  const openEvents = useMemo(
    () =>
      events
        .filter((e) => e.validationStatus !== 'rejected' && e.validationStatus !== 'duplicate')
        .slice(0, 10),
    [events],
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
      new google.maps.Geocoder().geocode({ address: query }, (results, status) => {
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
                onClick={() => setTimeliness(f)}
              >
                {f === 'all' ? 'All' : f === 'active' ? 'In Transit' : 'Arrived'}
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
            <span>Supplier</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: mapPalette.port }} />
            <span>Destination Port</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5" style={{ backgroundColor: mapPalette.route }} />
            <span>Shipping Route</span>
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
        {filteredRoutes.map(
          (route, index) =>
            route.path.length > 0 && (
              <Polyline
                key={`route-${route.shipment.id}-${index}`}
                path={route.path}
                options={{
                  strokeColor:
                    selectedRoute?.shipment.id === route.shipment.id
                      ? mapPalette.port
                      : mapPalette.route,
                  strokeOpacity: selectedRoute?.shipment.id === route.shipment.id ? 1 : 0.6,
                  strokeWeight: selectedRoute?.shipment.id === route.shipment.id ? 3 : 2,
                  geodesic: false,
                  clickable: true,
                }}
                onClick={() => setSelectedRoute(route)}
              />
            ),
        )}

        {/* Live vessel layer: sea-route arcs (canal-accurate) + moving dots.
            Driven by the mock position feed; real data swaps in unchanged. */}
        {vesselPositions.map((v) => (
          <Polyline
            key={`sea-${v.shipmentId}`}
            path={v.polyline}
            options={{
              strokeColor: vesselColor(v.organizationId),
              strokeOpacity: 0.4,
              strokeWeight: 1.5,
              geodesic: false,
              clickable: false,
            }}
          />
        ))}
        {vesselPositions.map((v) => (
          <Marker
            key={`vessel-${v.shipmentId}`}
            position={v.position}
            zIndex={999}
            title={[v.organizationName, v.vesselName].filter(Boolean).join(' · ') || undefined}
            icon={{
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 7.5,
              rotation: v.bearing,
              fillColor: vesselColor(v.organizationId),
              fillOpacity: 1,
              strokeColor: PERICLES.white,
              strokeWeight: 2,
            }}
          />
        ))}

        {mapPins.map((pin) => (
          <Marker
            key={pin.id}
            position={pin.position}
            onClick={() => setSelectedPinId(pin.id)}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8 + Math.min(pin.shipmentCount * 2, 10),
              fillColor: pin.type === 'supplier' ? mapPalette.supplier : mapPalette.port,
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
                {selectedPin.type === 'supplier' ? 'Supplier' : 'Destination Port'}
              </div>
              {selectedPin.type === 'supplier' && selectedPin.supplier && (() => {
                const cacheKey = supplierGeocodeCacheKey(selectedPin.position);
                const isGeocodePending = !(cacheKey in supplierCities);
                const parts = [supplierCities[cacheKey], selectedPin.supplier.country].filter(Boolean);
                return (
                  <div className="text-sm text-grey-600 mt-1">
                    {parts.length > 0
                      ? parts.join(', ')
                      : isGeocodePending
                        ? 'Locating…'
                        : 'Location unavailable'}
                  </div>
                );
              })()}
              {/* "Showing" vs "total": the map only ever plots shipments that
                  resolved to a route (both origin and destination coordinates
                  known — see shipmentRoutes above), which can be fewer than the
                  supplier's org-wide shipment count. Previously worded as
                  "N on map · M total", which read as two unrelated numbers
                  rather than a subset-of relationship (#11). totalShipments
                  falls back on a truthy check, not `??`: a supplier whose
                  stored total_shipments is 0 (never backfilled — see
                  MapPin.shipments' own doc comment) but has real shipments
                  plotted here should show "N of N", not the self-contradicting
                  "N of 0". */}
              <div className="text-sm text-grey-600 mt-1">
                Showing {selectedPin.shipmentCount} of{' '}
                {selectedPin.supplier?.totalShipments || selectedPin.shipmentCount} total shipment
                {(selectedPin.supplier?.totalShipments || selectedPin.shipmentCount) !== 1 ? 's' : ''}
              </div>

              <div className="mt-2 max-h-40 overflow-y-auto border-t border-grey-200 pt-2 space-y-2">
                {selectedPin.shipments.map((shipment) => (
                  <div key={shipment.id} className="text-xs">
                    <div className="font-mono text-grey-900">{shipment.bolNumber}</div>
                    <div className="text-grey-600">
                      {shipment.destinationPort ?? 'Destination unknown'}
                      {shipment.valueUsd != null &&
                        ` · ${shipment.valueUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`}
                    </div>
                    {(shipment.estimatedArrivalDate || shipment.arrivalDate) && (
                      <div className="text-grey-600">
                        ETA: {new Date(shipment.estimatedArrivalDate ?? shipment.arrivalDate!).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {selectedPin.supplier?.departurePorts?.length ? (
                <div className="text-xs text-grey-800 mt-2">
                  <span className="text-grey-600">Departs:</span>{' '}
                  {selectedPin.supplier.departurePorts.slice(0, 3).join(', ')}
                </div>
              ) : null}
              {selectedPin.supplier?.hsCodes?.length ? (
                <div className="text-xs text-grey-800 mt-1">
                  <span className="text-grey-600">HS:</span>{' '}
                  {selectedPin.supplier.hsCodes.slice(0, 4).join(', ')}
                </div>
              ) : null}
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
                    {new Date(selectedRoute.shipment.arrivalDate).toLocaleDateString()}
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
