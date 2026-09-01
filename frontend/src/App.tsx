import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CampusMap, CampusMapHandle } from './components/CampusMap';
import { RoutePanel } from './components/RoutePanel';
import { ApiService } from './services/api';
import { Location, RouteSegment, BackendStatus, DaySun } from './types';

function formatDistance(meters: number): string {
  return `${Math.round(meters)} m`;
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  return `${Math.round(minutes)} min`;
}

function readDebugMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

/** Matches backend 5-minute solar buckets (day:minutes since midnight). */
function shadeBucketKey(dayOfYear: number, timeOfDay: number, bucketMinutes = 5): string {
  const totalMinutes = Math.floor(timeOfDay * 60);
  const bucketed = Math.floor(totalMinutes / bucketMinutes) * bucketMinutes;
  return `${dayOfYear}:${bucketed}`;
}

/** Local clock in America/Phoenix for live sun/shadow/routing. */
function getPhoenixParams(now = new Date()): { timeOfDay: number; dayOfYear: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour') % 24;
  const minute = get('minute');
  const second = get('second');

  const utcApprox = Date.UTC(year, month - 1, day);
  const yearStart = Date.UTC(year, 0, 0);
  const dayOfYear = Math.floor((utcApprox - yearStart) / 86_400_000);
  const timeOfDay = hour + minute / 60 + second / 3600;
  return { timeOfDay, dayOfYear };
}

function phoenixYear(now = new Date()): number {
  const year = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
  }).format(now);
  return Number(year);
}

function isoFromDayOfYear(dayOfYear: number, year = phoenixYear()): string {
  const date = new Date(Date.UTC(year, 0, dayOfYear));
  return date.toISOString().slice(0, 10);
}

function dayOfYearFromIso(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const yearStart = Date.UTC(year, 0, 0);
  return Math.floor((utc - yearStart) / 86_400_000);
}

function clockInputValue(hourFloat: number): string {
  const hours = Math.min(23, Math.max(0, Math.floor(hourFloat)));
  const minutes = Math.min(59, Math.round((hourFloat - hours) * 60));
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function hourFromClockInput(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours + (minutes || 0) / 60;
}

function friendlyRouteError(error: unknown): string {
  if (!(error instanceof Error)) return 'Could not compute a route. Try again.';
  const msg = error.message;
  if (
    msg.includes('Backend server') ||
    msg.includes('not responding') ||
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed')
  ) {
    return 'Could not reach the route server. Wait a moment and press Go again.';
  }
  if (msg.includes('timed out') || msg.includes('Timeout') || msg.includes('AbortError')) {
    return 'Route took too long. The free server may be waking up — press Go again.';
  }
  if (
    msg.includes('Routing service not initialized') ||
    msg.includes('Routing graph unavailable') ||
    msg.includes('not initialized')
  ) {
    return 'Street network is still loading. Wait a few seconds and press Go again.';
  }
  if (msg.includes('too far from walkable paths')) {
    return 'Point is too far from walkable paths. Tap a road or path.';
  }
  if (msg.includes('No connected path') || msg.includes('Could not find')) {
    return 'No walking path found between those points.';
  }
  return msg || 'Could not compute a route. Try again.';
}

function App() {
  const debugMode = useMemo(() => readDebugMode(), []);

  const live = getPhoenixParams();
  const [timeOfDay, setTimeOfDay] = useState(live.timeOfDay);
  const [dayOfYear, setDayOfYear] = useState(live.dayOfYear);

  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');

  const [showShadeRoute, setShowShadeRoute] = useState(true);
  const [showShadows, setShowShadows] = useState(true);
  const [fastestPath, setFastestPath] = useState<[number, number][] | null>(null);
  const [shadedPath, setShadedPath] = useState<[number, number][] | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState<'start' | 'end' | null>(null);

  const [fastestRouteInfo, setFastestRouteInfo] = useState<{
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
    sameAsFastest?: boolean;
  } | null>(null);

  const [shadowData, setShadowData] = useState<any>(null);
  const [shadowNote, setShadowNote] = useState<string | null>(null);
  const [isLoadingShadows, setIsLoadingShadows] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [backendChecked, setBackendChecked] = useState(false);
  const [backendWaitMs, setBackendWaitMs] = useState(0);
  const [buildingData, setBuildingData] = useState<any>(null);
  const [sunPosition, setSunPosition] = useState<{
    azimuth: number;
    elevation: number;
  } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planLocked, setPlanLocked] = useState(false);
  const [planDate, setPlanDate] = useState(() => isoFromDayOfYear(live.dayOfYear));
  const [planTime, setPlanTime] = useState(() => clockInputValue(live.timeOfDay));
  const [daySun, setDaySun] = useState<DaySun | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const lastRouteKey = useRef<string | null>(null);
  const computeInFlight = useRef(false);
  const pickModeRef = useRef<'start' | 'end' | null>(null);
  const mapRef = useRef<CampusMapHandle>(null);
  pickModeRef.current = pickMode;

  // Prod: refresh live Phoenix clock periodically. Debug: keep manual sliders.
  useEffect(() => {
    if (debugMode || planLocked) return;
    const tick = () => {
      const p = getPhoenixParams();
      setTimeOfDay(p.timeOfDay);
      setDayOfYear(p.dayOfYear);
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [debugMode, planLocked]);

  // Bucket shadows to 5 minutes — matches backend warm cache.
  const shadowTimeKey = Math.floor(timeOfDay * 12) / 12;
  const shadowBucketKey = shadeBucketKey(dayOfYear, shadowTimeKey);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const startedAt = Date.now();

    const refreshStatus = async () => {
      if (cancelled || inFlight || computeInFlight.current) return;
      inFlight = true;
      try {
        const status = await ApiService.getBackendStatus();
        if (cancelled) return;
        setBackendStatus(status);
        setBackendChecked(true);
        setBackendWaitMs(0);
      } catch {
        if (cancelled) return;
        // Keep the last good status so a single timeout does not flip
        // the panel back to "waking up" after the API already answered.
        setBackendChecked(true);
        setBackendWaitMs(Date.now() - startedAt);
      } finally {
        inFlight = false;
      }
    };

    void refreshStatus();
    const id = window.setInterval(() => {
      void refreshStatus();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    loadBuildingData();
  }, []);

  useEffect(() => {
    if (showShadows) {
      void loadShadowData(shadowTimeKey, dayOfYear);
    } else {
      setShadowData(null);
    }
    if (debugMode) {
      void loadSunPosition();
    }
  }, [shadowTimeKey, dayOfYear, showShadows, debugMode]);

  const loadSunPosition = async () => {
    try {
      const sun = await ApiService.getSunPosition(timeOfDay, dayOfYear);
      setSunPosition(sun);
    } catch (error) {
      console.error('Failed to load sun position:', error);
    }
  };

  const loadShadowData = async (hour: number, day: number) => {
    setIsLoadingShadows(true);
    try {
      const shadows = await ApiService.getShadows(hour, day);
      const night = shadows?.properties?.is_daytime === false;
      if (night) {
        setShadowData(null);
        setShadowNote(
          shadows?.properties?.sunrise
            ? `Sun is down. Tempe sunrise ${shadows.properties.sunrise}, sunset ${shadows.properties.sunset}.`
            : 'Sun is down, so buildings are not casting shadows.'
        );
      } else if (shadows?.type === 'FeatureCollection' && Array.isArray(shadows.features)) {
        if (shadows.features.length > 0) {
          setShadowData(shadows);
          setShadowNote(null);
        }
      } else if (shadows?.geometry?.coordinates?.length) {
        setShadowData(shadows);
        setShadowNote(null);
      }
    } catch (error) {
      console.error('Failed to load shadow data:', error);
      // Keep last successful overlay on transient failures.
    } finally {
      setIsLoadingShadows(false);
    }
  };

  const loadBuildingData = async () => {
    try {
      const buildings = await ApiService.getBuildings();
      setBuildingData(buildings?.features?.length ? buildings : null);
    } catch (error) {
      console.error('Failed to load building data:', error);
      setBuildingData(null);
    }
  };

  const clearRoutes = () => {
    setFastestPath(null);
    setShadedPath(null);
    setFastestRouteInfo(null);
    setShadedRouteInfo(null);
    lastRouteKey.current = null;
  };

  const handleComputeRoute = useCallback(async () => {
    if (!startLocation || !endLocation) {
      setErrorMessage('Choose a starting point and destination.');
      return;
    }
    if (computeInFlight.current) return;

    const routeKey = [
      startLocation.lat.toFixed(5),
      startLocation.lon.toFixed(5),
      endLocation.lat.toFixed(5),
      endLocation.lon.toFixed(5),
      (Math.floor(timeOfDay * 12) / 12).toFixed(3),
      Math.round(dayOfYear),
      showShadeRoute ? '1' : '0',
    ].join('|');

    if (lastRouteKey.current === routeKey) return;

    computeInFlight.current = true;
    setIsComputing(true);
    setErrorMessage(null);
    setFastestPath(null);
    setShadedPath(null);
    setFastestRouteInfo(null);
    setShadedRouteInfo(null);

    try {
      const result = await ApiService.computeShadeOptimizedRoute(
        startLocation,
        endLocation,
        timeOfDay,
        dayOfYear,
        planLocked ? planDate : undefined
      );

      // A successful route means the API is up, even if status polls timed out.
      setBackendStatus((prev) =>
        prev ?? {
          status: 'ok',
          street_network_ready: true,
          buildings_loaded: undefined,
        }
      );
      setBackendChecked(true);
      setBackendWaitMs(0);

      const fastestCoords = result.fastest_polyline_coordinates;
      if (fastestCoords && fastestCoords.length > 1) {
        setFastestPath(fastestCoords as [number, number][]);
      }

      const fastestDistance = result.comparison?.fastest_distance ?? result.total_distance;
      const fastestMinutes = fastestDistance / 1.4 / 60;
      setFastestRouteInfo({
        distance: formatDistance(fastestDistance),
        duration: formatDuration(fastestMinutes),
      });

      if (showShadeRoute && result.polyline_coordinates?.length) {
        setShadedPath(result.polyline_coordinates as [number, number][]);
        setShadedRouteInfo({
          distance: result.total_distance,
          shade: result.average_shade,
          time: result.total_time_minutes,
          fastestShade: result.comparison?.fastest_shade,
          segments: result.segments,
          fastestSegments: result.fastest_segments,
          sameAsFastest: Boolean(result.comparison?.sun_below_horizon),
        });
      }

      lastRouteKey.current = routeKey;
      window.setTimeout(() => {
        mapRef.current?.fitRoutes([
          result.fastest_polyline_coordinates as [number, number][] | undefined,
          showShadeRoute
            ? (result.polyline_coordinates as [number, number][] | undefined)
            : undefined,
        ]);
      }, 280);
    } catch (error) {
      console.error('Route computation failed:', error);
      setFastestPath(null);
      setShadedPath(null);
      setFastestRouteInfo(null);
      setShadedRouteInfo(null);
      // Never cache failures — the same A→B must be retryable after a wake/timeout.
      lastRouteKey.current = null;
      setErrorMessage(friendlyRouteError(error));
    } finally {
      computeInFlight.current = false;
      setIsComputing(false);
    }
  }, [startLocation, endLocation, timeOfDay, dayOfYear, showShadeRoute, planLocked, planDate]);

  const applyPickedPoint = (mode: 'start' | 'end', picked: Location) => {
    const label = `${picked.lat.toFixed(5)}, ${picked.lon.toFixed(5)}`;
    if (mode === 'start') {
      setStartLocation(picked);
      setStartAddress(label);
    } else {
      setEndLocation(picked);
      setEndAddress(label);
    }
    clearRoutes();
  };

  const handleMapClick = async (location: Location) => {
    const mode = pickModeRef.current;
    if (!mode) return;

    // Exit pick mode and drop a pin immediately so the tap always feels registered.
    pickModeRef.current = null;
    setPickMode(null);
    setErrorMessage(null);
    applyPickedPoint(mode, location);

    try {
      const snapped = await ApiService.snapToNetwork(location.lat, location.lon);
      if (Number.isFinite(snapped.lat) && Number.isFinite(snapped.lon)) {
        applyPickedPoint(mode, { lat: snapped.lat, lon: snapped.lon });
      }
    } catch {
      // Keep the clicked coordinates if snap fails.
    }
  };

  const handleConfirmMapPoint = () => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    void handleMapClick(center);
  };

  const dismissKeyboard = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setErrorMessage('Location is not available in this browser.');
      return;
    }
    setIsLocating(true);
    setErrorMessage(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const raw = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        try {
          const snapped = await ApiService.snapToNetwork(raw.lat, raw.lon);
          const location = {
            lat: Number.isFinite(snapped.lat) ? snapped.lat : raw.lat,
            lon: Number.isFinite(snapped.lon) ? snapped.lon : raw.lon,
          };
          let label = 'Current location';
          try {
            label = await ApiService.reverseGeocode(location.lat, location.lon);
          } catch {
            label = `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`;
          }
          setPickMode(null);
          setStartLocation(location);
          setStartAddress(label);
          clearRoutes();
          mapRef.current?.flyTo(location);
        } catch (error) {
          setErrorMessage(friendlyRouteError(error));
        } finally {
          setIsLocating(false);
        }
      },
      () => {
        setIsLocating(false);
        setErrorMessage('Could not get your location. Check permissions and try again.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  };

  const handleStartSelect = (location: Location, address: string) => {
    setErrorMessage(null);
    setPickMode(null);
    setStartLocation(location);
    setStartAddress(address);
    clearRoutes();
  };

  const handleEndSelect = (location: Location, address: string) => {
    setErrorMessage(null);
    setPickMode(null);
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
    if (!startLocation || !endLocation) return;
    setStartLocation(endLocation);
    setEndLocation(startLocation);
    setStartAddress(endAddress);
    setEndAddress(startAddress);
    clearRoutes();
  };

  const handleReset = () => {
    setStartLocation(null);
    setEndLocation(null);
    setStartAddress('');
    setEndAddress('');
    setErrorMessage(null);
    setPickMode(null);
    clearRoutes();
  };

  const applyPlan = () => {
    const hour = hourFromClockInput(planTime);
    const day = dayOfYearFromIso(planDate);
    setPlanLocked(true);
    setTimeOfDay(hour);
    setDayOfYear(day);
    lastRouteKey.current = null;
    setErrorMessage(null);
    clearRoutes();
  };

  const useLiveClock = () => {
    const p = getPhoenixParams();
    setPlanLocked(false);
    setPlanOpen(false);
    setTimeOfDay(p.timeOfDay);
    setDayOfYear(p.dayOfYear);
    setPlanDate(isoFromDayOfYear(p.dayOfYear));
    setPlanTime(clockInputValue(p.timeOfDay));
    lastRouteKey.current = null;
    clearRoutes();
  };

  useEffect(() => {
    if (!planOpen) return;
    let cancelled = false;
    void ApiService.getSunDay(planDate)
      .then((sun) => {
        if (!cancelled) setDaySun(sun);
      })
      .catch(() => {
        if (!cancelled) setDaySun(null);
      });
    return () => {
      cancelled = true;
    };
  }, [planOpen, planDate]);

  const mapHint = pickMode === 'start'
    ? 'Move the map or tap to set starting point'
    : pickMode === 'end'
      ? 'Move the map or tap to set destination'
      : '';

  const serverHint = isComputing
    ? 'Finding routes… the free server can take up to a minute.'
    : !backendChecked
      ? 'Checking the route server…'
      : !backendStatus
        ? backendWaitMs > 45000
          ? 'Still waking the route server. Free hosting can take 1–2 minutes — leave this page open.'
          : 'The route server is waking up. That can take about a minute. Shadows may show up first.'
        : backendStatus.street_network_ready
          ? 'Ready to route.'
          : 'The map server is up. Routes are still loading — wait until this says ready, then press Go.';

  return (
    <div className="relative h-full w-full">
      <CampusMap
        ref={mapRef}
        startLocation={startLocation}
        endLocation={endLocation}
        fastestPath={fastestPath}
        shadedPath={showShadeRoute ? shadedPath : null}
        shadowData={showShadows ? shadowData : null}
        buildingData={buildingData}
        onMapClick={handleMapClick}
        pickMode={pickMode}
        onMapInteract={dismissKeyboard}
      />

      <RoutePanel
        startAddress={startAddress}
        endAddress={endAddress}
        mapHint={mapHint}
        serverHint={serverHint}
        errorMessage={errorMessage}
        pickMode={pickMode}
        showShadeRoute={showShadeRoute}
        showShadows={showShadows}
        shadowNote={shadowNote}
        isComputing={isComputing}
        isLoadingShadows={isLoadingShadows}
        backendStatus={backendStatus}
        shadowBucketKey={shadowBucketKey}
        debugMode={debugMode}
        timeOfDay={timeOfDay}
        dayOfYear={dayOfYear}
        sunPosition={sunPosition}
        fastestRouteInfo={fastestRouteInfo}
        shadedRouteInfo={shadedRouteInfo}
        onStartSelect={handleStartSelect}
        onEndSelect={handleEndSelect}
        onStartClear={handleStartClear}
        onEndClear={handleEndClear}
        onSwapLocations={handleSwapLocations}
        onShowShadeRouteChange={setShowShadeRoute}
        onShowShadowsChange={setShowShadows}
        onComputeRoute={handleComputeRoute}
        onReset={handleReset}
        onTimeChange={setTimeOfDay}
        onDayChange={setDayOfYear}
        planOpen={planOpen}
        planLocked={planLocked}
        planDate={planDate}
        planTime={planTime}
        daySun={daySun}
        onPlanOpenChange={setPlanOpen}
        onPlanDateChange={setPlanDate}
        onPlanTimeChange={setPlanTime}
        onApplyPlan={applyPlan}
        onUseLiveClock={useLiveClock}
        onDismissError={() => setErrorMessage(null)}
        onPickModeChange={setPickMode}
        onConfirmMapPoint={handleConfirmMapPoint}
        onUseMyLocation={handleUseMyLocation}
        isLocating={isLocating}
      />
    </div>
  );
}

export default App;
