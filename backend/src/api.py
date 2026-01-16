"""FastAPI application and endpoints."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import RouteRequest, RouteResponse, RouteSegment, Location
from graph import CampusGraph
from routing import ShadeAwareRouter
import sys
import os

# Add ML module to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'ml', 'src'))
from inference import get_predictor

app = FastAPI(title="Shade-Optimized Route Planner API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize components
campus_graph = CampusGraph()
ml_predictor = get_predictor()
router = ShadeAwareRouter(campus_graph, ml_predictor)

@app.get("/")
async def root():
    """API health check."""
    return {"status": "ok", "service": "Shade-Optimized Route Planner"}

@app.get("/campus/bounds")
async def get_campus_bounds():
    """Get campus geographic bounds for map initialization."""
    lats = [lat for lat, lon in campus_graph.nodes.values()]
    lons = [lon for lat, lon in campus_graph.nodes.values()]
    
    return {
        "min_lat": min(lats),
        "max_lat": max(lats),
        "min_lon": min(lons),
        "max_lon": max(lons),
        "center": {
            "lat": sum(lats) / len(lats),
            "lon": sum(lons) / len(lons)
        }
    }

@app.post("/route", response_model=RouteResponse)
async def compute_route(request: RouteRequest):
    """
    Compute optimal route between two locations.
    """
    # Determine shade weight based on optimization preference
    if request.optimize_for == "speed":
        shade_weight = 0.0
    else:
        shade_weight = request.shade_weight
    
    # Compute route
    path = router.compute_route(
        start_lat=request.start.lat,
        start_lon=request.start.lon,
        end_lat=request.end.lat,
        end_lon=request.end.lon,
        time_of_day=request.time_of_day,
        day_of_year=request.day_of_year,
        shade_weight=shade_weight
    )
    
    if not path:
        raise HTTPException(status_code=404, detail="No route found")
    
    # Build response
    segments = []
    total_distance = 0.0
    total_shade = 0.0
    path_coordinates = []
    
    for i in range(len(path) - 1):
        node1, node2 = path[i], path[i+1]
        
        lat1, lon1 = campus_graph.nodes[node1]
        lat2, lon2 = campus_graph.nodes[node2]
        
        distance = campus_graph.distance(node1, node2)
        edge_data = campus_graph.get_edge_data(node1, node2)
        
        # Get shade prediction
        shade_prob = ml_predictor.predict(
            time_of_day=request.time_of_day,
            day_of_year=request.day_of_year,
            orientation=edge_data['orientation'],
            tree_density=edge_data['tree_density'],
            building_proximity=edge_data['building_proximity'],
            latitude=0.5
        )
        
        segments.append(RouteSegment(
            start=Location(lat=lat1, lon=lon1),
            end=Location(lat=lat2, lon=lon2),
            distance=distance,
            shade_probability=shade_prob,
            orientation=edge_data['orientation']
        ))
        
        total_distance += distance
        total_shade += shade_prob
