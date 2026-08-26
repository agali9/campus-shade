import React from 'react';
import { SearchBox } from './SearchBox';
import { Location, RouteSegment } from '../types';

interface GoogleControlsProps {
  startAddress: string;
  endAddress: string;
  timeOfDay: number;
  dayOfYear: number;
  showShadeRoute: boolean;
  showShadows: boolean;
  sunPosition: {azimuth: number, elevation: number} | null;
  onStartSelect: (location: Location, address: string) => void;
  onEndSelect: (location: Location, address: string) => void;
  onStartClear: () => void;
  onEndClear: () => void;
  onSwapLocations: () => void;
  onTimeChange: (time: number) => void;
  onDayChange: (day: number) => void;
  onShowShadeRouteChange: (show: boolean) => void;
  onShowShadowsChange: (show: boolean) => void;
  onComputeRoute: () => void;
  onReset: () => void;
  isComputing: boolean;
  googleRouteInfo: {
    distance: string;
    duration: string;
  } | null;
  shadedRouteInfo: {
    distance: number;
    shade: number;
    time: number;
    fastestShade?: number;
    segments?: RouteSegment[];
    fastestSegments?: RouteSegment[];
  } | null;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const GoogleControls: React.FC<GoogleControlsProps> = ({
  startAddress,
  endAddress,
  timeOfDay,
  dayOfYear,
  showShadeRoute,
  showShadows,
  sunPosition,
  onStartSelect,
  onEndSelect,
  onStartClear,
  onEndClear,
  onSwapLocations,
  onTimeChange,
  onDayChange,
  onShowShadeRouteChange,
  onShowShadowsChange,
  onComputeRoute,
  onReset,
  isComputing,
  googleRouteInfo,
  shadedRouteInfo,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const canCompute = startAddress && endAddress;

  const getDateFromDay = (day: number) => {
    const date = new Date(2024, 0, 1);
    date.setDate(date.getDate() + day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getSeasonEmoji = (day: number) => {
    if (day < 80) return '❄️';
    if (day < 172) return '🌸';
    if (day < 266) return '☀️';
    if (day < 355) return '🍂';
    return '❄️';
  };

  const buildExposureBuckets = (segments: RouteSegment[] | undefined, bucketCount = 10): number[] => {
    if (!segments || segments.length === 0) return Array.from({ length: bucketCount }, () => 0);
    const distances = segments.map((s) => s.distance);
    const totalDistance = distances.reduce((a, b) => a + b, 0);
    if (totalDistance <= 0) return Array.from({ length: bucketCount }, () => 0);

    const sums = Array.from({ length: bucketCount }, () => ({ weightedShade: 0, length: 0 }));
    let traversed = 0;

    for (const seg of segments) {
      // Assign each segment by midpoint progress to avoid expensive or unstable split loops.
      const midpoint = traversed + seg.distance / 2;
      const progress = midpoint / totalDistance;
      const bucketIdx = Math.min(bucketCount - 1, Math.max(0, Math.floor(progress * bucketCount)));
      sums[bucketIdx].weightedShade += seg.distance * seg.shade_probability;
      sums[bucketIdx].length += seg.distance;
      traversed += seg.distance;
    }

    return sums.map((b) => (b.length > 0 ? b.weightedShade / b.length : 0));
  };

  const shadePct = shadedRouteInfo ? shadedRouteInfo.shade * 100 : 0;
  const fastestShadePct = shadedRouteInfo?.fastestShade ? shadedRouteInfo.fastestShade * 100 : 0;
  const shadeBuckets = buildExposureBuckets(shadedRouteInfo?.segments);
  const fastestBuckets = buildExposureBuckets(shadedRouteInfo?.fastestSegments);
  const routeDurationMin = shadedRouteInfo?.time ?? 0;

  return (
    <>
      {onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          style={{
            position: 'fixed',
            top: '20px',
            left: isCollapsed ? '20px' : '480px',
            zIndex: 10000,
            width: '48px',
            height: '48px',
            backgroundColor: 'white',
            border: '2px solid #4f46e5',
            borderRadius: '50%',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
          title={isCollapsed ? 'Show controls' : 'Hide controls'}
        >
          <svg width="24" height="24" fill="none" stroke="#4f46e5" viewBox="0 0 24 24" style={{
            transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.3s'
          }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {!isCollapsed && (
      <div style={{
        position: 'fixed',
        top: '20px',
        left: '20px',
        zIndex: 9999,
        width: '440px',
        maxHeight: 'calc(100vh - 40px)',
        overflowY: 'auto',
        backgroundColor: 'white',
        borderRadius: '16px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{
          padding: '24px 28px 20px',
          borderBottom: '1px solid #f3f4f6',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '16px 16px 0 0'
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: 700,
            color: 'white',
            margin: 0,
            letterSpacing: '-0.02em',
            textShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>🗺️ Shade Route Planner</h2>
          <p style={{
            fontSize: '13px',
            color: 'rgba(255,255,255,0.9)',
            margin: '6px 0 0',
            fontWeight: 500
          }}>Find the coolest path on campus</p>
        </div>

        <div style={{ padding: '24px 28px' }}>
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                paddingTop: '12px'
              }}>
                <div style={{
                  width: '14px',
                  height: '14px',
                  backgroundColor: '#10b981',
                  borderRadius: '50%',
                  border: '3px solid white',
                  boxShadow: '0 0 0 2px #10b981, 0 2px 4px rgba(0,0,0,0.1)'
                }}></div>
              </div>
              <div style={{ flex: 1 }}>
                <SearchBox
                  placeholder="Search campus buildings or click map"
                  onPlaceSelected={onStartSelect}
                  value={startAddress}
                  onClear={onStartClear}
                />
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '12px',
              marginLeft: '6px'
            }}>
              <div style={{
                width: '2px',
                height: '28px',
                background: 'linear-gradient(to bottom, #10b981, #ef4444)',
                borderRadius: '1px'
              }}></div>
              <button
                onClick={onSwapLocations}
                disabled={!canCompute}
                style={{
                  padding: '10px',
                  backgroundColor: canCompute ? '#f3f4f6' : '#fafafa',
                  border: '1.5px solid #e5e7eb',
                  borderRadius: '10px',
                  cursor: canCompute ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  opacity: canCompute ? 1 : 0.5
                }}
                title="Swap locations"
              >
                <svg width="18" height="18" fill="none" stroke="#6b7280" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: '12px'
              }}>
                <div style={{
                  width: '14px',
                  height: '14px',
                  backgroundColor: '#ef4444',
                  borderRadius: '50%',
                  border: '3px solid white',
                  boxShadow: '0 0 0 2px #ef4444, 0 2px 4px rgba(0,0,0,0.1)'
                }}></div>
              </div>
              <div style={{ flex: 1 }}>
                <SearchBox
                  placeholder="Search campus buildings or click map"
                  onPlaceSelected={onEndSelect}
                  value={endAddress}
                  onClear={onEndClear}
                />
              </div>
            </div>
          </div>

          {sunPosition && (
            <div style={{
              padding: '16px',
              backgroundColor: '#fef3c7',
              border: '1.5px solid #fbbf24',
              borderRadius: '12px',
              marginBottom: '16px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px'
              }}>
                <span style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#92400e',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  ☀️ Sun Position
                </span>
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '11px', color: '#92400e', marginBottom: '4px' }}>Azimuth</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#78350f' }}>
                    {sunPosition.azimuth.toFixed(0)}°
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '11px', color: '#92400e', marginBottom: '4px' }}>Elevation</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#78350f' }}>
                    {sunPosition.elevation.toFixed(0)}°
                  </div>
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '32px'
                }}>
                  {sunPosition.elevation > 45 ? '☀️' : sunPosition.elevation > 15 ? '🌤️' : '🌅'}
                </div>
              </div>
            </div>
          )}

          <div style={{
            padding: '18px',
            backgroundColor: '#fafafa',
            borderRadius: '12px',
            marginBottom: '16px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '14px'
            }}>
              <label style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#374151',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                🕐 Time of Day
              </label>
              <span style={{
                fontSize: '16px',
                fontWeight: 700,
                color: '#4f46e5',
                backgroundColor: 'white',
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1.5px solid #e0e7ff'
              }}>
                {Math.floor(timeOfDay)}:{String(Math.round((timeOfDay % 1) * 60)).padStart(2, '0')}
              </span>
            </div>
            <input
              type="range"
              min="6"
              max="20"
              step="0.5"
              value={timeOfDay}
              onChange={(e) => onTimeChange(parseFloat(e.target.value))}
              style={{
                width: '100%',
                height: '8px',
                borderRadius: '4px',
                outline: 'none',
                background: `linear-gradient(to right, #fbbf24 0%, #f59e0b ${((timeOfDay - 6) / 14) * 100}%, #e5e7eb ${((timeOfDay - 6) / 14) * 100}%, #e5e7eb 100%)`
              }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '10px',
              fontSize: '11px',
              color: '#9ca3af',
              fontWeight: 600
            }}>
              <span>6 AM</span>
              <span>Noon</span>
              <span>8 PM</span>
            </div>
          </div>

          <div style={{
            padding: '18px',
            backgroundColor: '#fafafa',
            borderRadius: '12px',
            marginBottom: '16px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '14px'
            }}>
              <label style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#374151',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                📅 Date
              </label>
              <span style={{
                fontSize: '14px',
                fontWeight: 700,
                color: '#059669',
                backgroundColor: 'white',
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1.5px solid #d1fae5',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                {getSeasonEmoji(dayOfYear)} {getDateFromDay(dayOfYear)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="365"
              step="1"
              value={dayOfYear}
              onChange={(e) => onDayChange(parseInt(e.target.value))}
              style={{
                width: '100%',
                height: '8px',
                borderRadius: '4px',
                outline: 'none',
                background: `linear-gradient(to right, #10b981 0%, #059669 ${(dayOfYear / 365) * 100}%, #e5e7eb ${(dayOfYear / 365) * 100}%, #e5e7eb 100%)`
              }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '10px',
              fontSize: '11px',
              color: '#9ca3af',
              fontWeight: 600
            }}>
              <span>Jan 1</span>
              <span>Jul 1</span>
              <span>Dec 31</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 18px',
              backgroundColor: showShadows ? '#f0fdf4' : '#fafafa',
              border: `1.5px solid ${showShadows ? '#86efac' : '#e5e7eb'}`,
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '20px' }}>🌑</span>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: showShadows ? '#166534' : '#374151'
                }}>
                  Show building shadows
                </span>
              </div>
              <input
                type="checkbox"
                checked={showShadows}
                onChange={(e) => onShowShadowsChange(e.target.checked)}
                style={{
                  width: '22px',
                  height: '22px',
                  cursor: 'pointer',
                  accentColor: '#10b981'
                }}
              />
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 18px',
              backgroundColor: showShadeRoute ? '#f0fdf4' : '#fafafa',
              border: `1.5px solid ${showShadeRoute ? '#86efac' : '#e5e7eb'}`,
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '20px' }}>🌳</span>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: showShadeRoute ? '#166534' : '#374151'
                }}>
                  Show shade-optimized route
                </span>
              </div>
              <input
                type="checkbox"
                checked={showShadeRoute}
                onChange={(e) => onShowShadeRouteChange(e.target.checked)}
                style={{
                  width: '22px',
                  height: '22px',
                  cursor: 'pointer',
                  accentColor: '#10b981'
                }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={onComputeRoute}
              disabled={!canCompute || isComputing}
              style={{
                flex: 1,
                padding: '16px 24px',
                backgroundColor: canCompute && !isComputing ? '#4f46e5' : '#d1d5db',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: 700,
                cursor: canCompute && !isComputing ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                boxShadow: canCompute && !isComputing ? '0 4px 6px -1px rgba(79, 70, 229, 0.3)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px'
              }}
            >
              {isComputing ? (
                <>
                  <div style={{
                    width: '18px',
                    height: '18px',
                    border: '3px solid white',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite'
                  }}></div>
                  Computing...
                </>
              ) : (
                <>
                  <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Get Directions
                </>
              )}
            </button>
            <button
              onClick={onReset}
              style={{
                padding: '16px 20px',
                backgroundColor: 'white',
                color: '#6b7280',
                border: '1.5px solid #e5e7eb',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              title="Clear all"
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{
          padding: '14px 28px',
          backgroundColor: '#fafafa',
          borderTop: '1px solid #f3f4f6',
          fontSize: '12px',
          color: '#6b7280',
          lineHeight: '1.6',
          borderRadius: '0 0 16px 16px'
        }}>
          💡 <strong>Tip:</strong> Search for locations or click the map. Adjust time to see shadow changes in real-time.
        </div>
      </div>
      )}

      {(googleRouteInfo || shadedRouteInfo) && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          width: '360px',
          backgroundColor: 'white',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          <div style={{
            padding: '24px 28px 20px',
            borderBottom: '1px solid #f3f4f6',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: '16px 16px 0 0'
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 700,
              color: 'white',
              margin: 0,
              letterSpacing: '-0.02em',
              textShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>📊 Route Comparison</h3>
          </div>

          <div style={{ padding: '24px 28px' }}>
            {googleRouteInfo && (
              <div style={{
                marginBottom: shadedRouteInfo ? '18px' : 0,
                padding: '18px',
                backgroundColor: '#eff6ff',
                border: '1.5px solid #bfdbfe',
                borderRadius: '12px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '14px'
                }}>
                  <div style={{
                    width: '28px',
                    height: '4px',
                    backgroundColor: '#3b82f6',
                    borderRadius: '2px'
                  }}></div>
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#1e40af',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>Fastest Route</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Distance</span>
                    <span style={{ fontSize: '16px', color: '#1e293b', fontWeight: 700 }}>{googleRouteInfo.distance}</span>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Duration</span>
                    <span style={{ fontSize: '16px', color: '#1e293b', fontWeight: 700 }}>{googleRouteInfo.duration}</span>
                  </div>
                </div>

                <div style={{ marginTop: '14px', backgroundColor: 'white', borderRadius: '10px', padding: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '10px' }}>Shade Exposure Profile</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Fastest Route</div>
                      <div style={{ display: 'flex', height: '18px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                        <div style={{ width: `${fastestShadePct}%`, backgroundColor: '#10b981', color: 'white', fontSize: '10px', textAlign: 'center' }}>
                          {fastestShadePct > 12 ? `${fastestShadePct.toFixed(1)}%` : ''}
                        </div>
                        <div style={{ width: `${100 - fastestShadePct}%`, backgroundColor: '#f59e0b', color: '#111827', fontSize: '10px', textAlign: 'center' }}>
                          {100 - fastestShadePct > 12 ? `${(100 - fastestShadePct).toFixed(1)}%` : ''}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Shade-Optimized Route</div>
                      <div style={{ display: 'flex', height: '18px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                        <div style={{ width: `${shadePct}%`, backgroundColor: '#10b981', color: 'white', fontSize: '10px', textAlign: 'center' }}>
                          {shadePct > 12 ? `${shadePct.toFixed(1)}%` : ''}
                        </div>
                        <div style={{ width: `${100 - shadePct}%`, backgroundColor: '#f59e0b', color: '#111827', fontSize: '10px', textAlign: 'center' }}>
                          {100 - shadePct > 12 ? `${(100 - shadePct).toFixed(1)}%` : ''}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '10px' }}>
                    <svg width="100%" height="88" viewBox="0 0 300 88" preserveAspectRatio="none">
                      <rect x="0" y="0" width="300" height="88" fill="#f8fafc" />
                      {Array.from({ length: 11 }).map((_, i) => (
                        <line key={`grid-${i}`} x1={i * 30} y1="12" x2={i * 30} y2="76" stroke="#e2e8f0" strokeWidth="1" />
                      ))}
                      <polyline
                        fill="none"
                        stroke="#94a3b8"
                        strokeWidth="2"
                        points={fastestBuckets.map((v, i) => `${i * 30},${76 - v * 60}`).join(' ')}
                      />
                      <polyline
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.5"
                        points={shadeBuckets.map((v, i) => `${i * 30},${76 - v * 60}`).join(' ')}
                      />
                      <text x="0" y="84" fontSize="9" fill="#64748b">0m</text>
                      <text x="260" y="84" fontSize="9" fill="#64748b">
                        {routeDurationMin.toFixed(1)}m
                      </text>
                    </svg>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b' }}>
                      <span>Fastest line: gray</span>
                      <span>Shade line: green</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {shadedRouteInfo && (
              <div style={{
                padding: '18px',
                backgroundColor: '#f0fdf4',
                border: '1.5px solid #86efac',
                borderRadius: '12px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '14px'
                }}>
                  <div style={{
                    width: '28px',
                    height: '4px',
                    backgroundColor: '#10b981',
                    borderRadius: '2px'
                  }}></div>
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#047857',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>Shade-Optimized</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Distance</span>
                    <span style={{ fontSize: '16px', color: '#1e293b', fontWeight: 700 }}>{shadedRouteInfo.distance.toFixed(0)} m</span>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Shade Coverage</span>
                    <span style={{
                      fontSize: '18px',
                      fontWeight: 800,
                      color: shadedRouteInfo.shade > 0.6 ? '#059669' : shadedRouteInfo.shade > 0.4 ? '#d97706' : '#dc2626'
                    }}>
                      {(shadedRouteInfo.shade * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Duration</span>
                    <span style={{ fontSize: '16px', color: '#1e293b', fontWeight: 700 }}>{shadedRouteInfo.time.toFixed(1)} min</span>
                  </div>
                  {typeof shadedRouteInfo.fastestShade === 'number' && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Fastest Shade</span>
                      <span style={{ fontSize: '16px', color: '#1e293b', fontWeight: 700 }}>
                        {(shadedRouteInfo.fastestShade * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>

                <div style={{
                  marginTop: '14px',
                  padding: '12px 14px',
                  backgroundColor: 'white',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span style={{ fontSize: '20px' }}>
                    {shadedRouteInfo.shade > 0.6 ? '🌳' : shadedRouteInfo.shade > 0.4 ? '⛅' : '☀️'}
                  </span>
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#374151'
                  }}>
                    {shadedRouteInfo.shade > 0.6 ? 'Excellent shade coverage!' : 
                     shadedRouteInfo.shade > 0.4 ? 'Moderate shade available' : 
                     'Limited shade on this route'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
};