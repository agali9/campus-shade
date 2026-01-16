"""Campus graph structure and data."""

import numpy as np
from typing import Dict, List, Tuple, Set
import math

class CampusGraph:
    """
    Represents the campus as a graph for routing.
    Nodes are locations, edges are walkable paths.
    Improved to avoid buildings and follow realistic pathways.
    """
    
    def __init__(self):
        """Initialize campus graph with improved pathways."""
        np.random.seed(42)
        self.nodes = self._create_campus_nodes()
        self.buildings = self._create_buildings()
        self.edges = self._create_campus_edges()
        self.spatial_data = self._create_spatial_data()
    
    def _create_campus_nodes(self) -> Dict[int, Tuple[float, float]]:
        """Create campus node locations with higher density for better routing."""
        nodes = {}
        node_id = 0
        
        # Create 15x15 grid for finer pathways
        center_lat, center_lon = 33.4242, -111.9281
        grid_size = 15
        spacing = 0.0015  # Roughly 150m for better resolution
        
        for i in range(grid_size):
            for j in range(grid_size):
                lat = center_lat + (i - grid_size/2) * spacing
                lon = center_lon + (j - grid_size/2) * spacing
                nodes[node_id] = (lat, lon)
                node_id += 1
        
        return nodes
    
    def _create_buildings(self) -> List[Tuple[float, float, float]]:
        """Define building locations (lat, lon, radius) to avoid."""
        center_lat, center_lon = 33.4242, -111.9281
        spacing = 0.0015
        
        buildings = []
        # Create some building obstacles
        building_positions = [
            (5, 5), (5, 9), (5, 13),
            (8, 3), (8, 7), (8, 11),
            (11, 5), (11, 9), (11, 13),
        ]
        
        for i, j in building_positions:
            lat = center_lat + (i - 7.5) * spacing
            lon = center_lon + (j - 7.5) * spacing
            radius = 0.0003  # Building footprint radius
            buildings.append((lat, lon, radius))
        
        return buildings
    
    def _is_path_blocked(self, lat1: float, lon1: float, lat2: float, lon2: float) -> bool:
        """Check if path between two points goes through a building."""
        # Simple line-circle intersection check
        for b_lat, b_lon, b_radius in self.buildings:
            # Check if line segment intersects with building circle
            # Use midpoint approximation for simplicity
            mid_lat = (lat1 + lat2) / 2
            mid_lon = (lon1 + lon2) / 2
            
            dist_to_building = math.sqrt((mid_lat - b_lat)**2 + (mid_lon - b_lon)**2)
            if dist_to_building < b_radius:
                return True
        
        return False
    
    def _create_campus_edges(self) -> List[Tuple[int, int]]:
        """Create edges that follow pathways and avoid buildings."""
        edges = []

# TODO: finish osm graph helpers
