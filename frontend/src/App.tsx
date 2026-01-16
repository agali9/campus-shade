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
