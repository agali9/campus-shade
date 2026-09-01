import React, { useEffect, useRef, useState } from 'react';
import { Location } from '../types';
import { ApiService } from '../services/api';

interface SearchBoxProps {
  placeholder: string;
  onPlaceSelected: (location: Location, address: string) => void;
  onClear?: () => void;
  value?: string;
  onFocusChange?: (focused: boolean) => void;
}

interface SearchHit {
  label: string;
  lat: number;
  lon: number;
}

function looksLikeCoordinates(value: string): boolean {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value.trim());
}

export const SearchBox: React.FC<SearchBoxProps> = ({
  placeholder,
  onPlaceSelected,
  onClear,
  value = '',
  onFocusChange,
}) => {
  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    const q = inputValue.trim();
    if (q.length < 2 || looksLikeCoordinates(q)) {
      setHits([]);
      setOpen(false);
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      try {
        const results = await ApiService.searchCampusPlaces(q);
        setHits(results);
        setOpen(results.length > 0);
      } catch {
        setHits([]);
        setOpen(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [inputValue]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
          const next = e.target.value;
          setInputValue(next);
          if (next.trim() === '' && onClear) {
            onClear();
          }
        }}
        onFocus={() => {
          setIsFocused(true);
          onFocusChange?.(true);
          if (hits.length > 0) setOpen(true);
        }}
        onBlur={() => {
          setIsFocused(false);
          onFocusChange?.(false);
          window.setTimeout(() => setOpen(false), 150);
        }}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '12px 14px',
          fontSize: '16px',
          fontWeight: 400,
          color: '#1f2937',
          backgroundColor: 'white',
          border: `1.5px solid ${isFocused ? '#0f172a' : '#e5e7eb'}`,
          borderRadius: '8px',
          outline: 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: isFocused ? '0 0 0 3px rgba(15, 23, 42, 0.08)' : 'none',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      />
      {open && hits.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            maxHeight: 220,
            overflowY: 'auto',
            boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
          }}
        >
          {hits.map((hit, idx) => (
            <button
              key={`${hit.lat}-${hit.lon}-${idx}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setInputValue(hit.label);
                setOpen(false);
                onPlaceSelected({ lat: hit.lat, lon: hit.lon }, hit.label);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                border: 'none',
                background: 'white',
                cursor: 'pointer',
                fontSize: 13,
                color: '#1f2937',
              }}
            >
              {hit.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
