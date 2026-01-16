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
