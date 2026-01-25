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
                    y_rot = x * np.sin(angle_rad) + y * np.cos(angle_rad)
                    rotated_corners.append((
                        center_x + x_rot,
                        center_y + y_rot
                    ))
                
                polygon = Polygon(rotated_corners)
                
                # Random height (10-30m, about 3-10 stories)
                height = np.random.uniform(10, 30)
                
                buildings.append({
                    'polygon': polygon,
                    'height': height,
                    'name': f'Building {building_id}',
                    'id': building_id
                })
                
                building_id += 1
        
        print(f"Created {len(buildings)} synthetic buildings")
        return buildings
    
    def load_from_geojson(self, filepath: str) -> List[Dict]:
        """
        Load building data from GeoJSON file.
        
        Args:
            filepath: Path to GeoJSON file
            
        Returns:
            List of building dicts
        """
        buildings = []
        
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            
            for feature in data['features']:
                # Get geometry
                geom = shape(feature['geometry'])
                
                # Convert to UTM
                geom_utm = transform(self.project_to_utm, geom)
                
                # Get height
                props = feature.get('properties', {})
                height = props.get('height', props.get('building:levels', 3) * 3)
                
                buildings.append({
                    'polygon': geom_utm,
                    'height': float(height),
                    'name': props.get('name', 'Unknown'),
                    'id': props.get('id', len(buildings))
                })
            
            print(f"Loaded {len(buildings)} buildings from {filepath}")
            return buildings
            
        except FileNotFoundError:
            print(f"File not found: {filepath}")
            return []
        except Exception as e:
            print(f"Error loading GeoJSON: {e}")
            return []
    
    def save_to_geojson(self, buildings: List[Dict], filepath: str):
        """
        Save buildings to GeoJSON file (in WGS84).
        
        Args:
            buildings: List of building dicts
            filepath: Output filepath
        """
        features = []
        
        for building in buildings:
            # Convert polygon back to WGS84
            polygon_wgs84 = transform(self.project_to_wgs84, building['polygon'])
            
            feature = {
                'type': 'Feature',
                'geometry': mapping(polygon_wgs84),
                'properties': {
                    'height': building['height'],
                    'name': building['name'],
                    'id': building.get('id', 0)
                }
            }
            features.append(feature)
        
        geojson = {
            'type': 'FeatureCollection',
            'features': features
        }
        
        Path(filepath).parent.mkdir(parents=True, exist_ok=True)
        
        with open(filepath, 'w') as f:
            json.dump(geojson, f, indent=2)
        
        print(f"Saved {len(buildings)} buildings to {filepath}")
    
    def get_buildings_in_bounds(
        self,
        buildings: List[Dict],
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float
    ) -> List[Dict]:
        """
        Filter buildings within bounding box.
        
        Args:
            buildings: List of buildings
            min_lat, max_lat, min_lon, max_lon: Bounding box in WGS84
            
        Returns:
            Filtered list of buildings
        """
        # Convert bounds to UTM
        min_x, min_y = self.project_to_utm(min_lon, min_lat)
        max_x, max_y = self.project_to_utm(max_lon, max_lat)
        
        bbox = Polygon([
            (min_x, min_y),
            (max_x, min_y),
            (max_x, max_y),
            (min_x, max_y)
        ])
        
        filtered = []
        for building in buildings:
            if building['polygon'].intersects(bbox):
                filtered.append(building)
        
        return filtered


# Test and example usage
if __name__ == "__main__":
    print("Building Data Loader Test\n" + "="*50)
    
    loader = BuildingDataLoader()
    
    # Create synthetic buildings
    buildings = loader.create_synthetic_buildings(count=25)
    
    print(f"\nSample building:")
    b = buildings[0]
    print(f"  Name: {b['name']}")
    print(f"  Height: {b['height']:.1f}m")
    print(f"  Area: {b['polygon'].area:.0f}m┬▓")
    
    # Save to file
    output_file = "data/buildings/asu_buildings_synthetic.geojson"
    loader.save_to_geojson(buildings, output_file)
    
    # Try loading back
    loaded = loader.load_from_geojson(output_file)
    print(f"\nLoaded {len(loaded)} buildings from file")
    
    # Test bounds filtering
    filtered = loader.get_buildings_in_bounds(
        buildings,
        min_lat=33.420,
        max_lat=33.428,
        min_lon=-111.935,
        max_lon=-111.925
    )
    print(f"Buildings in filtered bounds: {len(filtered)}")
    
    print("\nΓ£à Building data loader working correctly!")
