import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SearchBox } from './SearchBox';
import { Location, RouteSegment, BackendStatus, DaySun } from '../types';

export type SheetSnap = 'peek' | 'mid' | 'full';

export interface RoutePanelProps {
  startAddress: string;
  endAddress: string;
  mapHint: string;
  serverHint?: string | null;
  errorMessage: string | null;
  pickMode: 'start' | 'end' | null;
  showShadeRoute: boolean;
  showShadows: boolean;
  shadowNote?: string | null;
  isComputing: boolean;
  isLoadingShadows?: boolean;
  backendStatus?: BackendStatus | null;
  shadowBucketKey?: string;
  debugMode: boolean;
  timeOfDay: number;
  dayOfYear: number;
  sunPosition: { azimuth: number; elevation: number } | null;
  fastestRouteInfo: { distance: string; duration: string } | null;
  shadedRouteInfo: {
    distance: number;
    shade: number;
    time: number;
    fastestShade?: number;
    segments?: RouteSegment[];
    fastestSegments?: RouteSegment[];
    sameAsFastest?: boolean;
  } | null;
  onStartSelect: (location: Location, address: string) => void;
  onEndSelect: (location: Location, address: string) => void;
  onStartClear: () => void;
  onEndClear: () => void;
  onSwapLocations: () => void;
  onShowShadeRouteChange: (show: boolean) => void;
  onShowShadowsChange: (show: boolean) => void;
  onComputeRoute: () => void;
  onReset: () => void;
  onTimeChange: (time: number) => void;
  onDayChange: (day: number) => void;
  planOpen?: boolean;
  planLocked?: boolean;
  planDate?: string;
  planTime?: string;
  daySun?: DaySun | null;
  onPlanOpenChange?: (open: boolean) => void;
  onPlanDateChange?: (date: string) => void;
  onPlanTimeChange?: (time: string) => void;
  onApplyPlan?: () => void;
  onUseLiveClock?: () => void;
  onDismissError: () => void;
  onPickModeChange: (mode: 'start' | 'end' | null) => void;
  onConfirmMapPoint?: () => void;
  onUseMyLocation?: () => void;
  isLocating?: boolean;
}

function formatClock(hourFloat: number): string {
  const h = Math.floor(hourFloat);
  const m = Math.round((hourFloat - h) * 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function dateLabel(day: number): string {
  const date = new Date(2024, 0, 1);
  date.setDate(date.getDate() + day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function debugStatusColor(ok: boolean | null): string {
  if (ok === null) return '#64748b';
  return ok ? '#059669' : '#d97706';
}

function debugStatusLabel(ok: boolean | null, ready: string, pending: string, unknown = 'unknown'): string {
  if (ok === null) return unknown;
  return ok ? ready : pending;
}

function buildExposureBuckets(segments: RouteSegment[] | undefined, bucketCount = 10): number[] {
  if (!segments || segments.length === 0) {
    return Array.from({ length: bucketCount }, () => 0);
  }
  const totalDistance = segments.reduce((a, s) => a + s.distance, 0);
  if (totalDistance <= 0) return Array.from({ length: bucketCount }, () => 0);

  const sums = Array.from({ length: bucketCount }, () => ({ weightedShade: 0, length: 0 }));
  let traversed = 0;
  for (const seg of segments) {
    const midpoint = traversed + seg.distance / 2;
    const progress = midpoint / totalDistance;
    const bucketIdx = Math.min(bucketCount - 1, Math.max(0, Math.floor(progress * bucketCount)));
    sums[bucketIdx].weightedShade += seg.distance * seg.shade_probability;
    sums[bucketIdx].length += seg.distance;
    traversed += seg.distance;
  }
  return sums.map((b) => (b.length > 0 ? b.weightedShade / b.length : 0));
}

const sheetBase: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

/** Main route sheet UI (search, Go, Plan, layers, comparison). */
export const RoutePanel: React.FC<RoutePanelProps> = (props) => {
  const {
    startAddress,
    endAddress,
    mapHint,
    serverHint = null,
    errorMessage,
    pickMode,
    showShadeRoute,
    showShadows,
    shadowNote = null,
    isComputing,
    isLoadingShadows = false,
    backendStatus = null,
    shadowBucketKey = '',
    debugMode,
    timeOfDay,
    dayOfYear,
    sunPosition,
    fastestRouteInfo,
    shadedRouteInfo,
    onStartSelect,
    onEndSelect,
    onStartClear,
    onEndClear,
    onSwapLocations,
    onShowShadeRouteChange,
    onShowShadowsChange,
    onComputeRoute,
    onReset,
    onTimeChange,
    onDayChange,
    planOpen = false,
    planLocked = false,
    planDate = '',
    planTime = '',
    daySun = null,
    onPlanOpenChange,
    onPlanDateChange,
    onPlanTimeChange,
    onApplyPlan,
    onUseLiveClock,
    onDismissError,
    onPickModeChange,
    onConfirmMapPoint,
    onUseMyLocation,
    isLocating = false,
  } = props;

  const [collapsed, setCollapsed] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('mid');
  const dragRef = useRef<{ startY: number; startSnap: SheetSnap } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const canRoute = Boolean(startAddress && endAddress);
  const picking = pickMode !== null;
  const hasResults = Boolean(fastestRouteInfo || shadedRouteInfo);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 720px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    if (picking) {
      setSheetSnap('peek');
      setCollapsed(false);
    }
  }, [picking, isMobile]);

  useEffect(() => {
    if (!isMobile || collapsed) {
      document.documentElement.style.setProperty('--route-sheet-height', '0px');
      document.documentElement.style.setProperty('--route-sheet-height-px', '0');
      return;
    }
    const peekHeight = picking
      ? 'calc(188px + env(safe-area-inset-bottom, 0px))'
      : hasResults
        ? 'calc(168px + env(safe-area-inset-bottom, 0px))'
        : 'calc(120px + env(safe-area-inset-bottom, 0px))';
    const heights: Record<SheetSnap, string> = {
      peek: peekHeight,
      mid: 'min(48dvh, 420px)',
      full: 'min(88dvh, 720px)',
    };
    document.documentElement.style.setProperty('--route-sheet-height', heights[sheetSnap]);
    const measure = () => {
      const px = sheetRef.current?.getBoundingClientRect().height ?? 0;
      document.documentElement.style.setProperty('--route-sheet-height-px', String(Math.round(px)));
    };
    measure();
    const id = window.setTimeout(measure, 220);
    return () => {
      window.clearTimeout(id);
      document.documentElement.style.setProperty('--route-sheet-height', '0px');
      document.documentElement.style.setProperty('--route-sheet-height-px', '0');
    };
  }, [isMobile, sheetSnap, collapsed, picking, hasResults]);

  const resultKey = [
    fastestRouteInfo?.distance ?? '',
    fastestRouteInfo?.duration ?? '',
    shadedRouteInfo?.distance ?? '',
    shadedRouteInfo?.time ?? '',
  ].join('|');

  useEffect(() => {
    if (!isMobile || picking || !hasResults) return;
    setSheetSnap('peek');
  }, [resultKey, hasResults, isMobile, picking]);

  const onSearchFocus = () => {
    if (isMobile) setSheetSnap('full');
  };

  const snapFromDelta = (from: SheetSnap, deltaY: number): SheetSnap => {
    // Drag up (negative delta) opens more; drag down closes.
    if (deltaY < -48) {
      if (from === 'peek') return 'mid';
      return 'full';
    }
    if (deltaY > 48) {
      if (from === 'full') return 'mid';
      return 'peek';
    }
    return from;
  };

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    dragRef.current = { startY: event.clientY, startSnap: sheetSnap };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const deltaY = event.clientY - dragRef.current.startY;
    const next = snapFromDelta(dragRef.current.startSnap, deltaY);
    // While picking, stay at peek unless the user opens mid for search.
    setSheetSnap(picking && next === 'full' ? 'mid' : next);
    dragRef.current = null;
  };

  const shadePct = shadedRouteInfo ? shadedRouteInfo.shade * 100 : 0;
  const fastestShadePct =
    typeof shadedRouteInfo?.fastestShade === 'number'
      ? shadedRouteInfo.fastestShade * 100
      : 0;
  const shadeBuckets = useMemo(
    () => buildExposureBuckets(shadedRouteInfo?.segments),
    [shadedRouteInfo?.segments]
  );
  const fastestBuckets = useMemo(
    () => buildExposureBuckets(shadedRouteInfo?.fastestSegments),
    [shadedRouteInfo?.fastestSegments]
  );

  const warmup = backendStatus?.shadow_warmup;
  const bucketWarm = Boolean(
    warmup?.edges_ready &&
      warmup?.last_edge_key &&
      shadowBucketKey &&
      warmup.last_edge_key === shadowBucketKey
  );
  const edgeWarmStatus: boolean | null = backendStatus == null ? null : bucketWarm;
  const routeExpectation = bucketWarm ? '~3–6 s for new routes' : '~8–20 s for new routes';

  const hideDesktopSheet = !isMobile && collapsed;
  const showPeekChrome = isMobile && (sheetSnap === 'peek' || picking);
  const showFormBody = !isMobile || sheetSnap !== 'peek';

  const pickLabel =
    pickMode === 'start' ? 'starting point' : pickMode === 'end' ? 'destination' : 'point';

  return (
    <>
      {mapHint && !isMobile && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10001,
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            pointerEvents: 'none',
            maxWidth: '90vw',
            textAlign: 'center',
          }}
        >
          {mapHint}
        </div>
      )}

      <div
        ref={sheetRef}
        className={`route-sheet route-sheet--${isMobile ? sheetSnap : 'desktop'}`}
        style={{
          ...sheetBase,
          position: 'fixed',
          zIndex: 9999,
          display: hideDesktopSheet ? 'none' : 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}
      >
        {isMobile && (
          <div
            className="route-sheet-handle"
            onPointerDown={onHandlePointerDown}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            style={{
              flexShrink: 0,
              padding: '10px 0 4px',
              display: 'flex',
              justifyContent: 'center',
              touchAction: 'none',
              cursor: 'grab',
            }}
            aria-label="Drag to resize panel"
          >
            <span
              style={{
                width: 40,
                height: 4,
                borderRadius: 999,
                background: '#cbd5e1',
              }}
            />
          </div>
        )}

        {showPeekChrome && (
          <div
            style={{
              padding: isMobile && sheetSnap === 'peek' ? '4px 16px 12px' : '4px 16px 8px',
              borderBottom: showFormBody ? '1px solid #f1f5f9' : 'none',
              flexShrink: 0,
            }}
          >
            {picking ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                  Set {pickLabel}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
                  Pan the map so the pin sits on a path, then use this point. Or tap the map.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => onConfirmMapPoint?.()}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      border: 'none',
                      borderRadius: 10,
                      background: '#0f172a',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    Use this point
                  </button>
                  <button
                    type="button"
                    onClick={() => onPickModeChange(null)}
                    style={{
                      minHeight: 44,
                      padding: '0 16px',
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      background: '#fff',
                      color: '#475569',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : hasResults && sheetSnap === 'peek' ? (
              <div style={{ padding: '2px 0 4px' }}>
                <button
                  type="button"
                  onClick={() => setSheetSnap('mid')}
                  style={{
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    textAlign: 'left',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                    {shadedRouteInfo
                      ? `${Math.round(shadedRouteInfo.time)} min shade · ${Math.round(shadedRouteInfo.distance)} m`
                      : fastestRouteInfo
                        ? `${fastestRouteInfo.duration} · ${fastestRouteInfo.distance}`
                        : 'Route ready'}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    {shadedRouteInfo && fastestRouteInfo
                      ? `Fastest ${fastestRouteInfo.duration} · ${Math.round(shadePct)}% shade · pull up for details`
                      : 'Pull up for details'}
                  </div>
                </button>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <LayerChip
                    active={showShadows}
                    label="Shadows"
                    onClick={() => onShowShadowsChange(!showShadows)}
                  />
                  <LayerChip
                    active={showShadeRoute}
                    label="Shade route"
                    onClick={() => onShowShadeRouteChange(!showShadeRoute)}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSheetSnap('mid')}
                style={{
                  width: '100%',
                  border: 'none',
                  background: 'transparent',
                  textAlign: 'left',
                  padding: '4px 0',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>CampusShade</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {canRoute
                    ? 'Pull up for route options · tap Go when ready'
                    : 'Pull up to set start and destination'}
                </div>
              </button>
            )}
          </div>
        )}

        {showFormBody && (
          <>
            {!isMobile && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px 10px',
                  borderBottom: '1px solid #f1f5f9',
                  flexShrink: 0,
                }}
              >
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>CampusShade</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    Cooler walking routes on campus
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  aria-label="Hide panel"
                  style={{
                    border: '1px solid #e2e8f0',
                    background: '#fff',
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: '#64748b',
                    fontSize: 16,
                  }}
                >
                  ×
                </button>
              </div>
            )}

            {isMobile && !picking && sheetSnap !== 'peek' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 16px 8px',
                  flexShrink: 0,
                }}
              >
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>CampusShade</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    Cooler walking routes on campus
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSheetSnap('peek')}
                  aria-label="Minimize panel"
                  style={{
                    border: '1px solid #e2e8f0',
                    background: '#fff',
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: '#64748b',
                    fontSize: 16,
                  }}
                >
                  ↓
                </button>
              </div>
            )}

            <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 14,
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#16a34a',
                }}
              />
              <span style={{ width: 2, flex: 1, background: '#cbd5e1', minHeight: 24 }} />
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#dc2626',
                }}
              />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <SearchBox
                    placeholder="Starting point"
                    onPlaceSelected={(loc, addr) => {
                      onPickModeChange(null);
                      onStartSelect(loc, addr);
                    }}
                    value={startAddress}
                    onClear={onStartClear}
                    onFocusChange={(focused) => {
                      if (focused) onSearchFocus();
                    }}
                  />
                </div>
                {onUseMyLocation && (
                  <IconAction
                    active={false}
                    label={isLocating ? 'Locating' : 'Use my location'}
                    onClick={onUseMyLocation}
                    disabled={isLocating}
                  >
                    <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
                      ⌖
                    </span>
                  </IconAction>
                )}
                <IconAction
                  active={pickMode === 'start'}
                  label={pickMode === 'start' ? 'Cancel map pick' : 'Pick start on map'}
                  onClick={() =>
                    onPickModeChange(pickMode === 'start' ? null : 'start')
                  }
                >
                  <MapPinIcon />
                </IconAction>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <SearchBox
                    placeholder="Destination"
                    onPlaceSelected={(loc, addr) => {
                      onPickModeChange(null);
                      onEndSelect(loc, addr);
                    }}
                    value={endAddress}
                    onClear={onEndClear}
                    onFocusChange={(focused) => {
                      if (focused) onSearchFocus();
                    }}
                  />
                </div>
                <IconAction
                  active={pickMode === 'end'}
                  label={pickMode === 'end' ? 'Cancel map pick' : 'Pick end on map'}
                  onClick={() =>
                    onPickModeChange(pickMode === 'end' ? null : 'end')
                  }
                >
                  <MapPinIcon />
                </IconAction>
              </div>
            </div>
            <button
              type="button"
              onClick={onSwapLocations}
              disabled={!canRoute}
              title="Swap"
              aria-label="Swap start and destination"
              style={{
                alignSelf: 'center',
                border: '1px solid #e2e8f0',
                background: canRoute ? '#f8fafc' : '#f1f5f9',
                width: 44,
                height: 44,
                borderRadius: 10,
                cursor: canRoute ? 'pointer' : 'not-allowed',
                opacity: canRoute ? 1 : 0.5,
                color: '#475569',
                fontSize: 16,
              }}
            >
              ⇅
            </button>
          </div>

          {serverHint && (
            <div
              style={{
                marginTop: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                maxWidth: '100%',
                padding: '6px 10px',
                borderRadius: 999,
                background: serverHint === 'Ready to route.' ? '#ecfdf5' : '#f8fafc',
                border: `1px solid ${serverHint === 'Ready to route.' ? '#a7f3d0' : '#e2e8f0'}`,
                fontSize: 12,
                color: serverHint === 'Ready to route.' ? '#047857' : '#64748b',
                lineHeight: 1.35,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: serverHint === 'Ready to route.' ? '#059669' : '#94a3b8',
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isMobile && serverHint !== 'Ready to route.'
                  ? serverHint.includes('waking')
                    ? 'Server waking up…'
                    : serverHint.includes('still loading')
                      ? 'Routes still loading…'
                      : 'Checking server…'
                  : serverHint}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={onComputeRoute}
              disabled={!canRoute || isComputing}
              style={{
                flex: 1,
                minHeight: 48,
                padding: '12px 14px',
                border: 'none',
                borderRadius: 10,
                background: canRoute && !isComputing ? '#0f172a' : '#cbd5e1',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: canRoute && !isComputing ? 'pointer' : 'not-allowed',
              }}
            >
              {isComputing ? 'Finding routes…' : 'Go'}
            </button>
            <button
              type="button"
              onClick={() => onPlanOpenChange?.(!planOpen)}
              style={{
                minHeight: 48,
                padding: '12px 14px',
                border: planLocked ? '1px solid #0f172a' : '1px solid #e2e8f0',
                borderRadius: 10,
                background: planLocked ? '#f8fafc' : '#fff',
                color: '#0f172a',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isMobile ? 'Time' : 'Plan'}
            </button>
            <button
              type="button"
              onClick={onReset}
              aria-label="Clear"
              style={{
                minHeight: 48,
                padding: '12px 14px',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                background: '#fff',
                color: '#64748b',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>

          {planOpen && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                background: '#f8fafc',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
                Plan a time
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ flex: 1, fontSize: 12, color: '#475569' }}>
                  Date
                  <input
                    type="date"
                    value={planDate}
                    onChange={(e) => onPlanDateChange?.(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                </label>
                <label style={{ flex: 1, fontSize: 12, color: '#475569' }}>
                  Time
                  <input
                    type="time"
                    value={planTime}
                    onChange={(e) => onPlanTimeChange?.(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                </label>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                {daySun
                  ? `Sunrise ${daySun.sunrise} · sunset ${daySun.sunset} (${daySun.source === 'open-meteo' ? 'Open-Meteo' : 'solar position'})`
                  : 'Sunrise and sunset unavailable for that date.'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={onApplyPlan}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    border: 'none',
                    borderRadius: 8,
                    background: '#0f172a',
                    color: '#fff',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Use this time
                </button>
                <button
                  type="button"
                  onClick={onUseLiveClock}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    background: '#fff',
                    color: '#475569',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Now
                </button>
              </div>
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 10,
                color: '#991b1b',
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={onDismissError}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#991b1b',
                  fontWeight: 700,
                }}
              >
                ×
              </button>
            </div>
          )}

          {shadowNote && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>{shadowNote}</div>
          )}
          {(!isMobile || sheetSnap !== 'peek') && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <LayerChip
              active={showShadows}
              label="Shadows"
              onClick={() => onShowShadowsChange(!showShadows)}
            />
            <LayerChip
              active={showShadeRoute}
              label="Shade route"
              onClick={() => onShowShadeRouteChange(!showShadeRoute)}
            />
          </div>
          )}

          {debugMode && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                border: '1px dashed #cbd5e1',
                borderRadius: 10,
                background: '#f8fafc',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 10 }}>
                DEBUG
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.45 }}>
                Add <code style={{ fontSize: 10 }}>?debug=1</code> to the URL. Manual time sliders below
                override the live Phoenix clock.
              </div>

              <div
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 8,
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                <div style={{ fontWeight: 700, color: '#334155', marginBottom: 6 }}>System</div>
                <div style={{ color: debugStatusColor(isComputing ? false : true) }}>
                  Route: {isComputing ? 'computing…' : 'idle'}
                </div>
                <div style={{ color: debugStatusColor(showShadows && isLoadingShadows ? false : true) }}>
                  Shadow overlay:{' '}
                  {showShadows
                    ? isLoadingShadows
                      ? 'loading…'
                      : 'ready'
                    : 'off'}
                </div>
                <div style={{ color: debugStatusColor(edgeWarmStatus) }}>
                  Edge shade bucket ({shadowBucketKey || '—'}):{' '}
                  {debugStatusLabel(edgeWarmStatus, 'warm', 'cold / warming')}
                </div>
                <div style={{ color: '#475569' }}>{routeExpectation}</div>
                {warmup && (
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                    Last warmed: {warmup.last_edge_key ?? 'none'} · cached shadow buckets:{' '}
                    {warmup.cached_shadow_buckets}
                  </div>
                )}
                {backendStatus && (
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                    Network: {backendStatus.street_network_ready ? 'ready' : 'missing'} · buildings:{' '}
                    {backendStatus.buildings_loaded ?? 0}
                  </div>
                )}
                {!backendStatus && (
                  <div style={{ color: '#b45309', fontSize: 11, marginTop: 4 }}>
                    Backend status unavailable — is it running on port 8000?
                  </div>
                )}
              </div>

              {sunPosition && (
                <div style={{ fontSize: 12, color: '#334155', marginBottom: 10 }}>
                  Sun {sunPosition.azimuth.toFixed(0)}° az · {sunPosition.elevation.toFixed(0)}° el
                </div>
              )}
              <label style={{ display: 'block', fontSize: 12, color: '#475569', marginBottom: 8 }}>
                Time of day · {formatClock(timeOfDay)}
                <input
                  type="range"
                  min={6}
                  max={20}
                  step={0.25}
                  value={timeOfDay}
                  onChange={(e) => onTimeChange(Number(e.target.value))}
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label style={{ display: 'block', fontSize: 12, color: '#475569' }}>
                Date · {dateLabel(dayOfYear)}
                <input
                  type="range"
                  min={0}
                  max={365}
                  step={1}
                  value={dayOfYear}
                  onChange={(e) => onDayChange(Number(e.target.value))}
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
            </div>
          )}

          {hasResults && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>
                COMPARISON
              </div>

              {shadedRouteInfo?.sameAsFastest && (
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                  Shade route matches the fastest. There is no sun, so no street is shadier.
                </div>
              )}
              {shadedRouteInfo && (
                <TripRow
                  accent="#059669"
                  title="Shade route"
                  selected
                  meta={`${Math.round(shadedRouteInfo.time)} min · ${Math.round(shadedRouteInfo.distance)} m · ${Math.round(shadePct)}% shade`}
                />
              )}
              {fastestRouteInfo && (
                <TripRow
                  accent="#2563eb"
                  title="Fastest"
                  meta={`${fastestRouteInfo.duration} · ${fastestRouteInfo.distance}${
                    typeof shadedRouteInfo?.fastestShade === 'number'
                      ? ` · ${Math.round(fastestShadePct)}% shade`
                      : ''
                  }`}
                />
              )}

              <button
                type="button"
                onClick={() => setShowProfile((v) => !v)}
                style={{
                  marginTop: 8,
                  width: '100%',
                  border: '1px solid #e2e8f0',
                  background: '#fff',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#475569',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {showProfile ? 'Hide' : 'Show'} shade along the way
              </button>

              {showProfile && (
                <div style={{ marginTop: 10 }}>
                  <svg width="100%" height="72" viewBox="0 0 300 72" preserveAspectRatio="none">
                    <rect x="0" y="0" width="300" height="72" fill="#f8fafc" />
                    <polyline
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="2"
                      points={fastestBuckets.map((v, i) => `${i * 30},${64 - v * 52}`).join(' ')}
                    />
                    <polyline
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2.5"
                      points={shadeBuckets.map((v, i) => `${i * 30},${64 - v * 52}`).join(' ')}
                    />
                  </svg>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b' }}>
                    <span>Gray = fastest</span>
                    <span>Green = shade</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
          </>
        )}
      </div>

      {!isMobile && collapsed && (
        <button
          type="button"
          className="route-sheet-reopen"
          onClick={() => setCollapsed(false)}
          style={{
            position: 'fixed',
            zIndex: 10000,
            border: '1px solid #e2e8f0',
            background: '#fff',
            borderRadius: 10,
            padding: '10px 14px',
            fontWeight: 700,
            fontSize: 13,
            color: '#0f172a',
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          Routes
        </button>
      )}

      {/* Compact legend */}
      {(fastestRouteInfo || (shadedRouteInfo && showShadeRoute) || showShadows) && (
        <div className="route-legend" style={{ ...sheetBase, position: 'fixed', zIndex: 9998, padding: '8px 12px' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: '#334155', fontWeight: 600 }}>
            {fastestRouteInfo && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 18, height: 3, background: '#2563eb', borderRadius: 2 }} />
                Fastest
              </span>
            )}
            {shadedRouteInfo && showShadeRoute && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 18, height: 3, background: '#059669', borderRadius: 2 }} />
                Shade
              </span>
            )}
            {showShadows && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, background: 'rgba(0,0,0,0.35)', borderRadius: 2 }} />
                Shadows
              </span>
            )}
          </div>
        </div>
      )}

      <style>{`
        .route-sheet {
          top: 16px;
          left: 16px;
          width: min(380px, calc(100vw - 32px));
          max-height: calc(100dvh - 32px);
          border-radius: 14px;
        }
        .route-sheet-reopen {
          top: calc(16px + env(safe-area-inset-top, 0px));
          left: 16px;
        }
        .route-legend {
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          border-radius: 999px;
        }
        @media (max-width: 720px) {
          .route-sheet {
            top: auto;
            bottom: 0;
            left: 0;
            right: 0;
            width: 100%;
            height: var(--route-sheet-height);
            max-height: none;
            border-radius: 16px 16px 0 0;
            border-left: none;
            border-right: none;
            border-bottom: none;
            padding-bottom: env(safe-area-inset-bottom, 0px);
            transition: height 0.2s ease;
          }
          .route-sheet--peek {
            height: var(--route-sheet-height);
          }
          .route-sheet--mid {
            height: min(48dvh, 420px);
          }
          .route-sheet--full {
            height: min(88dvh, 720px);
          }
          .route-legend {
            bottom: auto;
            top: calc(12px + env(safe-area-inset-top, 0px));
          }
        }
      `}</style>
    </>
  );
};

function LayerChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: active ? '1px solid #0f172a' : '1px solid #e2e8f0',
        background: active ? '#0f172a' : '#fff',
        color: active ? '#fff' : '#475569',
        borderRadius: 999,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function MapPinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2c-3.3 0-6 2.6-6 5.8 0 4.4 6 13.2 6 13.2s6-8.8 6-13.2C18 4.6 15.3 2 12 2zm0 8.2a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8z" />
    </svg>
  );
}

function IconAction({
  active,
  label,
  onClick,
  disabled = false,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        flexShrink: 0,
        border: active ? '1px solid #0f172a' : '1px solid #e2e8f0',
        background: active ? '#0f172a' : '#fff',
        color: active ? '#fff' : '#334155',
        borderRadius: 10,
        width: 44,
        height: 44,
        fontSize: 18,
        fontWeight: 700,
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function TripRow({
  accent,
  title,
  meta,
  selected,
}: {
  accent: string;
  title: string;
  meta: string;
  selected?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${selected ? accent : '#e2e8f0'}`,
        background: selected ? '#f8fafc' : '#fff',
        marginBottom: 8,
      }}
    >
      <span
        style={{
          width: 4,
          alignSelf: 'stretch',
          borderRadius: 4,
          background: accent,
          flexShrink: 0,
        }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{meta}</div>
      </div>
    </div>
  );
}
