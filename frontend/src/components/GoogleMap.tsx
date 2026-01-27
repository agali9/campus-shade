import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { GoogleMap, LoadScript, DirectionsRenderer, Marker, Polyline, Polygon } from '@react-google-maps/api';
import { Location } from '../types';

const libraries: ("places" | "geometry" | "drawing")[] = ["places", "geometry"];

const mapContainerStyle = {
  width: '100vw',
  height: '100vh',
  position: 'absolute' as const,
  top: 0,
  left: 0,
  zIndex: 1
};

const defaultCenter = {
  lat: 33.4242,
  lng: -111.9281
};

const ASU_BOUNDS = {
  north: 33.4320,
  south: 33.4120,
  east: -111.9180,
  west: -111.9420,
};

const mapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: true,
  streetViewControl: false,
  fullscreenControl: true,
  restriction: {
    latLngBounds: ASU_BOUNDS,
    strictBounds: false,
  },
  minZoom: 14,
  maxZoom: 20,
  styles: [
    {
      featureType: "poi",
      elementType: "labels",
      stylers: [{ visibility: "off" }]
    }
  ]
};

interface GoogleMapComponentProps {
  apiKey: string;
  startLocation: Location | null;
  endLocation: Location | null;
  googleRoute: google.maps.DirectionsResult | null;
  shadedPath: [number, number][] | null;
  shadowData: any;
  buildingData: any;
  onMapClick: (location: Location) => void;
  onMapLoad?: () => void;
  center?: { lat: number; lng: number };
}

export const GoogleMapComponent: React.FC<GoogleMapComponentProps> = ({
  apiKey,
  startLocation,
  endLocation,
  googleRoute,
  shadedPath,
  shadowData,
  buildingData,
  onMapClick,
  onMapLoad,
  center
}) => {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const shadedPolylineRef = useRef<google.maps.Polyline | null>(null);

  const shadedPolylineOptions = useMemo(() => ({
    strokeColor: '#10b981',
    strokeWeight: 6,
    strokeOpacity: 0.9,
    zIndex: 200
  }), []);

  useEffect(() => {
    if (!googleRoute && directionsRendererRef.current) {
      directionsRendererRef.current.setDirections(null);
    }
  }, [googleRoute]);

  useEffect(() => {
    if (shadedPolylineRef.current) {
      shadedPolylineRef.current.setMap(null);
      shadedPolylineRef.current = null;
    }
  }, [shadedPath]);

  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
    setIsLoaded(true);
    if (onMapLoad) {
      onMapLoad();
    }
  }, [onMapLoad]);

  const onUnmount = useCallback(() => {
    setMap(null);
    setIsLoaded(false);
  }, []);

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (e.latLng) {
      onMapClick({
        lat: e.latLng.lat(),
        lon: e.latLng.lng()
      });
    }
  }, [onMapClick]);

  const shadowPaths = useMemo(() => {
    if (!shadowData) {
      return [];
    }

    const geometries: any[] = [];
    if (shadowData.type === 'FeatureCollection' && Array.isArray(shadowData.features)) {
      shadowData.features.forEach((feature: any) => {
        if (feature?.geometry) geometries.push(feature.geometry);
      });
    } else if (shadowData.type === 'Feature' && shadowData.geometry) {
      geometries.push(shadowData.geometry);
    } else if (shadowData.geometry) {
      geometries.push(shadowData.geometry);
    }

    const paths: google.maps.LatLngLiteral[][] = [];
    try {
      geometries.forEach((geometry) => {
        if (!geometry?.coordinates?.length) return;
        if (geometry.type === 'Polygon') {
          geometry.coordinates.forEach((ring: number[][]) => {
            if (ring?.length > 0) {
              paths.push(ring.map(([lng, lat]) => ({ lat, lng })));
            }
          });
        } else if (geometry.type === 'MultiPolygon') {
          geometry.coordinates.forEach((polygon: number[][][]) => {
            polygon.forEach((ring: number[][]) => {
              if (ring?.length > 0) {
                paths.push(ring.map(([lng, lat]) => ({ lat, lng })));
              }
            });
          });
        }
      });
    } catch (error) {
      console.error('Error processing shadow geometry:', error);
    }
    return paths;
  }, [shadowData]);

  const getBuildingPaths = useCallback(() => {
    if (!buildingData || !buildingData.features) {
      return [];
    }
    
    const buildings = buildingData.features.map((feature: any) => {
      const geometry = feature.geometry;
      if (geometry.type === 'Polygon') {
        const coords = geometry.coordinates[0];
        return {
          paths: coords.map(([lng, lat]: number[]) => ({ lat, lng })),
          properties: feature.properties
        };
      }
      return null;
    }).filter(Boolean);
    
    return buildings;
  }, [buildingData]);

  return (
    <LoadScript 
      googleMapsApiKey={apiKey} 
      libraries={libraries}
      loadingElement={
        <div className="w-full h-screen flex items-center justify-center bg-gray-100">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading Maps...</p>
          </div>
        </div>
      }
    >
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center || defaultCenter}
        zoom={16}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onClick={handleMapClick}
        options={mapOptions}
      >
        {isLoaded && buildingData && getBuildingPaths().map((building: any, idx: number) => (
          <Polygon
            key={`building-${idx}`}
            paths={building.paths}
            options={{
              fillColor: '#94a3b8',
              fillOpacity: 0.2,
              strokeColor: '#64748b',
              strokeWeight: 1.5,
              strokeOpacity: 0.6,
              zIndex: 1,
              clickable: false
            }}
          />
        ))}

        {isLoaded && shadowData && shadowPaths.length > 0 && shadowPaths.map((path, idx) => (
          <Polygon
            key={`shadow-${idx}`}
            paths={path}
            options={{
              fillColor: '#000000',
              fillOpacity: 0.35,
              strokeColor: '#000000',
              strokeWeight: 1,
              strokeOpacity: 0.35,
              zIndex: 250,
              clickable: false
            }}
          />
        ))}

        {isLoaded && startLocation && (
          <Marker
            position={{ lat: startLocation.lat, lng: startLocation.lon }}
            label={{
              text: "A",
              color: "white",
              fontSize: "14px",
              fontWeight: "bold"
            }}
            icon={{
              url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png',
              scaledSize: new google.maps.Size(40, 40)
            }}
            zIndex={10}
          />
        )}

        {isLoaded && endLocation && (
          <Marker
            position={{ lat: endLocation.lat, lng: endLocation.lon }}
            label={{
              text: "B",
              color: "white",
              fontSize: "14px",
              fontWeight: "bold"
            }}
            icon={{
              url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png',
              scaledSize: new google.maps.Size(40, 40)
            }}
            zIndex={10}
          />
        )}

        {isLoaded && (
          <DirectionsRenderer
            directions={googleRoute || undefined}
            options={{
              polylineOptions: {
                strokeColor: '#3b82f6',
                strokeWeight: 6,
                strokeOpacity: 0.8,
                zIndex: 5
              },
              suppressMarkers: true,
              preserveViewport: true
            }}
            onLoad={(dr) => {
              directionsRendererRef.current = dr;
            }}
