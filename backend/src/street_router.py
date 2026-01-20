"""
Street-based routing that avoids buildings and uses actual pathways.
This creates a walkable street network for campus routing.
"""

import numpy as np
from typing import List, Tuple, Dict, Optional
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
import heapq
import math


class StreetRouter:
    """
    Creates and uses a street network for routing.
    Avoids buildings and follows realistic pathways.
    """
    
    def __init__(self, buildings: List[Dict]):
        """
        Initialize router with building data.
        
        Args:
            buildings: List of building dicts with 'polygon' and 'height'
        """
        self.buildings = buildings
        self.building_union = None
        if buildings:
            self.building_union = unary_union([b['polygon'] for b in buildings])
        
        # Create street network
        self.nodes, self.edges = self._create_street_network()
        print(f"Created street network: {len(self.nodes)} nodes, {len(self.edges)} edges")
    
    def _create_street_network(self) -> Tuple[Dict, List]:
        """
        Create a street network grid that avoids buildings.
        Returns nodes and edges for pathfinding.
        """
        # Campus bounds in UTM
        min_x, min_y = 397500, 3701500
        max_x, max_y = 400000, 3704000
        
        # Create grid with 50m spacing
        spacing = 50
        x_range = np.arange(min_x, max_x, spacing)
        y_range = np.arange(min_y, max_y, spacing)
        
        nodes = {}
        node_id = 0
        
        # Create nodes, avoiding building centers
        for x in x_range:
            for y in y_range:
                point = Point(x, y)
                
                # Skip if inside a building
                if self.building_union and self.building_union.contains(point):
                    continue
                
                nodes[node_id] = (x, y)
                node_id += 1
        
        # Create edges between nearby nodes
        edges = []
        node_list = list(nodes.items())
        
        for i, (id1, (x1, y1)) in enumerate(node_list):
            for id2, (x2, y2) in node_list[i+1:]:
                # Only connect nearby nodes
                dist = math.sqrt((x2-x1)**2 + (y2-y1)**2)
                if dist > spacing * 1.5:  # Max 1.5x spacing
                    continue
                
                # Check if line crosses buildings
                line = LineString([(x1, y1), (x2, y2)])
                
                if self.building_union:
                    # Buffer line slightly to avoid edge cases
                    if self.building_union.intersects(line.buffer(5)):
                        continue
                
                edges.append((id1, id2, dist))
        
        return nodes, edges
    
    def find_nearest_node(self, x: float, y: float) -> Optional[int]:
        """Find nearest street network node to a point."""
        if not self.nodes:
            return None
        
        min_dist = float('inf')
        nearest = None
        
        for node_id, (nx, ny) in self.nodes.items():
            dist = math.sqrt((x - nx)**2 + (y - ny)**2)
            if dist < min_dist:
                min_dist = dist
                nearest = node_id
        
        return nearest
    
    def compute_path(
        self,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        shadow_calc=None,
        shade_weight: float = 0.0
    ) -> Optional[List[Tuple[float, float]]]:
        """
        Compute path using A* algorithm.
        
        Args:
            start_x, start_y: Start coordinates in UTM
            end_x, end_y: End coordinates in UTM
            shadow_calc: Optional shadow calculator for shade-aware routing
            shade_weight: Weight for shade (0-1), 0 = ignore shade
            
        Returns:
            List of (x, y) coordinates forming the path
        """
        # Find nearest nodes
        start_node = self.find_nearest_node(start_x, start_y)
        end_node = self.find_nearest_node(end_x, end_y)
