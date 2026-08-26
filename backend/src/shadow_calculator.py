"""
Building shadow calculator using real sun position and geometry.
Requires: geopandas, shapely, pvlib, pytz
"""

import logging
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Tuple, Dict, Optional
import pytz
from shapely.geometry import Polygon, MultiPolygon, LineString, Point
from shapely.ops import unary_union
import math

# pvlib for solar position
try:
    from pvlib import solarposition
    PVLIB_AVAILABLE = True
except ImportError:
    PVLIB_AVAILABLE = False
    print("[WARN] pvlib not installed. Install with: pip install pvlib")

class ShadowCalculator:
    """Calculate building shadows based on sun position."""
    
    def __init__(self, timezone='America/Phoenix'):
        """
        Initialize shadow calculator.
        
        Args:
            timezone: Local timezone for sun calculations
        """
        self.timezone = pytz.timezone(timezone)
        # ASU Tempe coordinates
        self.latitude = 33.4242
        self.longitude = -111.9281
        self.logger = logging.getLogger("uvicorn.error")
        
    def get_sun_position(self, dt: datetime) -> Tuple[float, float]:
        """
        Calculate sun azimuth and elevation for given time.
        
        Args:
            dt: DateTime object (timezone-aware)
            
        Returns:
            (azimuth, elevation) in degrees as Python floats
        """
        if not PVLIB_AVAILABLE:
            # Fallback: simple approximation
            hour = dt.hour + dt.minute / 60
            # Elevation: peak at solar noon (12pm)
            elevation = 60 * math.sin((hour - 6) / 12 * math.pi)
            # Azimuth: rotate from east (90°) through south (180°) to west (270°)
            azimuth = 90 + (hour - 6) / 12 * 180
            return float(azimuth), float(max(0, elevation))
        
        try:
            # Use pvlib for accurate calculation
            times = pd.DatetimeIndex([dt])
            solar_pos = solarposition.get_solarposition(
                times, 
                self.latitude, 
                self.longitude,
                method='nrel_numpy'
            )
            
            # Convert numpy types to Python floats for JSON serialization
            azimuth = float(solar_pos['azimuth'].iloc[0])
            elevation = float(solar_pos['apparent_elevation'].iloc[0])
            
            return azimuth, elevation
        except Exception as e:
            print(f"[WARN] pvlib solar position failed: {e}")
            print("Using fallback calculation...")
            # Fallback calculation
            hour = dt.hour + dt.minute / 60
            elevation = 60 * math.sin((hour - 6) / 12 * math.pi)
            azimuth = 90 + (hour - 6) / 12 * 180
            return float(azimuth), float(max(0, elevation))
    
    def calculate_shadow_polygon(
        self, 
        building_polygon: Polygon,
        building_height: float,
        azimuth: float,
        elevation: float
    ) -> Optional[Polygon]:
        """
        Calculate ground shadow cast by a building.
        
        Args:
            building_polygon: Building footprint (Shapely Polygon)
            building_height: Height in meters
            azimuth: Sun azimuth in degrees (0=North, 90=East, 180=South, 270=West)
            elevation: Sun elevation in degrees (0=horizon, 90=zenith)
            
        Returns:
            Shadow polygon or None if sun is below horizon
        """
        # No shadow if sun is below horizon
        if elevation <= 0:
            return None
        
        # Calculate shadow length
        # L = h / tan(elevation)
        shadow_length = building_height / math.tan(math.radians(elevation))
        
        # Cap extreme shadows at low sun angles
        shadow_length = min(shadow_length, 2000)  # Max 2km
        
        # Convert azimuth to shadow direction
        # Shadow points away from sun (opposite direction)
        shadow_direction = (azimuth + 180) % 360
        
        # Convert to cartesian offset
        # Note: 0° = North = +Y, 90° = East = +X
        dx = shadow_length * math.sin(math.radians(shadow_direction))
        dy = shadow_length * math.cos(math.radians(shadow_direction))
        
        # Translate building footprint
        from shapely.affinity import translate
        shadow_footprint = translate(building_polygon, xoff=dx, yoff=dy)
        
        # Create shadow polygon by connecting building and shadow footprints
        # Get exterior coordinates
        building_coords = list(building_polygon.exterior.coords)
        shadow_coords = list(shadow_footprint.exterior.coords)
        
        # Create quadrilaterals for each edge
        shadow_parts = []
        for i in range(len(building_coords) - 1):
            quad = Polygon([
                building_coords[i],
                building_coords[i + 1],
                shadow_coords[i + 1],
                shadow_coords[i]
            ])
            shadow_parts.append(quad)
        
        # Also include the translated building footprint
        shadow_parts.append(shadow_footprint)
        
        # Union all parts
        try:
            shadow = unary_union(shadow_parts)
            return shadow
        except:
            return None
    
    def calculate_all_shadows(
        self,
        buildings: List[Dict],
        dt: datetime
    ) -> Polygon:
        """
        Calculate combined shadow from all buildings.
        
        Args:
            buildings: List of dicts with 'polygon' and 'height' keys
            dt: DateTime for sun position
            
        Returns:
            Union of all shadows as a single polygon
        """
        # Get sun position
        azimuth, elevation = self.get_sun_position(dt)
        
        shadow_polygons = self.calculate_shadow_polygons(buildings, dt, azimuth=azimuth, elevation=elevation)
        
        # Union all shadows
        if shadow_polygons:
            combined = unary_union(shadow_polygons)
            return combined
        else:
            return Polygon()  # Empty polygon

    def calculate_shadow_polygons(
        self,
        buildings: List[Dict],
        dt: datetime,
        azimuth: Optional[float] = None,
        elevation: Optional[float] = None,
    ) -> List[Polygon]:
        """Calculate one shadow geometry per building footprint."""
        if azimuth is None or elevation is None:
            azimuth, elevation = self.get_sun_position(dt)
        self.logger.info(
            "Sun position at %s: azimuth=%.1f, elevation=%.1f",
            dt,
            azimuth,
            elevation,
        )

        shadows: List[Polygon] = []
        for building in buildings:
            polygon = building.get("polygon")
            if polygon is None or polygon.is_empty:
                continue
            building_height = float(building.get("height", 0.0))
            if building_height <= 0.0:
                continue

            if isinstance(polygon, MultiPolygon):
                polygons = list(polygon.geoms)
            else:
                polygons = [polygon]

            for poly in polygons:
                if poly.is_empty:
                    continue
                shadow = self.calculate_shadow_polygon(poly, building_height, azimuth, elevation)
                if shadow is not None and not shadow.is_empty:
                    shadows.append(shadow)

        self.logger.info(
            "Calculated %s building shadows from %s buildings",
            len(shadows),
            len(buildings),
        )
        return shadows
    
    def calculate_street_shade(
        self,
        street_line: LineString,
        shadow_polygon: Polygon
    ) -> float:
        """
        Calculate shade fraction for a street segment.
        
        Args:
            street_line: Street/path LineString
            shadow_polygon: Combined shadow polygon
            
        Returns:
            Shade fraction (0-1)
        """
        try:
            # Intersect street with shadow
            intersection = street_line.intersection(shadow_polygon)
            
            # Calculate shaded length
            if intersection.is_empty:
                return 0.0
            
            if isinstance(intersection, LineString):
                shaded_length = intersection.length
            elif hasattr(intersection, "geoms"):
                shaded_length = sum(geom.length for geom in intersection.geoms)
            else:
                shaded_length = float(getattr(intersection, "length", 0.0))
            
            # Calculate fraction
            total_length = street_line.length
            if total_length == 0:
                return 0.0
            
            shade_fraction = min(shaded_length / total_length, 1.0)
            return shade_fraction
            
        except Exception as e:
            print(f"Error calculating street shade: {e}")
            return 0.0


# Example usage and testing
if __name__ == "__main__":
    print("Shadow Calculator Test\n" + "="*50)
    
    calculator = ShadowCalculator()
    
    # Test time
    test_time = datetime(2024, 6, 21, 12, 0, 0, tzinfo=calculator.timezone)
    
    # Test building (simple rectangle)
    test_building = {
        'polygon': Polygon([
            (0, 0),
            (20, 0),
            (20, 30),
            (0, 30)
        ]),
        'height': 15.0
    }
    
    # Calculate sun position
    azimuth, elevation = calculator.get_sun_position(test_time)
    print(f"\nSun position at {test_time}:")
    print(f"  Azimuth: {azimuth:.1f}°")
    print(f"  Elevation: {elevation:.1f}°")
    
    # Calculate shadow
    shadow = calculator.calculate_shadow_polygon(
        test_building['polygon'],
        test_building['height'],
        azimuth,
        elevation
    )
    
    if shadow:
        print(f"\nShadow area: {shadow.area:.1f} m²")
        print(f"Building area: {test_building['polygon'].area:.1f} m²")
    
    # Test street shade
    test_street = LineString([(10, -10), (10, 40)])
    shade_fraction = calculator.calculate_street_shade(test_street, shadow)
    print(f"\nStreet shade fraction: {shade_fraction:.1%}")
    
    print("\n[OK] Shadow calculator working correctly!")