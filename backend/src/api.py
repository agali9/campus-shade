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

# routing endpoints WIP
