import { RouteRequest, RouteResponse, CampusBounds, Location, BackendStatus, DaySun } from '../types';

const PRODUCTION_API = 'https://campus-shade.onrender.com';

function resolveApiBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host.includes('workers.dev') || host.includes('campus-shade')) {
      return PRODUCTION_API;
    }
  }
  return 'http://localhost:8000';
}

const API_BASE_URL = resolveApiBaseUrl();

const CAMPUS_VIEWBOX = '-111.945,33.432,-111.918,33.410'; // lon_max,lat_max,lon_min,lat_min for Nominatim

export class ApiService {
  static async getCampusBounds(): Promise<CampusBounds> {
    const response = await fetch(`${API_BASE_URL}/campus/bounds`);
    if (!response.ok) {
      throw new Error('Failed to fetch campus bounds');
    }
    return response.json();
  }

  static async computeRoute(request: RouteRequest): Promise<RouteResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        // Render free tier is slow on first shade routes (often 20–40s).
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = 'Failed to compute route';

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }

        console.error('Route computation failed:', errorMessage);
        throw new Error(
          typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage)
        );
      }

      return response.json();
    } catch (error) {
      console.error('Route computation error:', error);
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new Error('Route request timed out');
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to compute route - check if backend is running');
    }
  }

  static async computeShadeOptimizedRoute(
    start: { lat: number; lon: number },
    end: { lat: number; lon: number },
    timeOfDay: number,
    dayOfYear: number = 180,
    calendarDate?: string
  ): Promise<RouteResponse> {
    return this.computeRoute({
      start,
      end,
      time_of_day: timeOfDay,
      day_of_year: dayOfYear,
      optimize_for: 'shade',
      shade_weight: 0.7,
      calendar_date: calendarDate,
    });
  }

  static async snapToNetwork(
    lat: number,
    lon: number
  ): Promise<{ lat: number; lon: number; snap_distance_m: number }> {
    const response = await fetch(
      `${API_BASE_URL}/snap?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
      {
        method: 'GET',
        mode: 'cors',
        headers: { Accept: 'application/json' },
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      let message = 'Could not snap to a walkable path';
      try {
        const json = JSON.parse(errorText);
        message = json.detail || message;
      } catch {
        if (errorText) message = errorText;
      }
      throw new Error(message);
    }
    const data = await response.json();
    return {
      lat: Number(data.lat),
      lon: Number(data.lon),
      snap_distance_m: Number(data.snap_distance_m),
    };
  }

  static async searchCampusPlaces(
    query: string
  ): Promise<Array<{ label: string; lat: number; lon: number }>> {
    const url =
      'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({
        q: query,
        format: 'json',
        addressdetails: '0',
        limit: '6',
        viewbox: CAMPUS_VIEWBOX,
        bounded: '1',
      });

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error('Place search failed');
    }
    const data = (await response.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;
    return data.map((item) => ({
      label: item.display_name.split(',').slice(0, 3).join(',').trim(),
      lat: Number(item.lat),
      lon: Number(item.lon),
    }));
  }

  static async reverseGeocode(lat: number, lon: number): Promise<string> {
    try {
      const url =
        'https://nominatim.openstreetmap.org/reverse?' +
        new URLSearchParams({
          lat: String(lat),
          lon: String(lon),
          format: 'json',
        });
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      }
      const data = await response.json();
      return data.display_name?.split(',').slice(0, 3).join(',').trim()
        || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  }

  static async getSunDay(date: string): Promise<DaySun> {
    const response = await fetch(
      `${API_BASE_URL}/sun/day?date=${encodeURIComponent(date)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) {
      throw new Error('Failed to fetch sunrise and sunset');
    }
    return response.json();
  }

  static async getSunPosition(
    hour: number,
    day: number
  ): Promise<{ azimuth: number; elevation: number; is_daytime: boolean }> {
    try {
      const response = await fetch(`${API_BASE_URL}/sun?hour=${hour}&day=${day}`, {
        method: 'GET',
        mode: 'cors',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      console.error('Failed to fetch sun position:', error);
      throw error;
    }
  }

  static async getShadows(hour: number, day: number): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/shadows?hour=${hour}&day=${day}`, {
        method: 'GET',
        mode: 'cors',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      console.error('Failed to fetch shadow data:', error);
      throw error;
    }
  }

  static async getBuildings(): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/buildings`, {
        method: 'GET',
        mode: 'cors',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      console.error('Failed to fetch building data:', error);
      throw error;
    }
  }

  static async checkBackendHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/`, {
        method: 'GET',
        mode: 'cors',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  static async getBackendStatus(): Promise<BackendStatus> {
    // Render free tier cold starts often take 45–90s; a short timeout
    // makes the UI claim "waking up" forever while the server is still booting.
    const response = await fetch(`${API_BASE_URL}/`, {
      method: 'GET',
      mode: 'cors',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }
}
