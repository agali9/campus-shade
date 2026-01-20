import { RouteRequest, RouteResponse, CampusBounds } from '../types';

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
    const response = await fetch(`${API_BASE_URL}/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error('Failed to compute route');
    }

    return response.json();
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
}
