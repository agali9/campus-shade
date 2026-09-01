import cProfile
import io
import logging
import math
import os
import pstats
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, cast

import pytz
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Polygon, box, mapping
from shapely.ops import transform, unary_union
from shapely.wkt import loads as wkt_loads

from .building_data_loader import BuildingDataLoader
from .cache import RouteCache
from .database import DATABASE_URL, check_database_connection
from .models import Location, RouteRequest, RouteResponse, RouteSegment
from .observability import (
    CACHE_HIT_RATE,
    ROUTE_DISTANCE,
    metrics_endpoint,
    request_middleware,
    setup_logging,
    setup_tracing,
    tracer,
)
from .routing import DBRouteService, RouteDataStore, RoutePathResult
from .shadow_calculator import ShadowCalculator
from .sun_schedule import day_sun_window, sun_is_down

app = FastAPI(title="Shadow-Aware Route Planner API")
setup_logging()
setup_tracing()

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "https://campus-shade.agali9.workers.dev",
]


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "").strip()
    if not raw:
        return list(_DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

shadow_calc = ShadowCalculator()
building_loader = BuildingDataLoader()
TZ_PHOENIX = pytz.timezone("America/Phoenix")

BUILDINGS_FILE = Path("data/buildings/asu_campus_only.geojson")
ALL_BUILDINGS: list[dict[str, Any]] = []
street_router: bool | None = None
route_store = RouteDataStore()
route_service = DBRouteService(route_store)
route_cache = RouteCache()
logger = logging.getLogger("uvicorn.error")

CAMPUS_BOUNDS_LATLON = {
    "north": 33.430,
    "south": 33.410,
    "east": -111.920,
    "west": -111.945,
}

BUILDING_INDEX: dict[int, dict[str, Any]] | None = None

def campus_datetime(day: float, hour: float, calendar_date: str | None = None) -> datetime:
    if calendar_date:
        year, month, dom = (int(part) for part in calendar_date.split("-"))
        return TZ_PHOENIX.localize(datetime(year, month, dom)) + timedelta(hours=hour)
    return TZ_PHOENIX.localize(datetime(2024, 1, 1)) + timedelta(days=day, hours=hour)


def sun_down_for(
    day: float, hour: float, calendar_date: str | None = None
) -> tuple[bool, dict[str, Any]]:
    dt = campus_datetime(day, hour, calendar_date)
    window = day_sun_window(dt, shadow_calc)
    return sun_is_down(hour, window), window


def shade_polygons(
    shadow_polygons: list[Any], buildings: list[dict[str, Any]]
) -> list[Polygon]:
    """One non-overlapping shade mask: union of shadows, with footprints removed."""
    if not shadow_polygons:
        return []
    shade = unary_union(shadow_polygons)
    footprints = [
        building["polygon"]
        for building in buildings
        if building.get("polygon") is not None and not building["polygon"].is_empty
    ]
    if footprints:
        shade = shade.difference(unary_union(footprints))
    if shade.is_empty:
        return []
    parts: list[Polygon] = []
    if isinstance(shade, Polygon):
        parts = [shade]
    elif isinstance(shade, MultiPolygon):
        parts = list(shade.geoms)
    elif isinstance(shade, GeometryCollection):
        for geom in shade.geoms:
            if isinstance(geom, Polygon):
                parts.append(geom)
            elif isinstance(geom, MultiPolygon):
                parts.extend(geom.geoms)
    return [part for part in parts if not part.is_empty]


def create_building_index(buildings: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    index: dict[int, dict[str, Any]] = {}
    for i, building in enumerate(buildings):
        bounds = building['polygon'].bounds
        index[i] = {
            'bounds': bounds,
            'building': building
        }
    return index

def initialize_spatial_data() -> None:
    global ALL_BUILDINGS, BUILDING_INDEX, street_router
    try:
        if not BUILDINGS_FILE.exists():
            logger.warning(
                "Buildings file missing at %s — API will start empty until data is present",
                BUILDINGS_FILE.resolve(),
            )
        ALL_BUILDINGS = route_store.load_or_seed_buildings(building_loader, BUILDINGS_FILE)
        BUILDING_INDEX = create_building_index(ALL_BUILDINGS) if ALL_BUILDINGS else None
        logger.info("Loaded %s buildings", len(ALL_BUILDINGS))
    except Exception:
        import traceback
        traceback.print_exc()


def initialize_route_datastore() -> None:
    global route_service, street_router
    if not ALL_BUILDINGS:
        return

    building_count = route_store.get_building_count()
    # Use a generous fixed campus bbox to ensure surrounding roads
    # (E University Dr / S Forest Ave / S Mill Ave) are always covered.
    north = CAMPUS_BOUNDS_LATLON["north"]
    south = CAMPUS_BOUNDS_LATLON["south"]
    east = CAMPUS_BOUNDS_LATLON["east"]
    west = CAMPUS_BOUNDS_LATLON["west"]
    logger.info(
        "Final OSM bbox used: north=%s south=%s east=%s west=%s",
        north,
        south,
        east,
        west,
    )

    try:
        graph = route_store.load_or_build_osm_graph(
            north=north,
            south=south,
            east=east,
            west=west,
            building_count=building_count,
        )
    except Exception:
        logger.exception(
            "OSM graph unavailable; API will start without routing until a retry succeeds"
        )
        return
    route_service.set_graph(graph)
    street_router = True


def _load_osm_graph_in_background() -> None:
    try:
        initialize_route_datastore()
        if street_router:
            logger.info("OSM graph ready")
        else:
            logger.warning("OSM graph still unavailable after background load")
    except Exception:
        logger.exception("Background OSM graph load failed")


if os.getenv("SKIP_DATA_LOADING") != "1":
    initialize_spatial_data()
    if not street_router:
        # Do not block port bind on Overpass. Render kills the deploy if
        # nothing is listening while the campus graph downloads.
        threading.Thread(target=_load_osm_graph_in_background, daemon=True).start()
    if os.getenv("PRECOMPUTE_SHADE_INDEX", "0") == "1":
        try:
            route_store.precompute_shade_index(
                route_service.graph,
                day_of_year=180,
                shadow_calc=shadow_calc,
                buildings_utm=ALL_BUILDINGS,
                building_loader=building_loader,
            )
        except Exception as exc:
            logger.warning("shade index precompute skipped: %s", exc)

SHADOW_CACHE: dict[str, Any] = {}
SHADOW_UNION_CACHE: dict[str, Any] = {}
app.middleware("http")(request_middleware)


def get_buildings_in_view(
    min_lat: float, max_lat: float, min_lon: float, max_lon: float
) -> list[dict[str, Any]]:
    if not BUILDING_INDEX:
        return []
    
    min_x, min_y = building_loader.project_to_utm(min_lon, min_lat)
    max_x, max_y = building_loader.project_to_utm(max_lon, max_lat)
    
    box(min_x, min_y, max_x, max_y)
    
    buildings_in_view: list[dict[str, Any]] = []
    for idx, data in BUILDING_INDEX.items():
        b_minx, b_miny, b_maxx, b_maxy = data['bounds']
        if not (b_maxx < min_x or b_minx > max_x or b_maxy < min_y or b_miny > max_y):
            buildings_in_view.append(data['building'])
    
    return buildings_in_view


@app.get("/")
async def root() -> dict[str, Any]:
    return {
        "status": "ok", 
        "service": "Shadow-Aware Route Planner",
        "buildings_loaded": len(ALL_BUILDINGS),
        "street_network_ready": bool(street_router) and route_service.graph is not None,
        "route_data_source": "postgresql" if DATABASE_URL.startswith("postgresql") else "sqlite",
        "endpoints": {
            "/route": "Compute shadow-optimized route",
            "/shadows": "Get shadow polygons for a time",
            "/buildings": "Get building data",
            "/sun": "Get sun position"
        }
    }


@app.get("/campus/bounds")
async def get_campus_bounds() -> dict[str, Any]:
    return {
        "min_lat": 33.4120,
        "max_lat": 33.4320,
        "min_lon": -111.9420,
        "max_lon": -111.9180,
        "center": {
            "lat": 33.4242,
            "lon": -111.9281
        }
    }


@app.get("/health/db")
async def get_database_health() -> dict[str, Any]:
    is_connected = check_database_connection()
    return {
        "configured": bool(DATABASE_URL),
        "connected": is_connected,
        "database_url_present": bool(DATABASE_URL),
    }

@app.get("/metrics")
async def metrics() -> Any:
    return await metrics_endpoint()


@app.get("/snap")
async def snap_to_walk_network(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
) -> dict[str, Any]:
    """Snap a map click to the nearest walkable OSM edge."""
    if route_service is None or route_service.graph is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    result = route_service.snap_to_network(lat=lat, lon=lon)
    if not result.get("accepted"):
        raise HTTPException(
            status_code=400,
            detail=result.get("reason") or "Could not snap to walkable path",
        )
    return result


@app.get("/debug/snap")
async def debug_snap(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
    mode: str = Query("after", description="Use 'before' to disable edge fallback"),
) -> dict[str, Any]:
    if route_service is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    return route_service.debug_snap(lat=lat, lon=lng, mode=mode)


@app.get("/debug/nodes")
async def debug_nodes() -> dict[str, Any]:
    if route_service is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    return route_service.debug_nodes_geojson()


@app.get("/debug/graph")
async def debug_graph() -> dict[str, Any]:
    if route_service is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    return route_service.debug_graph_geojson()


@app.get("/debug/shadows")
async def debug_shadows(
    hour: float = Query(12.0, description="Hour of day (0-24)"),
    day: int = Query(180, description="Day of year (0-365)"),
    min_lat: float | None = None,
    max_lat: float | None = None,
    min_lon: float | None = None,
    max_lon: float | None = None,
) -> dict[str, Any]:
    return await get_shadows(
        hour=hour,
        day=day,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lon=min_lon,
        max_lon=max_lon,
    )


@app.get("/debug/edge_shade")
async def debug_edge_shade(
    edge_id: str = Query(..., description="Edge id in format u|v|k"),
    hour: float = Query(12.0, description="Hour of day (0-24)"),
    day: int = Query(172, description="Day of year (0-365)"),
) -> dict[str, Any]:
    if route_service is None or route_service.graph is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    def _coerce_node(node_val: str) -> int | str:
        if node_val.lstrip("-").isdigit():
            try:
                return int(node_val)
            except ValueError:
                return node_val
        return node_val

    try:
        u_raw, v_raw, k_raw = edge_id.split("|")
        u = _coerce_node(u_raw)
        v = _coerce_node(v_raw)
        k = int(k_raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="edge_id must be u|v|k") from exc

    graph = route_service.graph
    if not graph.has_edge(u, v, k):
        raise HTTPException(status_code=404, detail=f"Edge {edge_id} not found in graph")

    tz = pytz.timezone("America/Phoenix")
    dt = datetime(2024, 1, 1, tzinfo=tz) + timedelta(days=day, hours=hour)
    shadow_cache_key = f"{day}_{hour:.1f}_full"
    shadow_union = SHADOW_UNION_CACHE.get(shadow_cache_key)
    if shadow_union is None:
        shadow_polygons = shadow_calc.calculate_shadow_polygons(ALL_BUILDINGS, dt)
        shadow_union = unary_union(shadow_polygons) if shadow_polygons else None
        SHADOW_UNION_CACHE[shadow_cache_key] = shadow_union

    edge_data = dict(graph.get_edge_data(u, v, k))
    edge_geom_wgs84 = route_service.edge_geometry_data(graph, u, v, edge_data)
    edge_geom_utm = transform(building_loader.project_to_utm, edge_geom_wgs84)
    shade_fraction = (
        shadow_calc.calculate_street_shade(edge_geom_utm, shadow_union)
        if shadow_union is not None and not shadow_union.is_empty
        else 0.0
    )
    return {
        "edge_id": edge_id,
        "shade_fraction": float(max(0.0, min(1.0, shade_fraction))),
        "time_of_day": hour,
        "day_of_year": day,
        "edge_length_m": float(edge_geom_utm.length),
    }


@app.get("/benchmark")
async def benchmark(iterations: int = Query(1000, ge=10, le=5000)) -> dict[str, Any]:
    if route_service is None or route_service.graph is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    results = route_service.benchmark(iterations=iterations)
    return {"iterations": iterations, **results}


@app.get("/profile/route")
async def profile_route() -> dict[str, Any]:
    if route_service is None or route_service.graph is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    nodes = list(route_service.graph.nodes())
    if len(nodes) < 2:
        raise HTTPException(status_code=500, detail="Insufficient graph nodes")
    start_node = nodes[0]
    end_node = nodes[-1]
    pr = cProfile.Profile()
    pr.enable()
    _ = route_service.route(
        start_lat=float(route_service.graph.nodes[start_node]["y"]),
        start_lon=float(route_service.graph.nodes[start_node]["x"]),
        end_lat=float(route_service.graph.nodes[end_node]["y"]),
        end_lon=float(route_service.graph.nodes[end_node]["x"]),
        shade_weight=0.7,
        day_of_year=180,
        departure_minutes=12 * 60,
        shadow_polygon_utm=None,
        building_loader=building_loader,
        shadow_calc=shadow_calc,
        time_aware=False,
    )
    pr.disable()
    stream = io.StringIO()
    pstats.Stats(pr, stream=stream).sort_stats("cumulative").print_stats(20)
    return {"top_profile": stream.getvalue()}


@app.post("/shade/precompute")
async def precompute_shade_index(day_of_year: int = Query(180, ge=0, le=365)) -> dict[str, Any]:
    if route_service.graph is None:
        raise HTTPException(status_code=503, detail="Routing graph unavailable")
    route_store.precompute_shade_index(
        route_service.graph,
        day_of_year=day_of_year,
        shadow_calc=shadow_calc,
        buildings_utm=ALL_BUILDINGS,
        building_loader=building_loader,
    )
    return {"status": "ok", "day_of_year": day_of_year}


@app.get("/sun")
async def get_sun_position(
    hour: float = Query(12.0, description="Hour of day (0-24)"),
    day: int = Query(180, description="Day of year (0-365)"),
    date: str | None = Query(None, description="YYYY-MM-DD in America/Phoenix"),
) -> dict[str, Any]:
    try:
        dt = campus_datetime(day, hour, date)
        window = day_sun_window(dt, shadow_calc)
        azimuth, elevation = shadow_calc.get_sun_position(dt)
        down = sun_is_down(hour, window)

        return {
            "datetime": dt.isoformat(),
            "azimuth": float(azimuth),
            "elevation": float(elevation),
            "is_daytime": not down,
            "sunrise": window["sunrise"],
            "sunset": window["sunset"],
            "source": window["source"],
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sun/day")
async def get_sun_day(
    date: str = Query(..., description="YYYY-MM-DD in America/Phoenix"),
) -> dict[str, Any]:
    try:
        year, month, day = (int(part) for part in date.split("-"))
        dt = TZ_PHOENIX.localize(datetime(year, month, day, 12))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD") from exc
    return day_sun_window(dt, shadow_calc)


@app.get("/buildings")
async def get_buildings(
    min_lat: float | None = None,
    max_lat: float | None = None,
    min_lon: float | None = None,
    max_lon: float | None = None
) -> dict[str, Any]:
    if not ALL_BUILDINGS:
        return {
            "type": "FeatureCollection",
            "features": [],
            "error": "No building data available. Run download_tempe_data.py"
        }
    
    if min_lat is not None and max_lat is not None and min_lon is not None and max_lon is not None:
        buildings = get_buildings_in_view(min_lat, max_lat, min_lon, max_lon)
    else:
        buildings = ALL_BUILDINGS[:1000]
    
    features = []
    for b in buildings:
        from shapely.ops import transform
        polygon_wgs84 = transform(building_loader.project_to_wgs84, b['polygon'])
        from shapely.geometry import mapping
        
        features.append({
            "type": "Feature",
            "geometry": mapping(polygon_wgs84),
            "properties": {
                "name": b['name'],
                "height": float(b['height']),
                "id": b.get('id', 0)
            }
        })
    
    return {
        "type": "FeatureCollection",
        "features": features
    }


@app.get("/shadows")
async def get_shadows(
    hour: float = Query(12.0, description="Hour of day (0-24)"),
    day: int = Query(180, description="Day of year (0-365)"),
    min_lat: float | None = None,
    max_lat: float | None = None,
    min_lon: float | None = None,
    max_lon: float | None = None
) -> dict[str, Any]:
    if not ALL_BUILDINGS:
        return {
            "type": "FeatureCollection",
            "features": [],
            "properties": {
                "time_of_day": float(hour),
                "day_of_year": int(day),
                "area_m2": 0.0,
                "shadow_count": 0,
                "building_count": 0,
                "is_daytime": False,
                "error": "No building data available",
            },
        }
    
    cache_key = f"{day}_{hour:.1f}"
    buildings: list[dict[str, Any]] = []
    
    view_min_lat = min_lat if min_lat is not None else 33.4120
    view_max_lat = max_lat if max_lat is not None else 33.4320
    view_min_lon = min_lon if min_lon is not None else -111.9420
    view_max_lon = max_lon if max_lon is not None else -111.9180
    
    bounds_key = (
        f"{view_min_lat:.4f}_{view_max_lat:.4f}_{view_min_lon:.4f}_{view_max_lon:.4f}"
    )
    full_cache_key = f"{cache_key}_{bounds_key}"
    
    if full_cache_key in SHADOW_CACHE:
        shadow_polygons = SHADOW_CACHE[full_cache_key]
        buildings = get_buildings_in_view(
            view_min_lat, view_max_lat, view_min_lon, view_max_lon
        )
    else:
        tz = pytz.timezone('America/Phoenix')
        year = 2024
        base_date = datetime(year, 1, 1, tzinfo=tz)
        dt = base_date + timedelta(days=day, hours=hour)
        
        buildings = get_buildings_in_view(
            view_min_lat, view_max_lat, view_min_lon, view_max_lon
        )
        
        shadow_polygons = shadow_calc.calculate_shadow_polygons(buildings, dt)
        SHADOW_CACHE[full_cache_key] = shadow_polygons

    combined_shadow = unary_union(shadow_polygons) if shadow_polygons else None
    SHADOW_UNION_CACHE[full_cache_key] = combined_shadow
    shade_parts = shade_polygons(shadow_polygons, buildings)
    features = []
    for idx, shadow in enumerate(shade_parts):
        shadow_wgs84 = transform(building_loader.project_to_wgs84, shadow)
        features.append(
            {
                "type": "Feature",
                "geometry": mapping(shadow_wgs84),
                "properties": {"shadow_id": idx},
            }
        )

    sun_dt = campus_datetime(day, hour)
    down, window = sun_down_for(day, hour)
    _, sun_elevation = shadow_calc.get_sun_position(sun_dt)
    is_daytime = not down
    result = {
        "type": "FeatureCollection",
        "features": features if is_daytime else [],
        "properties": {
            "time_of_day": float(hour),
            "day_of_year": int(day),
            "area_m2": float(
                combined_shadow.area
                if combined_shadow is not None and is_daytime
                else 0.0
            ),
            "shadow_count": len(shadow_polygons) if is_daytime else 0,
            "building_count": len(buildings),
            "is_daytime": is_daytime,
            "sun_elevation": float(sun_elevation),
            "sunrise": window["sunrise"],
            "sunset": window["sunset"],
            "sun_source": window["source"],
        }
    }
    
    return result


@app.post("/route", response_model=RouteResponse)
async def compute_route(request: RouteRequest) -> dict[str, Any]:
    try:
        if route_service is None or route_service.graph is None:
            raise HTTPException(
                status_code=503, 
                detail="Routing service not initialized."
            )

        dt = campus_datetime(request.day_of_year, request.time_of_day, request.calendar_date)
        sun_below_horizon, window = sun_down_for(
            request.day_of_year, request.time_of_day, request.calendar_date
        )
        sun_elevation = shadow_calc.get_sun_position(dt)[1]

        departure_minutes = int(request.time_of_day * 60)
        cache_key = route_cache.key(
            request.start.lat,
            request.start.lon,
            request.end.lat,
            request.end.lon,
            departure_minutes,
            request.optimize_for,
            request.shade_weight,
            int(request.day_of_year),
        )
        cached = route_cache.get(cache_key)
        if cached is not None:
            CACHE_HIT_RATE.labels(result="hit").inc()
            return cast(dict[str, Any], cached)
        CACHE_HIT_RATE.labels(result="miss").inc()

        combined_shadow = None
        if not sun_below_horizon:
            # Match /shadows 5-minute bucket so overlay warm-up can reuse work.
            hour_bucket = math.floor(request.time_of_day * 12) / 12
            padding = 0.01
            min_lat = min(request.start.lat, request.end.lat) - padding
            max_lat = max(request.start.lat, request.end.lat) + padding
            min_lon = min(request.start.lon, request.end.lon) - padding
            max_lon = max(request.start.lon, request.end.lon) + padding
            bounds_key = f"{min_lat:.4f}_{max_lat:.4f}_{min_lon:.4f}_{max_lon:.4f}"
            shadow_cache_key = f"{int(request.day_of_year)}_{hour_bucket:.1f}_{bounds_key}"
            combined_shadow = SHADOW_UNION_CACHE.get(shadow_cache_key)
            if combined_shadow is None:
                db_buildings = route_store.fetch_buildings_in_bbox(
                    min_lat, max_lat, min_lon, max_lon
                )
                route_buildings = []
                for row in db_buildings:
                    polygon_wgs84 = wkt_loads(row.geom_wkt)
                    polygon_utm = transform(building_loader.project_to_utm, polygon_wgs84)
                    route_buildings.append(
                        {
                            "polygon": polygon_utm,
                            "height": row.height,
                            "name": row.name,
                            "id": row.id,
                        }
                    )
                shadow_polygons = shadow_calc.calculate_shadow_polygons(route_buildings, dt)
                combined_shadow = (
                    unary_union(shadow_polygons) if shadow_polygons else None
                )
                SHADOW_CACHE[shadow_cache_key] = shadow_polygons
                SHADOW_UNION_CACHE[shadow_cache_key] = combined_shadow

        with tracer.start_as_current_span("route_pathfind_fastest"):
            fastest_result = route_service.route(
                request.start.lat,
                request.start.lon,
                request.end.lat,
                request.end.lon,
                shade_weight=0.0,
                day_of_year=int(request.day_of_year),
                departure_minutes=departure_minutes,
                shadow_polygon_utm=combined_shadow,
                building_loader=building_loader,
                shadow_calc=shadow_calc,
                time_aware=False,
            )
        if sun_below_horizon:
            # No cast shadows, so every edge is equally exposed. Reuse the
            # fastest path instead of a second search that can pick another street.
            shade_result = fastest_result
        else:
            with tracer.start_as_current_span("route_pathfind_shade"):
                shade_result = route_service.route(
                    request.start.lat,
                    request.start.lon,
                    request.end.lat,
                    request.end.lon,
                    shade_weight=request.shade_weight,
                    day_of_year=int(request.day_of_year),
                    departure_minutes=departure_minutes,
                    shadow_polygon_utm=combined_shadow,
                    building_loader=building_loader,
                    shadow_calc=shadow_calc,
                    time_aware=True,
                )

        route_result = shade_result if request.optimize_for == "shade" else fastest_result

        if not route_result:
            error_msg = (
                "Could not find a valid walking path between these locations. "
                "This may happen if:\n"
                "• Points are too far from walkable paths (>150m)\n"
                "• Points are inside buildings\n"
                "• No connected path exists in the street network\n\n"
                "Try selecting points closer to roads or pathways on campus."
            )
            raise HTTPException(status_code=404, detail=error_msg)

        def summarize_route(
            result_obj: RoutePathResult,
        ) -> tuple[list[RouteSegment], float, float, float]:
            segments_local: list[RouteSegment] = []
            total_shade_length_local = 0.0

            polyline_coordinates_local = result_obj.polyline_path

            for i in range(len(polyline_coordinates_local) - 1):
                lat1, lon1 = polyline_coordinates_local[i]
                lat2, lon2 = polyline_coordinates_local[i + 1]
                x1, y1 = building_loader.project_to_utm(lon1, lat1)
                x2, y2 = building_loader.project_to_utm(lon2, lat2)
                segment_line = LineString([(x1, y1), (x2, y2)])
                distance = segment_line.length
                shade_prob = 0.0
                if combined_shadow and not combined_shadow.is_empty:
                    shade_prob = shadow_calc.calculate_street_shade(segment_line, combined_shadow)
                    total_shade_length_local += distance * shade_prob

                orientation = math.degrees(math.atan2(lon2 - lon1, lat2 - lat1))
                if orientation < 0:
                    orientation += 360
                segments_local.append(
                    RouteSegment(
                        start=Location(lat=lat1, lon=lon1),
                        end=Location(lat=lat2, lon=lon2),
                        distance=float(distance),
                        shade_probability=float(shade_prob),
                        orientation=float(orientation),
                    )
                )
            total_distance_local = route_service.route_distance_m(polyline_coordinates_local)
            avg_shade_local = (
                (total_shade_length_local / total_distance_local)
                if total_distance_local > 0
                else 0.0
            )
            total_time_minutes_local = (total_distance_local / 1.4) / 60
            return segments_local, total_distance_local, avg_shade_local, total_time_minutes_local

        if fastest_result is None or shade_result is None:
            raise HTTPException(
                status_code=404,
                detail="Failed to compute both fastest and shade routes",
            )

        _, fastest_distance, fastest_shade, _ = summarize_route(fastest_result)
        fastest_segments, _, _, _ = summarize_route(fastest_result)
        _, shade_distance, shade_shade, _ = summarize_route(shade_result)
        logger.info(
            (
                "Route comparison: fastest_distance=%.2fm fastest_shade=%.2f%% | "
                "shade_route_distance=%.2fm shade_route_shade=%.2f%%"
            ),
            fastest_distance,
            fastest_shade * 100.0,
            shade_distance,
            shade_shade * 100.0,
        )

        segments, total_distance, avg_shade, total_time_minutes = summarize_route(route_result)
        path_coordinates_wgs84 = route_result.node_path
        polyline_coordinates_wgs84 = route_result.polyline_path

        response = RouteResponse(
            segments=segments,
            total_distance=float(total_distance),
            average_shade=float(avg_shade),
            total_time_minutes=float(total_time_minutes),
            path_coordinates=[[lat, lon] for lat, lon in path_coordinates_wgs84],
            polyline_coordinates=[[lng, lat] for lat, lng in polyline_coordinates_wgs84],
            edge_geometries=[
                [[lng, lat] for lng, lat in edge]
                for edge in route_result.edge_geometries_lnglat
            ],
            edge_ids=route_result.edge_ids,
            comparison={
                "fastest_distance": float(fastest_distance),
                "fastest_shade": float(fastest_shade),
                "shade_route_distance": float(shade_distance),
                "shade_route_shade": float(shade_shade),
                "sun_below_horizon": bool(sun_below_horizon),
                "sun_elevation": float(sun_elevation),
                "sunrise": window["sunrise"],
                "sunset": window["sunset"],
                "sun_source": window["source"],
            },
            fastest_segments=fastest_segments,
            fastest_polyline_coordinates=[
                [lng, lat] for lat, lng in fastest_result.polyline_path
            ],
        )
        ROUTE_DISTANCE.observe(float(total_distance))
        response_payload = response.model_dump()
        route_cache.set(cache_key, response_payload)

        return response_payload

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)