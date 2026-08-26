import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GoogleControls } from './GoogleControls';

vi.mock('./SearchBox', () => ({
  SearchBox: ({ placeholder }: { placeholder: string }) => <input aria-label={placeholder} />,
}));

const baseProps = {
  startAddress: '',
  endAddress: '',
  timeOfDay: 12,
  dayOfYear: 180,
  showShadeRoute: true,
  showShadows: true,
  sunPosition: null,
  onStartSelect: vi.fn(),
  onEndSelect: vi.fn(),
  onStartClear: vi.fn(),
  onEndClear: vi.fn(),
  onSwapLocations: vi.fn(),
  onTimeChange: vi.fn(),
  onDayChange: vi.fn(),
  onShowShadeRouteChange: vi.fn(),
  onShowShadowsChange: vi.fn(),
  onComputeRoute: vi.fn(),
  onReset: vi.fn(),
  isComputing: false,
  googleRouteInfo: null,
  shadedRouteInfo: null,
};

describe('GoogleControls', () => {
  it('disables route submit when addresses are missing', () => {
    render(<GoogleControls {...baseProps} />);
    const button = screen.getByRole('button', { name: /get directions/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits route request when both addresses are present', () => {
    const onComputeRoute = vi.fn();
    render(
      <GoogleControls
        {...baseProps}
        startAddress="A"
        endAddress="B"
        onComputeRoute={onComputeRoute}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /get directions/i }));
    expect(onComputeRoute).toHaveBeenCalledTimes(1);
  });
});
