"""
Load and process ASU building data for shadow calculations.
Supports OpenStreetMap data and creates synthetic buildings if needed.
"""

import json
import numpy as np
from pathlib import Path
from typing import List, Dict, Tuple
from shapely.geometry import Polygon, shape, mapping
from shapely.ops import transform
import pyproj

class BuildingDataLoader:
    """Load and process building footprints for ASU campus."""
    
    def __init__(self):
        """Initialize building data loader."""
        # ASU Tempe campus bounds (lat/lon)
        self.bounds = {
            'min_lat': 33.4120,
            'max_lat': 33.4320,
            'min_lon': -111.9420,
            'max_lon': -111.9180
        }
        
        # Coordinate transformations
        # WGS84 (lat/lon) to UTM Zone 12N (meters)
        self.wgs84 = pyproj.CRS('EPSG:4326')
        self.utm = pyproj.CRS('EPSG:32612')
        
        self.project_to_utm = pyproj.Transformer.from_crs(
            self.wgs84, self.utm, always_xy=True
        ).transform
        
        self.project_to_wgs84 = pyproj.Transformer.from_crs(
            self.utm, self.wgs84, always_xy=True
        ).transform
    
    def create_synthetic_buildings(self, count: int = 20) -> List[Dict]:
        """
        Create synthetic building data for testing.
        Distributes buildings across ASU campus.
        
        Args:
            count: Number of buildings to create
            
        Returns:
            List of building dicts with 'polygon', 'height', 'name'
        """
        np.random.seed(42)
        
        buildings = []
        
        # Convert bounds to UTM
        min_x, min_y = self.project_to_utm(self.bounds['min_lon'], self.bounds['min_lat'])
        max_x, max_y = self.project_to_utm(self.bounds['max_lon'], self.bounds['max_lat'])
        
        # Create grid of buildings
        grid_size = int(np.sqrt(count))
        x_step = (max_x - min_x) / (grid_size + 1)
        y_step = (max_y - min_y) / (grid_size + 1)
        
        building_id = 1
        for i in range(grid_size):
            for j in range(grid_size):
                if building_id > count:
                    break
                
                # Center position
                center_x = min_x + (i + 1) * x_step
                center_y = min_y + (j + 1) * y_step
                
                # Random building size (20-50m)
                width = np.random.uniform(20, 50)
                length = np.random.uniform(20, 50)
                
                # Random rotation
                angle = np.random.uniform(0, 90)
                angle_rad = np.radians(angle)
                
                # Create rectangle
                corners = [
                    (-width/2, -length/2),
                    (width/2, -length/2),
                    (width/2, length/2),
                    (-width/2, length/2)
                ]
                
                # Rotate and translate
                rotated_corners = []
                for x, y in corners:
                    x_rot = x * np.cos(angle_rad) - y * np.sin(angle_rad)

# load geojson next
