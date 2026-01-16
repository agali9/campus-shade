"""A* routing algorithm with shade optimization."""

import heapq
import math
from typing import List, Tuple, Optional
from graph import CampusGraph

class ShadeAwareRouter:
    """
    A* routing algorithm that optimizes for both distance and shade.
    """
    
    def __init__(self, graph: CampusGraph, ml_predictor):
        """
        Initialize router.
        
        Args:
            graph: Campus graph structure
            ml_predictor: ML model predictor for shade inference
        """
        self.graph = graph
        self.ml_predictor = ml_predictor
    
    def compute_route(
        self,
        start_lat: float,
        start_lon: float,
        end_lat: float,
        end_lon: float,
        time_of_day: float,
        day_of_year: float,
        shade_weight: float = 0.7
    ) -> Optional[List[int]]:
        """
        Compute optimal route using A* algorithm.
        
        Args:
            start_lat, start_lon: Start coordinates
            end_lat, end_lon: End coordinates
            time_of_day: Hour of day (0-24)
            day_of_year: Day of year (0-365)
            shade_weight: Weight for shade vs distance (0-1)
                         0 = optimize for speed only
                         1 = optimize for shade only
        
        Returns:
            List of node IDs representing the path
        """
        # Find nearest nodes
        start_node = self.graph.find_nearest_node(start_lat, start_lon)
        end_node = self.graph.find_nearest_node(end_lat, end_lon)
        
        # A* algorithm
        open_set = [(0, start_node)]
        came_from = {}
        g_score = {start_node: 0}
        f_score = {start_node: self._heuristic(start_node, end_node)}
        
        while open_set:
            current_f, current = heapq.heappop(open_set)
            
            if current == end_node:
                return self._reconstruct_path(came_from, current)
            
            for neighbor in self.graph.get_neighbors(current):
                # Calculate edge cost
                distance = self.graph.distance(current, neighbor)
                
                # Get shade prediction
                edge_data = self.graph.get_edge_data(current, neighbor)
                if edge_data:
                    shade_prob = self.ml_predictor.predict(
                        time_of_day=time_of_day,
                        day_of_year=day_of_year,
                        orientation=edge_data['orientation'],
                        tree_density=edge_data['tree_density'],
                        building_proximity=edge_data['building_proximity'],
                        latitude=0.5  # Normalized
                    )
                else:
                    shade_prob = 0.2  # Default
