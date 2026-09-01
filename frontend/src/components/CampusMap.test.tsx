import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CampusMap } from './CampusMap';

vi.mock('react-map-gl/maplibre', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="campus-map">{children}</div>
  ),
  Source: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Layer: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  NavigationControl: () => null,
}));

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

describe('CampusMap', () => {
  it('renders map shell with mocked MapLibre', () => {
    render(
      <CampusMap
        startLocation={null}
        endLocation={null}
        fastestPath={null}
        shadedPath={null}
        shadowData={null}
        buildingData={null}
        onMapClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('campus-map')).toBeTruthy();
  });
});
