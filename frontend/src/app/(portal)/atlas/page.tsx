'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { PERICLES, severityColor, severityLabel } from '@/lib/atlas-brand';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

const containerStyle = { width: '100%', height: '100%' };
const defaultCenter = { lat: 20, lng: 0 };
const defaultZoom = 2;

// Roadmap styling for a cleaner, brand-aligned look (applies in 'roadmap' only).
const mapStyles: google.maps.MapTypeStyle[] = [
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbe6f0' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f6f5f7' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#b9b3c0' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#78909C' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', stylers: [{ visibility: 'off' }] },
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
}

type TimelinessFilter = 'all' | 'active' | 'completed';
type MapType = 'roadmap' | 'hybrid';

export default function AtlasPage() {
  const { currentOrganization } = useAuth();

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeliness, setTimeliness] = useState<TimelinessFilter>('all');
  const [mapType, setMapType] = useState<MapType>('roadmap');
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedPin, setSelectedPin] = useState<MapPin | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<ShipmentRoute | null>(null);

  const mapRef = useRef<google.maps.Map | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });

  // Fetch data (BOL-shaped Supplier[] + Shipment[] + Event[]), tenant-scoped.
  useEffect(() => {
    if (!currentOrganization?.id) return;
    let isMounted = true;

    const fetchData = async () => {
      setIsLoading(true);
      const [shipmentsRes, suppliersRes, eventsRes] = await Promise.all([
        getShipments(currentOrganization.id),
        getSuppliers(),
        getEvents({ organizationId: currentOrganization.id, limit: 50 }),
      ]);
      if (!isMounted) return;
      if (shipmentsRes.success && shipmentsRes.data) setShipments(shipmentsRes.data);
      if (suppliersRes.success && suppliersRes.data) {
        setSuppliers(suppliersRes.data.filter((s) => s.organizationId === currentOrganization.id));
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

  // Pins, deduplicated by location; supplier pins carry the Supplier for detail.
  const mapPins = useMemo((): MapPin[] => {
    const pins = new Map<string, MapPin>();
    shipmentRoutes.forEach((route) => {
      if (route.origin) {
        const key = `supplier-${route.origin.lat}-${route.origin.lng}`;
        const existing = pins.get(key);
        if (existing) existing.shipmentCount++;
        else
          pins.set(key, {
            id: key,
            position: { lat: route.origin.lat, lng: route.origin.lng },
            type: 'supplier',
            name: route.origin.name,
            shipmentCount: 1,
            supplier: suppliers.find((s) => s.id === route.shipment.supplierId),
          });
      }
      if (route.destination) {
        const key = `port-${route.destination.lat}-${route.destination.lng}`;
        const existing = pins.get(key);
        if (existing) existing.shipmentCount++;
        else
          pins.set(key, {
            id: key,
            position: { lat: route.destination.lat, lng: route.destination.lng },
            type: 'port',
            name: route.destination.name,
            shipmentCount: 1,
          });
      }
    });
    return Array.from(pins.values());
  }, [shipmentRoutes, suppliers]);

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

  const openEvents = useMemo(
    () =>
      events
        .filter((e) => e.validationStatus !== 'rejected' && e.validationStatus !== 'duplicate')
        .slice(0, 10),
    [events],
  );

  const supplierCount = mapPins.filter((p) => p.type === 'supplier').length;
  const portCount = mapPins.filter((p) => p.type === 'port').length;

  const handleMapClick = useCallback(() => {
    setSelectedPin(null);
    setSelectedRoute(null);
  }, []);

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
      <div className="flex items-center justify-center min-h-[400px]">
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
      <div className="flex items-center justify-center min-h-[400px]">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive">Error loading Google Maps</p>
            <p className="text-sm text-muted-foreground mt-2">Please check your API key configuration</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isLoaded || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto"
            style={{ borderColor: PERICLES.purple }}
          />
          <p className="mt-4 text-muted-foreground">Loading Atlas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-3">
      {/* Top filter bar (PRD §7.1) */}
      <div className="flex items-center gap-3 flex-wrap">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search country, city, or port…"
            className="w-64"
            aria-label="Search location"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>

        {searchError && <span className="text-sm text-destructive">{searchError}</span>}

        <div className="flex items-center gap-1 ml-auto">
          {(['all', 'active', 'completed'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={timeliness === f ? 'default' : 'outline'}
              onClick={() => setTimeliness(f)}
              style={timeliness === f ? { backgroundColor: PERICLES.purple } : undefined}
            >
              {f === 'all' ? 'All' : f === 'active' ? 'In Transit' : 'Arrived'}
            </Button>
          ))}
        </div>

        {/* View toggle (PRD §7.2) */}
        <div className="flex items-center rounded-md border overflow-hidden">
          {(['roadmap', 'hybrid'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMapType(t)}
              className={cn(
                'px-3 py-1.5 text-sm transition-colors',
                mapType === t ? 'text-white' : 'text-muted-foreground hover:bg-muted',
              )}
              style={mapType === t ? { backgroundColor: PERICLES.purple } : undefined}
            >
              {t === 'roadmap' ? 'Map' : 'Satellite'}
            </button>
          ))}
        </div>
      </div>

      {/* Main content: map + events feed */}
      <div className="flex-1 flex gap-4 min-h-0">
        <div className="flex-1 relative rounded-lg overflow-hidden border">
          {/* Stats overlay */}
          <div className="absolute top-3 left-3 z-10 rounded-md bg-white/90 dark:bg-gray-900/90 backdrop-blur px-3 py-1.5 text-sm shadow-sm flex items-center gap-2">
            <span className="font-semibold">{shipments.length}</span>
            <span className="text-muted-foreground">shipments</span>
            <span className="text-gray-300">|</span>
            <span className="font-semibold">{supplierCount}</span>
            <span className="text-muted-foreground">suppliers</span>
            <span className="text-gray-300">|</span>
            <span className="font-semibold">{portCount}</span>
            <span className="text-muted-foreground">ports</span>
          </div>

          {/* Legend (brand-aligned) */}
          <div className="absolute bottom-4 left-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 text-sm">
            <div className="font-medium mb-2">Legend</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PERICLES.purple }} />
                <span>Supplier</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PERICLES.gold }} />
                <span>Destination Port</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ backgroundColor: PERICLES.slate }} />
                <span>Shipping Route</span>
              </div>
            </div>
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
              styles: mapType === 'roadmap' ? mapStyles : undefined,
              disableDefaultUI: false,
              zoomControl: true,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: true,
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
                          ? PERICLES.gold
                          : PERICLES.slate,
                      strokeOpacity: selectedRoute?.shipment.id === route.shipment.id ? 1 : 0.6,
                      strokeWeight: selectedRoute?.shipment.id === route.shipment.id ? 3 : 2,
                      geodesic: false,
                      clickable: true,
                    }}
                    onClick={() => setSelectedRoute(route)}
                  />
                ),
            )}

            {mapPins.map((pin) => (
              <Marker
                key={pin.id}
                position={pin.position}
                onClick={() => setSelectedPin(pin)}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8 + Math.min(pin.shipmentCount * 2, 10),
                  fillColor: pin.type === 'supplier' ? PERICLES.purple : PERICLES.gold,
                  fillOpacity: 1,
                  strokeColor: PERICLES.white,
                  strokeWeight: 2,
                }}
              />
            ))}

            {selectedPin && (
              <InfoWindow position={selectedPin.position} onCloseClick={() => setSelectedPin(null)}>
                <div className="p-2 min-w-[180px]">
                  <div className="font-medium text-gray-900">{selectedPin.name}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {selectedPin.type === 'supplier' ? 'Supplier' : 'Destination Port'}
                  </div>
                  {selectedPin.supplier?.country && (
                    <div className="text-sm text-gray-500 mt-1">
                      {selectedPin.supplier.country}
                    </div>
                  )}
                  <div className="text-sm text-gray-500 mt-1">
                    {selectedPin.shipmentCount} shipment{selectedPin.shipmentCount !== 1 ? 's' : ''} on map
                    {selectedPin.supplier?.totalShipments
                      ? ` · ${selectedPin.supplier.totalShipments} total`
                      : ''}
                  </div>
                  {selectedPin.supplier?.departurePorts?.length ? (
                    <div className="text-xs text-gray-500 mt-2">
                      <span className="text-gray-400">Departs:</span>{' '}
                      {selectedPin.supplier.departurePorts.slice(0, 3).join(', ')}
                    </div>
                  ) : null}
                  {selectedPin.supplier?.hsCodes?.length ? (
                    <div className="text-xs text-gray-500 mt-1">
                      <span className="text-gray-400">HS:</span>{' '}
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
                  <div className="font-medium text-gray-900 font-mono text-sm">
                    {selectedRoute.shipment.bolNumber}
                  </div>
                  <div className="text-sm text-gray-600 mt-2 space-y-1">
                    <div>
                      <span className="text-gray-500">From:</span>{' '}
                      {selectedRoute.origin?.name || selectedRoute.shipment.departurePort || 'Unknown'}
                    </div>
                    <div>
                      <span className="text-gray-500">To:</span>{' '}
                      {selectedRoute.destination?.name ||
                        selectedRoute.shipment.destinationPort ||
                        'Unknown'}
                    </div>
                    {selectedRoute.shipment.vesselName && (
                      <div>
                        <span className="text-gray-500">Vessel:</span>{' '}
                        {selectedRoute.shipment.vesselName}
                      </div>
                    )}
                    {selectedRoute.shipment.arrivalDate && (
                      <div>
                        <span className="text-gray-500">Arrival:</span>{' '}
                        {new Date(selectedRoute.shipment.arrivalDate).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </div>

        {/* Events Feed (PRD §3.2) */}
        <div className="w-80 shrink-0">
          <Card className="h-full flex flex-col">
            <CardHeader className="border-b shrink-0">
              <CardTitle className="flex items-center gap-2">
                <svg
                  className="size-5"
                  style={{ color: PERICLES.gold }}
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
                Events Feed
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {openEvents.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  <p>No active events</p>
                  <p className="text-xs mt-1">
                    Events appear here once the monitoring pipeline is connected.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {openEvents.map((event) => (
                    <EventFeedItem key={event.id} event={event} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function EventFeedItem({ event }: { event: Event }) {
  return (
    <div className="p-4 hover:bg-muted/50 cursor-pointer transition-colors">
      <div className="flex items-start gap-3">
        <div
          className="w-1 min-h-[40px] rounded-full"
          style={{ backgroundColor: severityColor(event.severity) }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm leading-tight line-clamp-2">{event.title}</h4>
          </div>
          <span
            className="inline-block text-[10px] font-semibold uppercase tracking-wide mt-1"
            style={{ color: severityColor(event.severity) }}
          >
            {severityLabel(event.severity)}
          </span>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{event.description}</p>
          {event.locationName && (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
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
    </div>
  );
}
