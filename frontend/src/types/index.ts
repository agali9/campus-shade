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
  path_coordinates: [number, number][];
  polyline_coordinates: [number, number][];
  edge_geometries: [number, number][][];
  edge_ids: string[];
  comparison?: {
    fastest_distance: number;
    fastest_shade: number;
    shade_route_distance: number;
    shade_route_shade: number;
  };
  fastest_segments?: RouteSegment[];
}

export interface CampusBounds {
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
  center: {
