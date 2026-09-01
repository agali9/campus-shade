export interface Location {
  lat: number;
  lon: number;
}

export interface BackendShadowWarmup {
  edges_ready: boolean;
  last_edge_key: string | null;
  cached_shadow_buckets: number;
}

export interface BackendStatus {
  status: string;
  buildings_loaded?: number;
  street_network_ready?: boolean;
  shadow_bucket_minutes?: number;
  shadow_warmup?: BackendShadowWarmup;
}

export interface RouteRequest {
  start: Location;
  end: Location;
  time_of_day: number;
  day_of_year: number;
  optimize_for: 'shade' | 'speed';
  shade_weight: number;
  calendar_date?: string;
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
    sun_below_horizon?: boolean;
    sun_elevation?: number;
  };
  fastest_segments?: RouteSegment[];
  fastest_polyline_coordinates?: [number, number][];
}

export interface DaySun {
  date: string;
  sunrise: string;
  sunset: string;
  sunrise_hour: number;
  sunset_hour: number;
  source: string;
}

export interface CampusBounds {
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
  center: {
    lat: number;
    lon: number;
  };
}

export interface DualRouteResponse {
  fastest: RouteResponse;
  shaded: RouteResponse;
}