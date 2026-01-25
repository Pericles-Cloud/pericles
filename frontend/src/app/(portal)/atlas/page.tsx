'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import {
  Shipment,
  Supplier,
  Event,
  getShipments,
  getSuppliers,
  getEvents,
} from '@/lib/api-client';
import { GoogleMap, useJsApiLoader, Marker, Polyline, InfoWindow } from '@react-google-maps/api';
import { findPortCoordinates, generateCurvedPath } from '@/lib/port-coordinates';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Map container style
const containerStyle = {
  width: '100%',
  height: '100%',
};

// Default center (world view)
const defaultCenter = {
  lat: 20,
  lng: 0,
};

// Map styling for a cleaner look
const mapStyles = [
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#a3ccff' }],
  },
  {
    featureType: 'landscape',
    elementType: 'geometry',
    stylers: [{ color: '#f5f5f5' }],
  },
  {
    featureType: 'administrative.country',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#999999' }],
  },
  {
    featureType: 'administrative.country',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#666666' }],
  },
  {
    featureType: 'poi',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },
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
  details?: Shipment | Supplier;
}

type FilterType = 'all' | 'active' | 'completed';

export default function AtlasPage() {
  const { currentOrganization } = useAuth();

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedPin, setSelectedPin] = useState<MapPin | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<ShipmentRoute | null>(null);

  // Load Google Maps
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  // Fetch data
  useEffect(() => {
    if (!currentOrganization?.id) {
      return;
    }

    let isMounted = true;

    const fetchData = async () => {
      setIsLoading(true);

      const [shipmentsRes, suppliersRes, eventsRes] = await Promise.all([
        getShipments(currentOrganization.id),
        getSuppliers(),
        getEvents({ organizationId: currentOrganization.id, limit: 50 }),
      ]);

      if (!isMounted) return;

      if (shipmentsRes.success && shipmentsRes.data) {
        setShipments(shipmentsRes.data);
      }
      if (suppliersRes.success && suppliersRes.data) {
        setSuppliers(suppliersRes.data.filter((s) => s.organizationId === currentOrganization.id));
      }
      if (eventsRes.success && eventsRes.data) {
        setEvents(eventsRes.data.events);
      }

      setIsLoading(false);
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id]);

  // Calculate shipment routes
  const shipmentRoutes = useMemo((): ShipmentRoute[] => {
    return shipments
      .map((shipment) => {
        // Get supplier coordinates
        const supplier = suppliers.find((s) => s.id === shipment.supplierId);
        const origin =
          supplier?.latitude && supplier?.longitude
            ? { lat: supplier.latitude, lng: supplier.longitude, name: supplier.name }
            : null;

        // Get destination port coordinates
        const destPort = findPortCoordinates(shipment.destinationPort);
        const destination = destPort
          ? { lat: destPort.lat, lng: destPort.lng, name: destPort.name }
          : null;

        // Generate curved path if both points exist
        const path =
          origin && destination
            ? generateCurvedPath(
                { lat: origin.lat, lng: origin.lng },
                { lat: destination.lat, lng: destination.lng }
              )
            : [];

        return { shipment, origin, destination, path };
      })
      .filter((route) => route.origin || route.destination);
  }, [shipments, suppliers]);

  // Calculate map pins (deduplicated)
  const mapPins = useMemo((): MapPin[] => {
    const pins: Map<string, MapPin> = new Map();

    // Add supplier pins
    shipmentRoutes.forEach((route) => {
      if (route.origin) {
        const key = `supplier-${route.origin.lat}-${route.origin.lng}`;
        const existing = pins.get(key);
        if (existing) {
          existing.shipmentCount++;
        } else {
          pins.set(key, {
            id: key,
            position: { lat: route.origin.lat, lng: route.origin.lng },
            type: 'supplier',
            name: route.origin.name,
            shipmentCount: 1,
          });
        }
      }

      // Add destination port pins
      if (route.destination) {
        const key = `port-${route.destination.lat}-${route.destination.lng}`;
        const existing = pins.get(key);
        if (existing) {
          existing.shipmentCount++;
        } else {
          pins.set(key, {
            id: key,
            position: { lat: route.destination.lat, lng: route.destination.lng },
            type: 'port',
            name: route.destination.name,
            shipmentCount: 1,
          });
        }
      }
    });

    return Array.from(pins.values());
  }, [shipmentRoutes]);

  // Filter routes based on selected filter
  const filteredRoutes = useMemo(() => {
    if (filter === 'all') return shipmentRoutes;

    return shipmentRoutes.filter((route) => {
      const hasArrived = route.shipment.arrivalDate && new Date(route.shipment.arrivalDate) < new Date();
      if (filter === 'completed') return hasArrived;
      if (filter === 'active') return !hasArrived;
      return true;
    });
  }, [shipmentRoutes, filter]);

  // Open events (for the Events Feed)
  const openEvents = useMemo(() => {
    return events.filter(
      (e) => e.validationStatus !== 'rejected' && e.validationStatus !== 'duplicate'
    ).slice(0, 10);
  }, [events]);

  // Handle map click to clear selection
  const handleMapClick = useCallback(() => {
    setSelectedPin(null);
    setSelectedRoute(null);
  }, []);

  if (!currentOrganization) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-gray-500">Please select an organization to view the Atlas</p>
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
            <p className="text-red-500">Error loading Google Maps</p>
            <p className="text-sm text-gray-500 mt-2">Please check your API key configuration</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isLoaded || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-500">Loading Atlas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Atlas</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Global supply chain visualization for {currentOrganization.name}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-medium">{shipments.length}</span> shipments
            <span className="mx-2">|</span>
            <span className="font-medium">{mapPins.filter((p) => p.type === 'supplier').length}</span> suppliers
            <span className="mx-2">|</span>
            <span className="font-medium">{mapPins.filter((p) => p.type === 'port').length}</span> ports
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Map Container */}
        <div className="flex-1 relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
          {/* Filter Dropdown */}
          <div className="absolute top-4 left-4 z-10">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterType)}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm dark:bg-gray-800 dark:border-gray-600"
            >
              <option value="all">All Shipments</option>
              <option value="active">Active Shipments</option>
              <option value="completed">Completed Shipments</option>
            </select>
          </div>

          {/* Legend */}
          <div className="absolute bottom-4 left-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 text-sm">
            <div className="font-medium mb-2">Legend</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span>Supplier</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>Destination Port</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-cyan-500" />
                <span>Shipping Route</span>
              </div>
            </div>
          </div>

          <GoogleMap
            mapContainerStyle={containerStyle}
            center={defaultCenter}
            zoom={2}
            onClick={handleMapClick}
            options={{
              styles: mapStyles,
              disableDefaultUI: false,
              zoomControl: true,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: true,
              minZoom: 2,
              maxZoom: 15,
            }}
          >
            {/* Render shipping routes */}
            {filteredRoutes.map((route, index) => (
              route.path.length > 0 && (
                <Polyline
                  key={`route-${route.shipment.id}-${index}`}
                  path={route.path}
                  options={{
                    strokeColor: selectedRoute?.shipment.id === route.shipment.id ? '#f59e0b' : '#06b6d4',
                    strokeOpacity: selectedRoute?.shipment.id === route.shipment.id ? 1 : 0.6,
                    strokeWeight: selectedRoute?.shipment.id === route.shipment.id ? 3 : 2,
                    geodesic: false,
                    clickable: true,
                  }}
                  onClick={() => setSelectedRoute(route)}
                />
              )
            ))}

            {/* Render pins */}
            {mapPins.map((pin) => (
              <Marker
                key={pin.id}
                position={pin.position}
                onClick={() => setSelectedPin(pin)}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8 + Math.min(pin.shipmentCount * 2, 10),
                  fillColor: pin.type === 'supplier' ? '#3b82f6' : '#22c55e',
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 2,
                }}
              />
            ))}

            {/* Info window for selected pin */}
            {selectedPin && (
              <InfoWindow
                position={selectedPin.position}
                onCloseClick={() => setSelectedPin(null)}
              >
                <div className="p-2 min-w-[150px]">
                  <div className="font-medium text-gray-900">{selectedPin.name}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {selectedPin.type === 'supplier' ? 'Supplier' : 'Destination Port'}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {selectedPin.shipmentCount} shipment{selectedPin.shipmentCount !== 1 ? 's' : ''}
                  </div>
                </div>
              </InfoWindow>
            )}

            {/* Info window for selected route */}
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
                      {selectedRoute.destination?.name || selectedRoute.shipment.destinationPort || 'Unknown'}
                    </div>
                    {selectedRoute.shipment.vesselName && (
                      <div>
                        <span className="text-gray-500">Vessel:</span> {selectedRoute.shipment.vesselName}
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

        {/* Events Feed Sidebar */}
        <div className="w-80 shrink-0">
          <Card className="h-full flex flex-col">
            <CardHeader className="border-b shrink-0">
              <CardTitle className="flex items-center gap-2">
                <svg className="size-5 text-orange-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                Events Feed
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {openEvents.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  <p>No active events</p>
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
  const getSeverityColor = (severity: number) => {
    if (severity >= 0.66) return 'bg-red-500';
    if (severity >= 0.33) return 'bg-orange-500';
    return 'bg-yellow-500';
  };

  return (
    <div className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors">
      <div className="flex items-start gap-3">
        <div className={`w-1 h-full min-h-[40px] rounded-full ${getSeverityColor(event.severity)}`} />
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm leading-tight line-clamp-2">{event.title}</h4>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{event.description}</p>
          {event.locationName && (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              {event.locationName}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
