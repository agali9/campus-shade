import React, { useCallback, useState } from 'react';
import { GoogleMap, LoadScript, DirectionsRenderer, Marker, Polyline } from '@react-google-maps/api';
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

// ASU Tempe Campus bounds
const ASU_BOUNDS = {
  north: 33.4320,
  south: 33.4120,
  east: -111.9180,
  west: -111.9420,
};

const mapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: true,
  restriction: {
    latLngBounds: ASU_BOUNDS,
    strictBounds: false,
  },
  minZoom: 13,
  maxZoom: 19,
  styles: []
};

interface GoogleMapComponentProps {
  apiKey: string;
  startLocation: Location | null;
  endLocation: Location | null;
  googleRoute: google.maps.DirectionsResult | null;
  shadedPath: [number, number][] | null;
  onMapClick: (location: Location) => void;
  center?: { lat: number; lng: number };
}

export const GoogleMapComponent: React.FC<GoogleMapComponentProps> = ({
  apiKey,
  startLocation,
  endLocation,
  googleRoute,
  shadedPath,
  onMapClick,
  center
}) => {
  const [map, setMap] = useState<google.maps.Map | null>(null);

  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
  }, []);

  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (e.latLng) {
      onMapClick({
        lat: e.latLng.lat(),
        lon: e.latLng.lng()
      });
    }
  }, [onMapClick]);

  return (
    <LoadScript 
      googleMapsApiKey={apiKey} 
      libraries={libraries}
      loadingElement={<div className="w-full h-screen flex items-center justify-center">Loading Maps...</div>}
    >
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center || defaultCenter}
        zoom={14}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onClick={handleMapClick}
        options={mapOptions}
      >
        {/* Start Marker */}
        {startLocation && (
          <Marker
            position={{ lat: startLocation.lat, lng: startLocation.lon }}
            label="A"
            icon={{
              url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png'
            }}
          />
        )}

        {/* End Marker */}
        {endLocation && (
          <Marker
            position={{ lat: endLocation.lat, lng: endLocation.lon }}
            label="B"
            icon={{
              url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
            }}
          />
        )}

        {/* Google Directions Route (Fastest) */}
        {googleRoute && (
          <DirectionsRenderer
            directions={googleRoute}
            options={{
              polylineOptions: {
                strokeColor: '#4285F4',
                strokeWeight: 5,
                strokeOpacity: 0.8
              },
              suppressMarkers: true
            }}
          />
        )}

        {/* Shade-Optimized Route */}
