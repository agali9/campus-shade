from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
import pytz
import os
import logging
import cProfile
import io
import pstats
from pathlib import Path

try:
    from .shadow_calculator import ShadowCalculator
    from .building_data_loader import BuildingDataLoader
    from .database import DATABASE_URL, check_database_connection
    from .models import Location, RouteRequest, RouteResponse, RouteSegment
    from .routing import DBRouteService, RouteDataStore
    from .cache import RouteCache
    from .observability import (
        CACHE_HIT_RATE,
        ROUTE_DISTANCE,
        metrics_endpoint,
        request_middleware,
        setup_logging,
        setup_tracing,
        tracer,
    )
except ImportError:
    import sys
    sys.path.append(str(Path(__file__).parent))
    from shadow_calculator import ShadowCalculator
    from building_data_loader import BuildingDataLoader
    from database import DATABASE_URL, check_database_connection
    from models import Location, RouteRequest, RouteResponse, RouteSegment
    from routing import DBRouteService, RouteDataStore
    from cache import RouteCache
    from observability import (
        CACHE_HIT_RATE,
        ROUTE_DISTANCE,
        metrics_endpoint,
        request_middleware,
        setup_logging,
        setup_tracing,
        tracer,
    )
from shapely.geometry import LineString, box, mapping
from shapely.ops import transform, unary_union
from shapely.wkt import loads as wkt_loads
import math

app = FastAPI(title="Shadow-Aware Route Planner API")
setup_logging()
setup_tracing()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

shadow_calc = ShadowCalculator()
building_loader = BuildingDataLoader()

BUILDINGS_FILE = Path("data/buildings/asu_campus_only.geojson")
ALL_BUILDINGS = []
street_router = None
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

BUILDING_INDEX = None

def create_building_index(buildings):
    index = {}
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
        ALL_BUILDINGS = route_store.load_or_seed_buildings(building_loader, BUILDINGS_FILE)
        BUILDING_INDEX = create_building_index(ALL_BUILDINGS) if ALL_BUILDINGS else None
    except Exception as e:
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

    graph = route_store.load_or_build_osm_graph(
        north=north,
        south=south,
        east=east,
        west=west,
        building_count=building_count,
    )
    route_service.set_graph(graph)
    street_router = True


if os.getenv("SKIP_DATA_LOADING") != "1":
    initialize_spatial_data()
    initialize_route_datastore()
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

SHADOW_CACHE: Dict[str, Any] = {}
SHADOW_UNION_CACHE: Dict[str, Any] = {}
app.middleware("http")(request_middleware)


def get_buildings_in_view(min_lat: float, max_lat: float, min_lon: float, max_lon: float):
    if not BUILDING_INDEX:
        return []
    
    min_x, min_y = building_loader.project_to_utm(min_lon, min_lat)
    max_x, max_y = building_loader.project_to_utm(max_lon, max_lat)
    
    view_box = box(min_x, min_y, max_x, max_y)
    
    buildings_in_view = []
    for idx, data in BUILDING_INDEX.items():
        b_minx, b_miny, b_maxx, b_maxy = data['bounds']
        if not (b_maxx < min_x or b_minx > max_x or b_maxy < min_y or b_miny > max_y):
            buildings_in_view.append(data['building'])
    
    return buildings_in_view


@app.get("/")
async def root():
    return {
        "status": "ok", 
        "service": "Shadow-Aware Route Planner",
        "buildings_loaded": len(ALL_BUILDINGS),
        "street_network_ready": street_router is not None and route_service is not None,
        "route_data_source": "postgresql" if DATABASE_URL.startswith("postgresql") else "sqlite",
        "endpoints": {
            "/route": "Compute shadow-optimized route",
            "/shadows": "Get shadow polygons for a time",
            "/buildings": "Get building data",
            "/sun": "Get sun position"
        }
    }


@app.get("/campus/bounds")
async def get_campus_bounds():
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
async def get_database_health():
    is_connected = check_database_connection()
    return {
        "configured": bool(DATABASE_URL),
        "connected": is_connected,
        "database_url_present": bool(DATABASE_URL),
    }

@app.get("/metrics")
async def metrics():
    return await metrics_endpoint()


@app.get("/debug/snap")
async def debug_snap(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
    mode: str = Query("after", description="Use 'before' to disable edge fallback"),
):
    if route_service is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    return route_service.debug_snap(lat=lat, lon=lng, mode=mode)


@app.get("/debug/nodes")
async def debug_nodes():
    if route_service is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    return route_service.debug_nodes_geojson()


@app.get("/debug/graph")
async def debug_graph():
    if route_service is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    return route_service.debug_graph_geojson()


@app.get("/debug/shadows")
async def debug_shadows(
    hour: float = Query(12.0, description="Hour of day (0-24)"),
    day: int = Query(180, description="Day of year (0-365)"),
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
):
    return await get_shadows(hour=hour, day=day, min_lat=min_lat, max_lat=max_lat, min_lon=min_lon, max_lon=max_lon)


@app.get("/debug/edge_shade")
async def debug_edge_shade(
    edge_id: str = Query(..., description="Edge id in format u|v|k"),
    hour: float = Query(12.0, description="Hour of day (0-24)"),
    day: int = Query(172, description="Day of year (0-365)"),
):
    if route_service is None or route_service.graph is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    def _coerce_node(node_val: str):
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
async def benchmark(iterations: int = Query(1000, ge=10, le=5000)):
    if route_service is None:
        raise HTTPException(status_code=503, detail="Routing service not initialized.")
    results = route_service.benchmark(iterations=iterations)
    return {"iterations": iterations, **results}


@app.get("/profile/route")
async def profile_route():
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
async def precompute_shade_index(day_of_year: int = Query(180, ge=0, le=365)):
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
    day: int = Query(180, description="Day of year (0-365)")
):
    try:
        tz = pytz.timezone('America/Phoenix')
        year = 2024
        base_date = datetime(year, 1, 1, tzinfo=tz)
        dt = base_date + timedelta(days=day, hours=hour)
        
        azimuth, elevation = shadow_calc.get_sun_position(dt)
        
        return {
            "datetime": dt.isoformat(),
            "azimuth": float(azimuth),
            "elevation": float(elevation),
            "is_daytime": bool(elevation > 0)
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/buildings")
async def get_buildings(
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None
):
    if not ALL_BUILDINGS:
        return {
            "type": "FeatureCollection",
            "features": [],
            "error": "No building data available. Run download_tempe_data.py"
        }
    
    if all(v is not None for v in [min_lat, max_lat, min_lon, max_lon]):
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
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None
):
    if not ALL_BUILDINGS:
        from shapely.geometry import Polygon as ShapelyPolygon
        empty_poly = ShapelyPolygon()
        return {
            "type": "Feature",
            "geometry": {
