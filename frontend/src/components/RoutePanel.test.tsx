import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoutePanel } from './RoutePanel';

vi.mock('./SearchBox', () => ({
  SearchBox: ({ placeholder }: { placeholder: string }) => <input aria-label={placeholder} />,
}));

const baseProps = {
  startAddress: '',
  endAddress: '',
  mapHint: '',
  errorMessage: null,
  pickMode: null as 'start' | 'end' | null,
  showShadeRoute: true,
  showShadows: true,
  isComputing: false,
  debugMode: false,
  timeOfDay: 12,
  dayOfYear: 180,
  sunPosition: null,
  fastestRouteInfo: null,
  shadedRouteInfo: null,
  onStartSelect: vi.fn(),
  onEndSelect: vi.fn(),
  onStartClear: vi.fn(),
  onEndClear: vi.fn(),
  onSwapLocations: vi.fn(),
  onShowShadeRouteChange: vi.fn(),
  onShowShadowsChange: vi.fn(),
  onComputeRoute: vi.fn(),
  onReset: vi.fn(),
  onTimeChange: vi.fn(),
  onDayChange: vi.fn(),
  onDismissError: vi.fn(),
  onPickModeChange: vi.fn(),
};

describe('RoutePanel', () => {
  it('disables Go when addresses are missing', () => {
    render(<RoutePanel {...baseProps} />);
    const button = screen.getByRole('button', { name: /^go$/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits route request when both addresses are present', () => {
    const onComputeRoute = vi.fn();
    render(
      <RoutePanel
        {...baseProps}
        startAddress="A"
        endAddress="B"
        onComputeRoute={onComputeRoute}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^go$/i }));
    expect(onComputeRoute).toHaveBeenCalledTimes(1);
  });

  it('toggles choose-point pick mode', () => {
    const onPickModeChange = vi.fn();
    render(<RoutePanel {...baseProps} onPickModeChange={onPickModeChange} />);
    fireEvent.click(screen.getByRole('button', { name: /pick start on map/i }));
    expect(onPickModeChange).toHaveBeenCalledWith('start');
  });
});
