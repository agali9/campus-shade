import React from 'react';
import { SearchBox } from './SearchBox';
import { Location } from '../types';

interface GoogleControlsProps {
  startAddress: string;
  endAddress: string;
  timeOfDay: number;
  showShadeRoute: boolean;
  onStartSelect: (location: Location, address: string) => void;
  onEndSelect: (location: Location, address: string) => void;
  onSwapLocations: () => void;
  onTimeChange: (time: number) => void;
  onShowShadeRouteChange: (show: boolean) => void;
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
  } | null;
}

export const GoogleControls: React.FC<GoogleControlsProps> = ({
  startAddress,
  endAddress,
  timeOfDay,
  showShadeRoute,
  onStartSelect,
  onEndSelect,
  onSwapLocations,
  onTimeChange,
  onShowShadeRouteChange,
  onComputeRoute,
  onReset,
  isComputing,
  googleRouteInfo,
  shadedRouteInfo,
}) => {
  const canCompute = startAddress && endAddress;

  return (
    <>
      {/* Main Search Card */}
      <div style={{
        position: 'fixed',
        top: '20px',
        left: '20px',
        zIndex: 9999,
        width: '420px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid #f3f4f6',
          background: 'linear-gradient(to bottom, #ffffff, #fafafa)'
        }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 600,
            color: '#111827',
            margin: 0,
            letterSpacing: '-0.02em'
          }}>≡ƒù║∩╕Å Shade Route Planner</h2>
          <p style={{
            fontSize: '13px',
            color: '#6b7280',
            margin: '4px 0 0',
            fontWeight: 400
          }}>Find the coolest path to your destination</p>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Start Location */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                paddingTop: '12px'
              }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#10b981',
                  borderRadius: '50%',
                  border: '2px solid white',
                  boxShadow: '0 0 0 2px #10b981'
                }}></div>
              </div>
              <div style={{ flex: 1 }}>
                <SearchBox
                  placeholder="Starting point"
                  onPlaceSelected={onStartSelect}
                  value={startAddress}
                />
              </div>
            </div>
          </div>

          {/* Connector Line & Swap */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '12px',
            marginLeft: '5px'
          }}>
            <div style={{
              width: '2px',
              height: '24px',
              background: 'linear-gradient(to bottom, #10b981, #ef4444)',
              borderRadius: '1px'
            }}></div>
            <button
              onClick={onSwapLocations}
              disabled={!canCompute}
              style={{
                padding: '8px',
                backgroundColor: canCompute ? '#f3f4f6' : '#fafafa',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                cursor: canCompute ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                opacity: canCompute ? 1 : 0.5
              }}
              onMouseEnter={(e) => {
                if (canCompute) {
                  e.currentTarget.style.backgroundColor = '#e5e7eb';
                  e.currentTarget.style.transform = 'scale(1.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (canCompute) {
                  e.currentTarget.style.backgroundColor = '#f3f4f6';
                  e.currentTarget.style.transform = 'scale(1)';
                }
              }}
              title="Swap locations"
            >
              <svg width="16" height="16" fill="none" stroke="#6b7280" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          {/* End Location */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: '12px'
              }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#ef4444',
                  borderRadius: '50%',
                  border: '2px solid white',
                  boxShadow: '0 0 0 2px #ef4444'
                }}></div>
              </div>
              <div style={{ flex: 1 }}>
                <SearchBox
                  placeholder="Destination"
                  onPlaceSelected={onEndSelect}
                  value={endAddress}
                />
              </div>
            </div>
          </div>

          {/* Time Slider */}
          <div style={{
            padding: '16px',
            backgroundColor: '#fafafa',
            borderRadius: '10px',
            marginBottom: '16px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px'
            }}>
              <label style={{
                fontSize: '13px',
                fontWeight: 500,
                color: '#374151',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span>≡ƒòÉ</span> Time of Day
              </label>
              <span style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#4f46e5',
                backgroundColor: 'white',
                padding: '4px 12px',
                borderRadius: '6px',
                border: '1px solid #e0e7ff'
              }}>
                {timeOfDay.toFixed(1)}:00
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
                height: '6px',
                borderRadius: '3px',
                outline: 'none',
                background: `linear-gradient(to right, #4f46e5 0%, #4f46e5 ${((timeOfDay - 6) / 14) * 100}%, #e5e7eb ${((timeOfDay - 6) / 14) * 100}%, #e5e7eb 100%)`
              }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '8px',
              fontSize: '11px',
              color: '#9ca3af',
              fontWeight: 500
            }}>
              <span>6 AM</span>
              <span>Noon</span>
              <span>8 PM</span>
            </div>
          </div>

          {/* Shade Route Toggle */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            backgroundColor: showShadeRoute ? '#f0fdf4' : '#fafafa',
            border: `1.5px solid ${showShadeRoute ? '#86efac' : '#e5e7eb'}`,
            borderRadius: '10px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px' }}>≡ƒî│</span>
              <span style={{
                fontSize: '14px',
                fontWeight: 500,
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
                width: '20px',
                height: '20px',
                cursor: 'pointer',
                accentColor: '#10b981'
              }}
            />
          </label>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={onComputeRoute}
              disabled={!canCompute || isComputing}
              style={{
                flex: 1,
                padding: '14px 20px',
                backgroundColor: canCompute && !isComputing ? '#4f46e5' : '#d1d5db',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: canCompute && !isComputing ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                boxShadow: canCompute && !isComputing ? '0 4px 6px -1px rgba(79, 70, 229, 0.3)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
              onMouseEnter={(e) => {
                if (canCompute && !isComputing) {
                  e.currentTarget.style.backgroundColor = '#4338ca';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(79, 70, 229, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                if (canCompute && !isComputing) {
                  e.currentTarget.style.backgroundColor = '#4f46e5';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(79, 70, 229, 0.3)';
                }
              }}
            >
              {isComputing ? (
                <>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    border: '2px solid white',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite'
                  }}></div>
                  Computing...
                </>
              ) : (
                <>
                  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Get Directions
                </>
              )}
            </button>
            <button
              onClick={onReset}
              style={{
                padding: '14px 18px',
                backgroundColor: 'white',
                color: '#6b7280',
                border: '1.5px solid #e5e7eb',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f9fafb';
                e.currentTarget.style.borderColor = '#d1d5db';
                e.currentTarget.style.color = '#374151';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'white';
                e.currentTarget.style.borderColor = '#e5e7eb';
                e.currentTarget.style.color = '#6b7280';
              }}
              title="Clear all"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Help Text */}
        <div style={{
          padding: '12px 24px',
          backgroundColor: '#fafafa',
          borderTop: '1px solid #f3f4f6',
          fontSize: '12px',
          color: '#6b7280',
          lineHeight: '1.5'
        }}>
          ≡ƒÆí <strong>Tip:</strong> Search for locations or click on the map to set points
        </div>
      </div>

      {/* Route Information Panel */}
      {(googleRouteInfo || shadedRouteInfo) && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          width: '340px',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          <div style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid #f3f4f6',
            background: 'linear-gradient(to bottom, #ffffff, #fafafa)'
          }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: 600,
              color: '#111827',
              margin: 0,
              letterSpacing: '-0.02em'
            }}>≡ƒôè Route Comparison</h3>
          </div>

          <div style={{ padding: '20px 24px' }}>
            {/* Google Route */}
            {googleRouteInfo && (
              <div style={{
                marginBottom: shadedRouteInfo ? '16px' : 0,
                padding: '16px',
                backgroundColor: '#eff6ff',
                border: '1.5px solid #bfdbfe',
                borderRadius: '10px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '12px'
                }}>
                  <div style={{
                    width: '24px',
                    height: '4px',
                    backgroundColor: '#3b82f6',
                    borderRadius: '2px'
                  }}></div>
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#1e40af',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>Fastest Route</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Distance</span>
                    <span style={{ fontSize: '15px', color: '#1e293b', fontWeight: 600 }}>{googleRouteInfo.distance}</span>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Duration</span>
                    <span style={{ fontSize: '15px', color: '#1e293b', fontWeight: 600 }}>{googleRouteInfo.duration}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Shaded Route */}
            {shadedRouteInfo && (
              <div style={{
                padding: '16px',
                backgroundColor: '#f0fdf4',
                border: '1.5px solid #86efac',
                borderRadius: '10px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
