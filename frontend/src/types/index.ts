export interface Location {
  lat: number;
  lon: number;
}

export interface RouteRequest {
  start: Location;
  end: Location;
  time_of_day: number;
  day_of_year: number;
  optimize_for: 'shade' | 'speed';
  shade_weight: number;
  waypoints?: Location[];
}

export interface RouteSegment {
  start: Location;
  end: Location;
  distance: number;
  shade_probability: number;
  orientation: number;
}

export interface RouteResponse {
  segments: RouteSegment[];
  total_distance: number;
  average_shade: number;
  total_time_minutes: number;
