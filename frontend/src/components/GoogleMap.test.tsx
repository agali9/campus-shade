import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GoogleMapComponent } from './GoogleMap';

vi.mock('@react-google-maps/api', () => ({
  LoadScript: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  GoogleMap: ({ children }: { children: React.ReactNode }) => <div data-testid="google-map">{children}</div>,
  DirectionsRenderer: () => <div data-testid="directions-renderer" />,
  Marker: () => <div data-testid="marker" />,
  Polyline: () => <div data-testid="shade-polyline" />,
  Polygon: () => <div data-testid="overlay-polygon" />,
}));

describe('GoogleMapComponent', () => {
  it('renders map shell with mocked Google Maps loader', () => {
    render(
      <GoogleMapComponent
        apiKey="fake-key"
        startLocation={null}
        endLocation={null}
        googleRoute={null}
        shadedPath={null}
        shadowData={null}
        buildingData={null}
        onMapClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('google-map')).toBeTruthy();
  });
});
