"""OSMnx-backed routing service and datastore."""

from __future__ import annotations

import hashlib
import logging
import math
import pickle
import random
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import networkx as nx
import osmnx as ox
import pytz
from shapely.geometry import LineString, Point
from shapely.ops import substring, transform
from shapely.wkt import dumps as wkt_dumps
from sqlalchemy import and_, func, text

from .database import DATABASE_URL, get_engine, get_session
from .models import Base, BuildingFootprint, OSMEdgeShadeIndex, OSMGraphCache


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


class RouteDataStore:
    GRAPH_CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "cache" / "osm_walk.graphml"
    GRAPH_CACHE_VERSION = "osm-v1"

    def __init__(self) -> None:
        self.logger = logging.getLogger("uvicorn.error")

    def load_or_seed_buildings(self, building_loader, buildings_file: Path) -> List[Dict]:
        Base.metadata.create_all(bind=get_engine())
        with get_session() as session:
            existing_count = int(session.query(func.count(BuildingFootprint.id)).scalar() or 0)
            should_seed = existing_count == 0
            if existing_count > 0 and existing_count < 100 and buildings_file.exists():
                # Repair known test-fixture state where DB only has a tiny subset of campus buildings.
                self.logger.warning(
                    "Building table has only %s rows; reseeding from %s",
                    existing_count,
                    buildings_file,
                )
                session.query(BuildingFootprint).delete()
                session.commit()
                should_seed = True

            if should_seed and buildings_file.exists():
                seed_buildings = building_loader.load_from_geojson(str(buildings_file))
                for idx, b in enumerate(seed_buildings, start=1):
                    polygon_wgs84 = transform(building_loader.project_to_wgs84, b["polygon"])
                    min_lon, min_lat, max_lon, max_lat = polygon_wgs84.bounds
                    session.add(
                        BuildingFootprint(
                            id=idx,
                            name=str(b.get("name", "Unknown")),
                            height=float(b.get("height", 10.0)),
                            min_lat=float(min_lat),
                            max_lat=float(max_lat),
                            min_lon=float(min_lon),
                            max_lon=float(max_lon),
                            geom_wkt=wkt_dumps(polygon_wgs84),
                        )
                    )
                session.commit()
                self._ensure_indexes()
            rows = session.query(BuildingFootprint).all()

        from shapely.wkt import loads as wkt_loads

        buildings: List[Dict] = []
        for row in rows:
            polygon_wgs84 = wkt_loads(row.geom_wkt)
            polygon_utm = transform(building_loader.project_to_utm, polygon_wgs84)
            buildings.append(
                {
                    "polygon": polygon_utm,
                    "height": float(row.height),
                    "name": row.name,
                    "id": row.id,
                }
            )
        self.logger.info("Loaded %s buildings from PostgreSQL", len(buildings))
        return buildings

    def get_building_count(self) -> int:
        with get_session() as session:
            return int(session.query(func.count(BuildingFootprint.id)).scalar() or 0)

    def fetch_buildings_in_bbox(
        self,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
    ) -> List[BuildingFootprint]:
        with get_session() as session:
            return (
                session.query(BuildingFootprint)
                .filter(BuildingFootprint.max_lat >= min_lat)
                .filter(BuildingFootprint.min_lat <= max_lat)
                .filter(BuildingFootprint.max_lon >= min_lon)
                .filter(BuildingFootprint.min_lon <= max_lon)
                .all()
            )

    def build_bounds_from_buildings(self, buildings: List[Dict], padding_m: float = 200.0) -> Tuple[float, float, float, float]:
        min_x = min(b["polygon"].bounds[0] for b in buildings)
        min_y = min(b["polygon"].bounds[1] for b in buildings)
        max_x = max(b["polygon"].bounds[2] for b in buildings)
        max_y = max(b["polygon"].bounds[3] for b in buildings)
        center_lat = sum(pt["polygon"].centroid.y for pt in buildings) / len(buildings)
        lat_pad = padding_m / 111_320.0
        lon_pad = padding_m / (111_320.0 * max(0.1, math.cos(math.radians(center_lat))))
        # convert rough UTM ranges by transforming corners through inverse function in caller
        return min_x, min_y, max_x, max_y

    @staticmethod
    def bounds_key(north: float, south: float, east: float, west: float, network_type: str) -> str:
        raw = f"{north:.6f}:{south:.6f}:{east:.6f}:{west:.6f}:{network_type}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def load_or_build_osm_graph(
        self,
        north: float,
        south: float,
        east: float,
        west: float,
        building_count: int,
    ) -> nx.MultiDiGraph:
        Base.metadata.create_all(bind=get_engine())
        preferred_network_types = ["all", "all_public", "walk", "drive"]
        bkey = self.bounds_key(north, south, east, west, preferred_network_types[0])

        with get_session() as session:
            cached = (
                session.query(OSMGraphCache)
                .filter(OSMGraphCache.id == 1)
                .filter(OSMGraphCache.building_count == building_count)
                .filter(OSMGraphCache.bounds_key == bkey)
                .one_or_none()
            )
            if cached is not None:
                graph = pickle.loads(cached.graph_blob)
                self.logger.info(
                    "Loaded OSM walking network: %s nodes, %s edges",
                    graph.number_of_nodes(),
                    graph.number_of_edges(),
                )
                self.logger.info(
                    "OSM graph source=postgres-cache network_type=%s",
                    graph.graph.get("network_type", "unknown"),
                )
                self.logger.info(
                    "OSM graph: %s nodes, %s edges, bbox=(%s,%s,%s,%s)",
                    graph.number_of_nodes(),
                    graph.number_of_edges(),
                    north,
                    south,
                    east,
                    west,
                )
                return graph

        if self.GRAPH_CACHE_FILE.exists():
            try:
                graph = ox.load_graphml(self.GRAPH_CACHE_FILE)
                if graph.graph.get("cache_version") == self.GRAPH_CACHE_VERSION and graph.graph.get("bounds_key") == bkey:
                    self._persist_graph_to_db(graph, building_count, bkey)
                    self.logger.info(
                        "Loaded OSM walking network: %s nodes, %s edges",
                        graph.number_of_nodes(),
                        graph.number_of_edges(),
                    )
                    self.logger.info(
                        "OSM graph source=disk-cache network_type=%s",
                        graph.graph.get("network_type", "unknown"),
                    )
                    self.logger.info(
                        "OSM graph: %s nodes, %s edges, bbox=(%s,%s,%s,%s)",
                        graph.number_of_nodes(),
                        graph.number_of_edges(),
                        north,
                        south,
                        east,
                        west,
                    )
                    return graph
            except Exception:
                pass

        graph = None
        selected_network_type = None
        for network_type in preferred_network_types:
            try:
                candidate = ox.graph_from_bbox(north, south, east, west, network_type=network_type)
                if candidate.number_of_edges() > 0:
                    graph = candidate
                    selected_network_type = network_type
                    break
            except Exception:
                continue
        if graph is None:
            raise RuntimeError("Unable to load OSM graph for any network_type fallback")
        graph.graph["cache_version"] = self.GRAPH_CACHE_VERSION
        graph.graph["bounds_key"] = bkey
        graph.graph["network_type"] = selected_network_type or "unknown"
        graph.graph["bbox"] = {"north": north, "south": south, "east": east, "west": west}
        self.GRAPH_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        ox.save_graphml(graph, self.GRAPH_CACHE_FILE)
        self._persist_graph_to_db(graph, building_count, bkey)
        self.logger.info(
            "Loaded OSM walking network: %s nodes, %s edges",
            graph.number_of_nodes(),
            graph.number_of_edges(),
        )
        self.logger.info("OSM graph source=osmnx network_type=%s", selected_network_type)
        self.logger.info(
            "OSM graph: %s nodes, %s edges, bbox=(%s,%s,%s,%s)",
            graph.number_of_nodes(),
            graph.number_of_edges(),
            north,
            south,
            east,
            west,
        )
        return graph

    def _persist_graph_to_db(self, graph: nx.MultiDiGraph, building_count: int, bkey: str) -> None:
        blob = pickle.dumps(graph)
        with get_session() as session:
            row = session.query(OSMGraphCache).filter(OSMGraphCache.id == 1).one_or_none()
            if row is None:
                row = OSMGraphCache(id=1, building_count=building_count, bounds_key=bkey, graph_blob=blob)
                session.add(row)
            else:
                row.building_count = building_count
                row.bounds_key = bkey
                row.graph_blob = blob
            session.commit()

    def _ensure_indexes(self) -> None:
        engine = get_engine()
        with engine.begin() as conn:
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_buildings_bbox ON building_footprints(min_lat, max_lat, min_lon, max_lon)"))
            if DATABASE_URL.startswith("postgresql"):
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
                conn.execute(text("ALTER TABLE building_footprints ADD COLUMN IF NOT EXISTS geom geometry(Polygon,4326)"))
                conn.execute(text("UPDATE building_footprints SET geom = ST_GeomFromText(geom_wkt, 4326) WHERE geom IS NULL"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_buildings_geom ON building_footprints USING GIST(geom)"))

    def precompute_shade_index(
        self,
        graph: nx.MultiDiGraph,
        day_of_year: int,
        shadow_calc,
        buildings_utm: List[Dict],
        building_loader,
    ) -> None:
        expected_rows = graph.number_of_edges() * 288
        with get_session() as session:
            existing = (
                session.query(func.count(OSMEdgeShadeIndex.id))
                .filter(OSMEdgeShadeIndex.day_of_year == day_of_year)
                .scalar()
                or 0
            )
        if existing >= expected_rows:
            return

        tz = pytz.timezone("America/Phoenix")
        base_date = datetime(2024, 1, 1, tzinfo=tz)
        edge_list = list(graph.edges(keys=True, data=True))
        batch: List[OSMEdgeShadeIndex] = []
        for minute in range(0, 24 * 60, 5):
            dt = base_date + timedelta(days=day_of_year, minutes=minute)
            shadow = shadow_calc.calculate_all_shadows(buildings_utm, dt)
            for u, v, k, data in edge_list:
                edge_id = edge_identifier(u, v, k)
                geom = DBRouteService.edge_geometry_data(graph, u, v, data)
                geom_utm = transform(building_loader.project_to_utm, geom)
                shade_fraction = (
                    shadow_calc.calculate_street_shade(geom_utm, shadow)
                    if shadow and not shadow.is_empty
                    else 0.0
                )
                batch.append(
                    OSMEdgeShadeIndex(
                        day_of_year=day_of_year,
                        edge_id=edge_id,
                        time_bucket=minute,
                        shade_fraction=float(max(0.0, min(1.0, shade_fraction))),
                    )
                )
                if len(batch) >= 10_000:
                    self._upsert_shade_batch(batch)
                    batch = []
        if batch:
            self._upsert_shade_batch(batch)

    def _upsert_shade_batch(self, batch: List[OSMEdgeShadeIndex]) -> None:
        with get_session() as session:
            for row in batch:
                existing = (
                    session.query(OSMEdgeShadeIndex)
                    .filter(
                        and_(
                            OSMEdgeShadeIndex.day_of_year == row.day_of_year,
                            OSMEdgeShadeIndex.edge_id == row.edge_id,
                            OSMEdgeShadeIndex.time_bucket == row.time_bucket,
                        )
                    )
                    .one_or_none()
                )
                if existing is None:
                    session.add(row)
                else:
                    existing.shade_fraction = row.shade_fraction
            session.commit()

    def shade_for_edge_at_time(self, edge_id: str, day_of_year: int, minute: int) -> Optional[float]:
        bucket = int(minute / 5) * 5
        with get_session() as session:
            row = (
                session.query(OSMEdgeShadeIndex)
                .filter(
                    and_(
                        OSMEdgeShadeIndex.day_of_year == day_of_year,
                        OSMEdgeShadeIndex.edge_id == edge_id,
                        OSMEdgeShadeIndex.time_bucket == bucket,
                    )
                )
                .one_or_none()
            )
        return None if row is None else float(row.shade_fraction)


@dataclass
class RoutePathResult:
    node_path: List[Tuple[float, float]]  # [lat, lon]
    polyline_path: List[Tuple[float, float]]  # [lat, lon]
    edge_geometries_lnglat: List[List[Tuple[float, float]]]  # [[lng, lat], ...] per edge
    edge_ids: List[str]


class DBRouteService:
    """Single-source OSM graph router for fastest and shaded routes."""

    def __init__(self, store: RouteDataStore):
        self.store = store
        self.graph: Optional[nx.MultiDiGraph] = None
        self.logger = logging.getLogger("uvicorn.error")

    def set_graph(self, graph: nx.MultiDiGraph) -> None:
        self.graph = graph
        self.logger.info("Route graph object id=%s", id(self.graph))

    def debug_nodes_geojson(self) -> Dict[str, object]:
        if self.graph is None:
            return {"type": "FeatureCollection", "features": []}
        features = []
        for node_id, data in self.graph.nodes(data=True):
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [float(data["x"]), float(data["y"])]},
                    "properties": {"id": str(node_id)},
                }
            )
        return {"type": "FeatureCollection", "features": features}

    def debug_graph_geojson(self) -> Dict[str, object]:
        if self.graph is None:
            return {"type": "FeatureCollection", "features": []}
        features: List[Dict[str, object]] = []
        for u, v, k, data in self.graph.edges(keys=True, data=True):
            geom = self._edge_geometry_data(self.graph, u, v, data)
            coords = [[float(x), float(y)] for x, y in geom.coords]
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {
                        "u": str(u),
                        "v": str(v),
                        "k": int(k) if isinstance(k, int) else 0,
                        "length": float(data.get("length", 0.0)),
                    },
                }
            )
        return {"type": "FeatureCollection", "features": features}

    def debug_snap(self, lat: float, lon: float, mode: str = "after") -> Dict[str, object]:
        if self.graph is None:
            return {"nearest_node_coordinates": None, "snap_distance_m": float("inf"), "accepted": False, "reason": "graph unavailable"}
        edge = ox.distance.nearest_edges(self.graph, X=lon, Y=lat)
        u, v, k = edge
        geom = self._edge_geometry(self.graph, u, v, k)
        proj = geom.interpolate(geom.project(Point(lon, lat)))
        dist = haversine_m(lat, lon, proj.y, proj.x)
        accepted = dist <= (150.0 if mode == "before" else 300.0)
        return {
            "nearest_node_coordinates": [float(self.graph.nodes[u]["y"]), float(self.graph.nodes[u]["x"])],
            "snap_distance_m": round(dist, 2),
            "accepted": accepted,
            "reason": "edge snap within threshold" if accepted else "rejected: too far from edge",
            "graph_id": id(self.graph),
        }

    def route(
        self,
        start_lat: float,
        start_lon: float,
        end_lat: float,
        end_lon: float,
        shade_weight: float,
        day_of_year: int,
        departure_minutes: int,
        shadow_polygon_utm,
        building_loader,
        shadow_calc,
        time_aware: bool = True,
    ) -> Optional[RoutePathResult]:
        if self.graph is None:
            return None
        working = self.graph.copy()
        start_tmp = self._snap_point_to_edge(working, start_lat, start_lon, "start")
        end_tmp = self._snap_point_to_edge(working, end_lat, end_lon, "end")
        if start_tmp is None or end_tmp is None:
            return None

        try:
            if time_aware:
                node_path, edge_path, static_exposure, dynamic_exposure = self._time_aware_dijkstra(
                    working,
                    start_tmp,
                    end_tmp,
                    day_of_year=day_of_year,
                    departure_minutes=departure_minutes,
                    shade_weight=shade_weight,
                    shadow_polygon_utm=shadow_polygon_utm,
                    building_loader=building_loader,
                    shadow_calc=shadow_calc,
                )
                self.logger.info(
                    "time_aware_vs_static_exposure",
                    extra={
                        "static_exposure": round(static_exposure, 4),
                        "time_aware_exposure": round(dynamic_exposure, 4),
                    },
                )
            else:
                node_path = nx.shortest_path(
                    working,
                    start_tmp,
                    end_tmp,
                    weight=lambda u, v, d: float(d.get("length", self._edge_length_m(working, u, v, d))),
                    method="dijkstra",
                )
                edge_path = self._node_path_to_edges(working, node_path)
        except Exception:
            return None

        node_coords = [(float(working.nodes[n]["y"]), float(working.nodes[n]["x"])) for n in node_path]
        polyline, edge_geometries, edge_ids = self._build_route_geometry(working, edge_path)
        return RoutePathResult(
            node_path=node_coords,
            polyline_path=polyline,
            edge_geometries_lnglat=edge_geometries,
            edge_ids=edge_ids,
        )

    def _time_aware_dijkstra(
        self,
        graph: nx.MultiDiGraph,
        start_node,
        end_node,
        day_of_year: int,
        departure_minutes: int,
        shade_weight: float,
        shadow_polygon_utm,
        building_loader,
        shadow_calc,
    ) -> Tuple[List[object], List[Tuple[object, object, object]], float, float]:
        import heapq

        speed_mps = 1.4
        pq = [(0.0, 0.0, start_node)]  # cost, seconds_from_start, node
        parent: Dict[object, object] = {}
        parent_edge: Dict[object, Tuple[object, object, object]] = {}
        best_cost = {start_node: 0.0}
        static_exposure = 0.0
        dynamic_exposure = 0.0

        while pq:
            cost, elapsed_sec, node = heapq.heappop(pq)
            if node == end_node:
                node_path = self._reconstruct(parent, end_node)
                edge_path = self._reconstruct_edges(parent_edge, end_node)
                return node_path, edge_path, static_exposure, dynamic_exposure
            if cost > best_cost.get(node, float("inf")):
                continue

            for nbr, key_dict in graph[node].items():
                for k, data in key_dict.items():
                    length = float(data.get("length", self._edge_length_m(graph, node, nbr, data)))
                    travel_sec = length / speed_mps
                    arrival_min = int(departure_minutes + (elapsed_sec + travel_sec) / 60)
                    edge_id = edge_identifier(node, nbr, k)
                    shade_fraction = self.store.shade_for_edge_at_time(edge_id, day_of_year, arrival_min)
                    if shade_fraction is None:
                        geom = self._edge_geometry_data(graph, node, nbr, data)
                        line_utm = transform(building_loader.project_to_utm, geom)
                        shade_fraction = (
                            shadow_calc.calculate_street_shade(line_utm, shadow_polygon_utm)
                            if shadow_polygon_utm is not None and not shadow_polygon_utm.is_empty
                            else 0.0
                        )
                    sun_fraction = 1.0 - float(max(0.0, min(1.0, shade_fraction)))
                    edge_cost = length * (1.0 + max(0.0, shade_weight) * sun_fraction)
                    new_cost = cost + edge_cost
                    if new_cost < best_cost.get(nbr, float("inf")):
                        best_cost[nbr] = new_cost
                        parent[nbr] = node
                        parent_edge[nbr] = (node, nbr, k)
                        heapq.heappush(pq, (new_cost, elapsed_sec + travel_sec, nbr))
                        dynamic_exposure += sun_fraction * length
                        static_exposure += max(0.0, 1.0 - shade_fraction) * length
        raise RuntimeError("No path found")

    @staticmethod
    def _reconstruct(parent: Dict[object, object], end_node: object) -> List[object]:
        path = [end_node]
        node = end_node
        while node in parent:
            node = parent[node]
            path.append(node)
        path.reverse()
        return path

    @staticmethod
    def _reconstruct_edges(
        parent_edge: Dict[object, Tuple[object, object, object]],
        end_node: object,
    ) -> List[Tuple[object, object, object]]:
        edges: List[Tuple[object, object, object]] = []
        node = end_node
        while node in parent_edge:
            edges.append(parent_edge[node])
            node = parent_edge[node][0]
        edges.reverse()
        return edges

    def _node_path_to_edges(
        self,
        graph: nx.MultiDiGraph,
        node_path: List[object],
    ) -> List[Tuple[object, object, object]]:
        edges: List[Tuple[object, object, object]] = []
        for i in range(len(node_path) - 1):
            u = node_path[i]
            v = node_path[i + 1]
            key = self._best_edge_key(graph, u, v)
            edges.append((u, v, key))
        return edges

    def _build_route_geometry(
        self,
        graph: nx.MultiDiGraph,
        edge_path: List[Tuple[object, object, object]],
    ) -> Tuple[List[Tuple[float, float]], List[List[Tuple[float, float]]], List[str]]:
        polyline_latlon: List[Tuple[float, float]] = []
        edge_geometries_lnglat: List[List[Tuple[float, float]]] = []
        edge_ids: List[str] = []

        for idx, (u, v, key) in enumerate(edge_path):
            geom = self._edge_geometry(graph, u, v, key)
            edge_ids.append(edge_identifier(u, v, key))
            edge_lnglat = [(float(x), float(y)) for x, y in geom.coords]
            edge_geometries_lnglat.append(edge_lnglat)
            edge_latlon = [(float(y), float(x)) for x, y in geom.coords]
            if idx == 0:
                polyline_latlon.extend(edge_latlon)
            else:
                polyline_latlon.extend(edge_latlon[1:])
        return polyline_latlon, edge_geometries_lnglat, edge_ids

    def _best_edge_key(self, graph: nx.MultiDiGraph, u, v):
        edge_dict = graph.get_edge_data(u, v)
        if not edge_dict:
            return 0
        best_key = None
        best_length = float("inf")
        for key, data in edge_dict.items():
            length = float(data.get("length", self._edge_length_m(graph, u, v, data)))
            if length < best_length:
                best_length = length
                best_key = key
        return 0 if best_key is None else best_key

    @staticmethod
    def route_distance_m(path: List[Tuple[float, float]]) -> float:
        total = 0.0
        for i in range(len(path) - 1):
            lat1, lon1 = path[i]
            lat2, lon2 = path[i + 1]
            total += haversine_m(lat1, lon1, lat2, lon2)
        return total

    @staticmethod
    def route_bbox(path: List[Tuple[float, float]]) -> Tuple[float, float, float, float]:
        lats = [p[0] for p in path]
        lons = [p[1] for p in path]
        return min(lats), max(lats), min(lons), max(lons)

    def _snap_point_to_edge(self, graph: nx.MultiDiGraph, lat: float, lon: float, label: str) -> Optional[str]:
        try:
            u, v, k = ox.distance.nearest_edges(graph, X=lon, Y=lat)
        except Exception:
            nearest_node = self._nearest_node_fallback(graph, lat, lon)
            return nearest_node

        geom = self._edge_geometry(graph, u, v, k)
        projected = geom.interpolate(geom.project(Point(lon, lat)))
        snap_distance_m = haversine_m(lat, lon, projected.y, projected.x)
        if snap_distance_m > 300.0:
            self.logger.warning(
                "Snap rejected at lat=%s lon=%s nearest_edge_distance_m=%.2f max_radius_m=300",
                lat,
                lon,
                snap_distance_m,
            )
            return None

        temp_id = f"tmp_{label}_{uuid.uuid4().hex[:8]}"
        graph.add_node(temp_id, x=float(projected.x), y=float(projected.y))

        self._split_edge(graph, u, v, k, temp_id, projected)
        if graph.has_edge(v, u):
            reverse_keys = list(graph[v][u].keys())
            for rk in reverse_keys:
                self._split_edge(graph, v, u, rk, temp_id, projected)
        return temp_id

    @staticmethod
    def _nearest_node_fallback(graph: nx.MultiDiGraph, lat: float, lon: float):
        best = None
        best_distance = float("inf")
        for node_id, data in graph.nodes(data=True):
            d = haversine_m(lat, lon, float(data["y"]), float(data["x"]))
            if d < best_distance:
                best_distance = d
                best = node_id
        return best if best_distance <= 300.0 else None

    def _split_edge(self, graph: nx.MultiDiGraph, u, v, key, temp_id: str, projected_point: Point) -> None:
        if not graph.has_edge(u, v, key):
            return
        attrs = dict(graph.get_edge_data(u, v, key))
        geom = self._edge_geometry_data(graph, u, v, attrs)
        distance_on_line = geom.project(projected_point)
        seg1 = substring(geom, 0.0, distance_on_line)
        seg2 = substring(geom, distance_on_line, geom.length)
        if seg1.is_empty:
            seg1 = LineString(
                [
                    (float(graph.nodes[u]["x"]), float(graph.nodes[u]["y"])),
                    (float(projected_point.x), float(projected_point.y)),
                ]
            )
        if seg2.is_empty:
            seg2 = LineString(
                [
                    (float(projected_point.x), float(projected_point.y)),
                    (float(graph.nodes[v]["x"]), float(graph.nodes[v]["y"])),
                ]
            )
        graph.remove_edge(u, v, key)
        attrs1 = dict(attrs)
        attrs2 = dict(attrs)
        attrs1["geometry"] = seg1
        attrs2["geometry"] = seg2
        attrs1["length"] = max(0.1, self._linestring_length_m(seg1))
        attrs2["length"] = max(0.1, self._linestring_length_m(seg2))
        graph.add_edge(u, temp_id, **attrs1)
        graph.add_edge(temp_id, v, **attrs2)

    @staticmethod
    def _edge_geometry(graph: nx.MultiDiGraph, u, v, key) -> LineString:
        data = dict(graph.get_edge_data(u, v, key))
        return DBRouteService._edge_geometry_data(graph, u, v, data)

    @staticmethod
    def edge_geometry_data(graph: nx.MultiDiGraph, u, v, data: Dict) -> LineString:
        return DBRouteService._edge_geometry_data(graph, u, v, data)

    @staticmethod
    def _edge_geometry_data(graph: nx.MultiDiGraph, u, v, data: Dict) -> LineString:
        geom = data.get("geometry")
        if isinstance(geom, LineString):
            return geom
        if geom is not None:
            try:
                from shapely.wkt import loads as wkt_loads

                return wkt_loads(str(geom))
            except Exception:
                pass
        return LineString(
            [
                (float(graph.nodes[u]["x"]), float(graph.nodes[u]["y"])),
                (float(graph.nodes[v]["x"]), float(graph.nodes[v]["y"])),
            ]
        )

    @staticmethod
    def _linestring_length_m(line: LineString) -> float:
        coords = list(line.coords)
        total = 0.0
        for i in range(len(coords) - 1):
            lon1, lat1 = coords[i]
            lon2, lat2 = coords[i + 1]
            total += haversine_m(lat1, lon1, lat2, lon2)
        return total

    def _edge_length_m(self, graph: nx.MultiDiGraph, u, v, data: Dict) -> float:
        return self._linestring_length_m(self._edge_geometry_data(graph, u, v, data))

    def benchmark(self, iterations: int = 1000) -> Dict[str, float]:
        if self.graph is None:
            raise RuntimeError("graph unavailable")
        nodes = list(self.graph.nodes())
        if len(nodes) < 2:
            raise RuntimeError("graph too small")
        latencies = []
        for _ in range(iterations):
            a, b = random.sample(nodes, 2)
            start = time.perf_counter()
            _ = self.route(
                start_lat=float(self.graph.nodes[a]["y"]),
                start_lon=float(self.graph.nodes[a]["x"]),
                end_lat=float(self.graph.nodes[b]["y"]),
                end_lon=float(self.graph.nodes[b]["x"]),
                shade_weight=0.7,
                day_of_year=180,
                departure_minutes=12 * 60,
                shadow_polygon_utm=None,
                building_loader=lambda *args, **kwargs: None,  # not used when shadow is None
                shadow_calc=None,
                time_aware=False,
            )
            latencies.append((time.perf_counter() - start) * 1000)
        latencies.sort()
        return {
            "p50_ms": latencies[int(0.50 * len(latencies))],
            "p95_ms": latencies[int(0.95 * len(latencies))],
            "p99_ms": latencies[int(0.99 * len(latencies))],
        }


def edge_identifier(u, v, key) -> str:
    return f"{u}|{v}|{key}"