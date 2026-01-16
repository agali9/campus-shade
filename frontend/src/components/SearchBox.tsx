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
