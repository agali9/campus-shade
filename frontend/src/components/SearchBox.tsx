import React, { useRef, useEffect, useState } from 'react';
import { Location } from '../types';

interface SearchBoxProps {
  placeholder: string;
  onPlaceSelected: (location: Location, address: string) => void;
  onClear?: () => void;
  value?: string;
}

export const SearchBox: React.FC<SearchBoxProps> = ({ 
  placeholder, 
  onPlaceSelected,
  onClear,
  value = ''
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!inputRef.current || !window.google) return;

    autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
      fields: ['geometry', 'formatted_address', 'name'],
      bounds: new google.maps.LatLngBounds(
        new google.maps.LatLng(33.410, -111.945),
        new google.maps.LatLng(33.430, -111.920)
      ),
      strictBounds: false,
      componentRestrictions: { country: 'us' },
    });

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current?.getPlace();
      
      if (place?.geometry?.location) {
        const location: Location = {
          lat: place.geometry.location.lat(),
          lon: place.geometry.location.lng()
        };
        
        const address = place.formatted_address || place.name || '';
        setInputValue(address);
        onPlaceSelected(location, address);
      }
    });

    return () => {
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [onPlaceSelected]);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => {
          const next = e.target.value;
          setInputValue(next);
          if (next.trim() === '' && onClear) {
            onClear();
          }
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '12px 14px',
          fontSize: '14px',
          fontWeight: 400,
          color: '#1f2937',
          backgroundColor: 'white',
          border: `1.5px solid ${isFocused ? '#4f46e5' : '#e5e7eb'}`,
          borderRadius: '8px',
          outline: 'none',
          transition: 'all 0.2s',
          boxShadow: isFocused ? '0 0 0 3px rgba(79, 70, 229, 0.1)' : 'none',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
      />
      {!inputValue && (
        <div style={{
          position: 'absolute',
          left: '14px',
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: '#9ca3af',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      )}
    </div>
  );
};