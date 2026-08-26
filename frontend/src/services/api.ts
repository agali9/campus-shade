import { RouteRequest, RouteResponse, CampusBounds, Location } from '../types';

const API_BASE_URL = 'http://localhost:8000';

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
        throw new Error(errorMessage);
      }

      return response.json();
    } catch (error) {
      console.error('Route computation error:', error);
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
    dayOfYear: number = 180
  ): Promise<RouteResponse> {
    return this.computeRoute({
      start,
      end,
      time_of_day: timeOfDay,
      day_of_year: dayOfYear,
      optimize_for: 'shade',
      shade_weight: 0.7,
    });
  }

  static async computeRouteWithWaypoints(
    start: { lat: number; lon: number },
    end: { lat: number; lon: number },
    waypoints: Location[],
    timeOfDay: number,
    dayOfYear: number = 180
  ): Promise<RouteResponse> {
    return this.computeRoute({
      start,
      end,
      time_of_day: timeOfDay,
      day_of_year: dayOfYear,
      optimize_for: 'shade',
      shade_weight: 0.7,
      waypoints: waypoints,
    });
  }

  static async getGoogleDirections(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    directionsService: google.maps.DirectionsService
  ): Promise<google.maps.DirectionsResult> {
    return new Promise((resolve, reject) => {
      directionsService.route(
        {
          origin: start,
          destination: end,
          travelMode: google.maps.TravelMode.WALKING,
        },
        (result, status) => {
          if (status === 'OK' && result) {
            resolve(result);
          } else {
            reject(new Error(`Directions request failed: ${status}`));
          }
        }
      );
    });
  }
  
  static async getSunPosition(
    hour: number,
    day: number
  ): Promise<{ azimuth: number; elevation: number; is_daytime: boolean }> {
    try {
      const response = await fetch(
        `${API_BASE_URL}/sun?hour=${hour}&day=${day}`,
        {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
          },
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response.json();
    } catch (error) {
      console.error('Failed to fetch sun position:', error);
      throw error;
    }
  }

  static async getShadows(
    hour: number,
    day: number
  ): Promise<any> {
    try {
      const response = await fetch(
        `${API_BASE_URL}/shadows?hour=${hour}&day=${day}`,
        {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
          },
        }
      );
      
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
      const response = await fetch(
        `${API_BASE_URL}/buildings`,
        {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
          },
        }
      );
      
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
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}