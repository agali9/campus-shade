import { describe, expect, it, vi, afterEach } from 'vitest';
import { ApiService } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApiService', () => {
  it('returns campus bounds from backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          min_lat: 33.412,
          max_lat: 33.432,
          min_lon: -111.942,
          max_lon: -111.918,
          center: { lat: 33.4242, lon: -111.9281 },
        }),
        { status: 200 }
      )
    );

    const bounds = await ApiService.getCampusBounds();
    expect(bounds.center.lat).toBe(33.4242);
  });

  it('throws backend error message on failed route request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'No route found' }), { status: 404 })
    );

    await expect(
      ApiService.computeShadeOptimizedRoute(
        { lat: 33.4242, lon: -111.9281 },
        { lat: 33.4252, lon: -111.9271 },
        12,
        180
      )
    ).rejects.toThrow('No route found');
  });

  it('returns false when backend health check fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));
    const healthy = await ApiService.checkBackendHealth();
    expect(healthy).toBe(false);
  });
});
