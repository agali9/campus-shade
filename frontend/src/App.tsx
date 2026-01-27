import React, { useState, useEffect } from 'react';
import { GoogleMapComponent } from './components/GoogleMap';
import { GoogleControls } from './components/GoogleControls';
import { ApiService } from './services/api';
import { Location, RouteSegment } from './types';

function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  
  const [center, setCenter] = useState({ lat: 33.4242, lng: -111.9281 });
  
  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');
  
  const [timeOfDay, setTimeOfDay] = useState<number>(12);
  const [dayOfYear, setDayOfYear] = useState<number>(172);
  
  const [showShadeRoute, setShowShadeRoute] = useState<boolean>(true);
  const [googleRoute, setGoogleRoute] = useState<google.maps.DirectionsResult | null>(null);
  const [shadedPath, setShadedPath] = useState<[number, number][] | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  
  const [googleRouteInfo, setGoogleRouteInfo] = useState<{
    distance: string;
    duration: string;
  } | null>(null);
  
  const [shadedRouteInfo, setShadedRouteInfo] = useState<{
    distance: number;
    shade: number;
    time: number;
    fastestShade?: number;
    segments?: RouteSegment[];
    fastestSegments?: RouteSegment[];
  } | null>(null);
  
  const [showShadows, setShowShadows] = useState<boolean>(true);
  const [shadowData, setShadowData] = useState<any>(null);
  const [buildingData, setBuildingData] = useState<any>(null);
  const [sunPosition, setSunPosition] = useState<{azimuth: number, elevation: number} | null>(null);
  
  const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService | null>(null);

  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);

  const [mapsLoaded, setMapsLoaded] = useState(false);
  
  useEffect(() => {
    if (window.google?.maps && !directionsService && mapsLoaded) {
      setDirectionsService(new google.maps.DirectionsService());
    }
  }, [directionsService, mapsLoaded]);

  useEffect(() => {
    if (showShadows) {
      loadShadowData();
    }
    loadSunPosition();
  }, [timeOfDay, dayOfYear, showShadows]);

  useEffect(() => {
    loadBuildingData();
  }, []);

  const loadSunPosition = async () => {
    try {
      const sun = await ApiService.getSunPosition(timeOfDay, dayOfYear);
      setSunPosition(sun);
    } catch (error) {
      console.error('Failed to load sun position:', error);
    }
  };

  const loadShadowData = async () => {
    try {
      const shadows = await ApiService.getShadows(timeOfDay, dayOfYear);
      
      if (shadows?.type === 'FeatureCollection' && Array.isArray(shadows.features)) {
        setShadowData(shadows.features.length > 0 ? shadows : null);
      } else if (shadows?.geometry?.coordinates && shadows.geometry.coordinates.length > 0) {
        setShadowData(shadows);
      } else {
        setShadowData(null);
      }
    } catch (error) {
      console.error('Failed to load shadow data:', error);
      setShadowData(null);
    }
  };

  const loadBuildingData = async () => {
    try {
      const buildings = await ApiService.getBuildings();
      
      if (buildings?.features && buildings.features.length > 0) {
        setBuildingData(buildings);
      } else {
        setBuildingData(null);
        
        setTimeout(() => {
          alert('⚠️ No building data available!\n\n' +
                'Building shadows require data to be downloaded.\n\n' +
                'Please run in backend terminal:\n' +
                '  cd backend\n' +
                '  python download_tempe_data.py\n\n' +
                'Then restart the backend server.');
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to load building data:', error);
      setBuildingData(null);
    }
  };

  const reverseGeocode = async (location: Location): Promise<string> => {
    if (!window.google?.maps) return `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
    const geocoder = new google.maps.Geocoder();
    try {
      const result = await geocoder.geocode({
        location: { lat: location.lat, lng: location.lon },
      });
      return result.results?.[0]?.formatted_address || `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
    } catch {
      return `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
    }
  };

  const handleMapClick = async (location: Location) => {
    const address = await reverseGeocode(location);
    if (!startLocation) {
      setStartLocation(location);
      setStartAddress(address);
    } else if (!endLocation) {
      setEndLocation(location);
      setEndAddress(address);
    } else {
      clearRoutes();
      setStartLocation(location);
      setEndLocation(null);
      setStartAddress(address);
      setEndAddress('');
    }
  };

  const handleStartSelect = (location: Location, address: string) => {
    setStartLocation(location);
    setStartAddress(address);
    clearRoutes();
  };

  const handleEndSelect = (location: Location, address: string) => {
    setEndLocation(location);
    setEndAddress(address);
    clearRoutes();
  };

  const handleStartClear = () => {
    setStartLocation(null);
    setStartAddress('');
    clearRoutes();
  };

  const handleEndClear = () => {
    setEndLocation(null);
    setEndAddress('');
    clearRoutes();
  };

  const handleSwapLocations = () => {
    if (startLocation && endLocation) {
      setStartLocation(endLocation);
      setEndLocation(startLocation);
      setStartAddress(endAddress);
      setEndAddress(startAddress);
      clearRoutes();
    }
  };

  const clearRoutes = () => {
    setGoogleRoute(null);
    setShadedPath(null);
    setGoogleRouteInfo(null);
    setShadedRouteInfo(null);
  };

  const handleReset = () => {
    setStartLocation(null);
    setEndLocation(null);
    setStartAddress('');
    setEndAddress('');
    clearRoutes();
  };

  const handleComputeRoute = async () => {
    if (!startLocation || !endLocation) {
      alert('⚠️ Please select both start and end locations on the map or use the search boxes.');
      return;
    }
    
    setGoogleRoute(null);
    setShadedPath(null);
    setGoogleRouteInfo(null);
    setShadedRouteInfo(null);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    setIsComputing(true);

    try {
      const backendHealthy = await ApiService.checkBackendHealth();
      if (!backendHealthy) {
        throw new Error('Backend server is not responding. Please ensure it is running at http://localhost:8000');
      }

      let directionsServiceToUse = directionsService;
      if (!directionsServiceToUse && window.google?.maps) {
        directionsServiceToUse = new google.maps.DirectionsService();
        setDirectionsService(directionsServiceToUse);
      }
      
      if (!directionsServiceToUse) {
        throw new Error('Google Maps is not yet initialized. Please wait a moment and try again.');
      }

      const googleDirectionsPromise = ApiService.getGoogleDirections(
        { lat: startLocation.lat, lng: startLocation.lon },
        { lat: endLocation.lat, lng: endLocation.lon },
        directionsServiceToUse
      );
      const shadeRoutePromise = showShadeRoute
        ? ApiService.computeShadeOptimizedRoute(
            startLocation,
            endLocation,
            timeOfDay,
            dayOfYear
          )
        : Promise.resolve(null);

      const googleResult = await googleDirectionsPromise;

      setGoogleRoute(googleResult);

      if (googleResult.routes[0]?.legs[0]) {
        const leg = googleResult.routes[0].legs[0];
        setGoogleRouteInfo({
          distance: leg.distance?.text || 'N/A',
          duration: leg.duration?.text || 'N/A',
        });
      }

      if (showShadeRoute && googleResult.routes[0]) {
        try {
          const shadeResult = await shadeRoutePromise;
          
          if (shadeResult && shadeResult.polyline_coordinates && shadeResult.polyline_coordinates.length > 0) {
            setShadedPath(
              shadeResult.polyline_coordinates.map(([lng, lat]) => [lat, lng])
            );
            setShadedRouteInfo({
              distance: shadeResult.total_distance,
              shade: shadeResult.average_shade,
              time: shadeResult.total_time_minutes,
              fastestShade: shadeResult.comparison?.fastest_shade,
              segments: shadeResult.segments,
              fastestSegments: shadeResult.fastest_segments,
            });
          } else {
            setShadedPath(null);
            setShadedRouteInfo(null);
          }
        } catch (error) {
          console.error('Failed to compute shade-optimized route:', error);
          
          let errorMsg = 'Could not compute shade-optimized route.\n\n';
          
          if (error instanceof Error) {
            if (error.message.includes('too far from walkable paths')) {
              errorMsg += '📍 The selected locations are too far from the street network.\n\n';
              errorMsg += 'This usually happens because:\n';
              errorMsg += '• Points are in buildings or restricted areas\n';
              errorMsg += '• Points are outside the campus area\n\n';
              errorMsg += '💡 Try clicking on roads or pathways instead.';
            } else if (error.message.includes('No connected path')) {
              errorMsg += '🚫 No connected walking path found.\n\n';
              errorMsg += 'The points may be on disconnected parts of campus.\n';
              errorMsg += 'Try selecting locations closer together.';
            } else {
              errorMsg += error.message;
            }
          } else {
            errorMsg += 'Unknown error occurred.';
          }
          
          alert(errorMsg);
          
          setShadedPath(null);
          setShadedRouteInfo(null);
        }
      } else {
        setShadedPath(null);
        setShadedRouteInfo(null);
      }

    } catch (error) {
      console.error('Route computation failed:', error);
      
      clearRoutes();
      
      let errorMessage = '❌ Failed to compute routes.\n\n';
      
      if (error instanceof Error) {
        if (error.message.includes('Backend server')) {
          errorMessage += '🔴 Backend Server Issue:\n';
          errorMessage += '• Ensure backend is running: python backend/src/api.py\n';
          errorMessage += '• Check terminal for error messages\n';
          errorMessage += '• Verify server is at http://localhost:8000\n';
        } else if (error.message.includes('Google Maps')) {
          errorMessage += '🗺️ Google Maps Issue:\n';
          errorMessage += '• Please wait a few seconds for maps to fully load\n';
          errorMessage += '• Refresh the page if issue persists\n';
          errorMessage += '• Check your internet connection\n';
        } else if (error.message.includes('ZERO_RESULTS') || error.message.includes('NOT_FOUND')) {
          errorMessage += '🗺️ Routing Issue:\n';
          errorMessage += '• Selected locations may not be accessible by walking\n';
          errorMessage += '• Try locations closer to campus roads/paths\n';
          errorMessage += '• Ensure both points are on the ASU campus\n';
        } else {
          errorMessage += 'Error: ' + error.message + '\n\n';
          errorMessage += '💡 Troubleshooting:\n';
          errorMessage += '• Check browser console (F12) for details\n';
          errorMessage += '• Verify Google Maps API key is valid\n';
          errorMessage += '• Try different locations\n';
        }
      }
      
      alert(errorMessage);
    } finally {
      setIsComputing(false);
    }
  };

  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">⚠️ Configuration Required</h1>
          <p className="text-gray-700 mb-4">Google Maps API key is missing.</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
            <li>Get API key from Google Cloud Console</li>
            <li>Create <code className="bg-gray-100 px-2 py-1 rounded">frontend/.env.local</code></li>
            <li>Add: <code className="bg-gray-100 px-2 py-1 rounded">VITE_GOOGLE_MAPS_API_KEY=your_key</code></li>
            <li>Restart development server</li>
          </ol>
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
        shadowData={showShadows ? shadowData : null}
        buildingData={buildingData}
        onMapClick={handleMapClick}
        onMapLoad={() => setMapsLoaded(true)}
        center={center}
      />
      
      <GoogleControls
        startAddress={startAddress}
        endAddress={endAddress}
        timeOfDay={timeOfDay}
        dayOfYear={dayOfYear}
        showShadeRoute={showShadeRoute}
        showShadows={showShadows}
        sunPosition={sunPosition}
        onStartSelect={handleStartSelect}
        onEndSelect={handleEndSelect}
        onSwapLocations={handleSwapLocations}
        onStartClear={handleStartClear}
        onEndClear={handleEndClear}
        onTimeChange={setTimeOfDay}
        onDayChange={setDayOfYear}
        onShowShadeRouteChange={setShowShadeRoute}
        onShowShadowsChange={setShowShadows}
        onComputeRoute={handleComputeRoute}
        onReset={handleReset}
        isComputing={isComputing}
        googleRouteInfo={googleRouteInfo}
        shadedRouteInfo={shadedRouteInfo}
        isCollapsed={isControlsCollapsed}
        onToggleCollapse={() => setIsControlsCollapsed(!isControlsCollapsed)}
      />

      {(googleRoute || shadedPath || showShadows) && (
        <div style={{
          position: 'fixed',
          bottom: '32px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          padding: '16px 24px',
          pointerEvents: 'none',
          border: '1px solid #f3f4f6'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
            {googleRoute && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '4px',
                  backgroundColor: '#3b82f6',
                  borderRadius: '2px'
                }}></div>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                  Fastest Route
                </span>
              </div>
            )}
            {shadedPath && showShadeRoute && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '4px',
                  backgroundColor: '#10b981',
                  borderRadius: '2px'
                }}></div>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                  Shade-Optimized Route
                </span>
              </div>
            )}
            {showShadows && shadowData && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '20px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  borderRadius: '4px',
                  border: '1px solid rgba(0, 0, 0, 0.2)'
                }}></div>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                  Building Shadows
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
