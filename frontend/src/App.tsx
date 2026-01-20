import React, { useState, useEffect } from 'react';
import { GoogleMapComponent } from './components/GoogleMap';
import { GoogleControls } from './components/GoogleControls';
import { ApiService } from './services/api';
import { Location } from './types';

function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  
  // ASU Tempe Campus center
  const [center, setCenter] = useState({ lat: 33.4242, lng: -111.9281 });
  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');
  const [timeOfDay, setTimeOfDay] = useState<number>(12);
  const [showShadeRoute, setShowShadeRoute] = useState<boolean>(false);
  
  const [googleRoute, setGoogleRoute] = useState<google.maps.DirectionsResult | null>(null);
  const [shadedPath, setShadedPath] = useState<[number, number][] | null>(null);
  
  const [googleRouteInfo, setGoogleRouteInfo] = useState<{
    distance: string;
    duration: string;
  } | null>(null);
  const [shadedRouteInfo, setShadedRouteInfo] = useState<{
    distance: number;
    shade: number;
    time: number;
  } | null>(null);
  
  const [isComputing, setIsComputing] = useState(false);
  const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService | null>(null);

  useEffect(() => {
    // Initialize Google Directions Service when Maps loads
    if (window.google && !directionsService) {
      setDirectionsService(new google.maps.DirectionsService());
    }
  }, [directionsService]);

  const handleMapClick = (location: Location) => {
    if (!startLocation) {
      // Set start location
      setStartLocation(location);
      setStartAddress(`${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`);
    } else if (!endLocation) {
      // Set end location
      setEndLocation(location);
      setEndAddress(`${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`);
    }
    // Do nothing if both are already set - prevents accidental resets
  };

  const handleStartSelect = (location: Location, address: string) => {
    setStartLocation(location);
    setStartAddress(address);
    // Clear routes
    setGoogleRoute(null);
    setShadedPath(null);
    setGoogleRouteInfo(null);
    setShadedRouteInfo(null);
  };

  const handleEndSelect = (location: Location, address: string) => {
    setEndLocation(location);
    setEndAddress(address);
    // Clear routes
    setGoogleRoute(null);
    setShadedPath(null);
    setGoogleRouteInfo(null);
    setShadedRouteInfo(null);
  };

  const handleSwapLocations = () => {
    if (startLocation && endLocation) {
      setStartLocation(endLocation);
      setEndLocation(startLocation);
      setStartAddress(endAddress);
      setEndAddress(startAddress);
      // Clear routes
      setGoogleRoute(null);
      setShadedPath(null);
      setGoogleRouteInfo(null);
      setShadedRouteInfo(null);
    }
  };

  const handleReset = () => {
    setStartLocation(null);
    setEndLocation(null);
    setStartAddress('');
    setEndAddress('');
    setGoogleRoute(null);
    setShadedPath(null);
    setGoogleRouteInfo(null);
    setShadedRouteInfo(null);
  };

  const handleComputeRoute = async () => {
    if (!startLocation || !endLocation || !directionsService) {
      alert('Please select both start and end locations');
      return;
    }

    setIsComputing(true);

    try {
      // Get Google Maps route (fastest)
      const googleResult = await ApiService.getGoogleDirections(
        { lat: startLocation.lat, lng: startLocation.lon },
        { lat: endLocation.lat, lng: endLocation.lon },
        directionsService
      );

      setGoogleRoute(googleResult);

      // Extract route info from Google result
      if (googleResult.routes[0]?.legs[0]) {
        const leg = googleResult.routes[0].legs[0];
        setGoogleRouteInfo({
          distance: leg.distance?.text || 'N/A',
          duration: leg.duration?.text || 'N/A',
        });
      }

      // Compute shade-optimized route if requested
      if (showShadeRoute) {
        const shadeResult = await ApiService.computeShadeOptimizedRoute(
          startLocation,
          endLocation,
          timeOfDay
        );

        setShadedPath(shadeResult.path_coordinates);
        setShadedRouteInfo({
          distance: shadeResult.total_distance,
          shade: shadeResult.average_shade,
          time: shadeResult.total_time_minutes,
        });
      } else {
        setShadedPath(null);
        setShadedRouteInfo(null);
      }

    } catch (error) {
      console.error('Failed to compute routes:', error);
      alert('Failed to compute routes. Please ensure:\n1. Google Maps API key is valid\n2. Backend server is running\n3. Locations are accessible by walking');
    } finally {
      setIsComputing(false);
    }
  };

  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Configuration Required</h1>
          <p className="text-gray-700 mb-4">
            Google Maps API key is missing. Please:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600 mb-4">
            <li>Get an API key from Google Cloud Console</li>
            <li>Create a file: <code className="bg-gray-100 px-2 py-1 rounded">frontend/.env</code></li>
            <li>Add: <code className="bg-gray-100 px-2 py-1 rounded">VITE_GOOGLE_MAPS_API_KEY=your_key</code></li>
            <li>Restart the development server</li>
          </ol>
          <p className="text-xs text-gray-500">
            See GOOGLE_MAPS_SETUP.md for detailed instructions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen">
      <GoogleMapComponent
        apiKey={apiKey}
        startLocation={startLocation}
        endLocation={endLocation}
        googleRoute={googleRoute}
        shadedPath={shadedPath}
        onMapClick={handleMapClick}
        center={center}
      />
      
      <GoogleControls
        startAddress={startAddress}
        endAddress={endAddress}
        timeOfDay={timeOfDay}
        showShadeRoute={showShadeRoute}
        onStartSelect={handleStartSelect}
        onEndSelect={handleEndSelect}
        onSwapLocations={handleSwapLocations}
        onTimeChange={setTimeOfDay}
        onShowShadeRouteChange={setShowShadeRoute}
        onComputeRoute={handleComputeRoute}
        onReset={handleReset}
        isComputing={isComputing}
        googleRouteInfo={googleRouteInfo}
        shadedRouteInfo={shadedRouteInfo}
      />

      {/* Professional Legend */}
      {(googleRoute || shadedPath) && (
        <div style={{
          position: 'fixed',
          bottom: '32px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          padding: '16px 24px',
          pointerEvents: 'none',
          border: '1px solid #f3f4f6'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '24px'
          }}>
            {googleRoute && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <div style={{
                  width: '32px',
