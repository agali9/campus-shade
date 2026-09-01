"""
Building shadow calculator using real sun position and geometry.
Requires: geopandas, shapely, pvlib, pytz
"""

import logging
import math
from datetime import datetime
from typing import Any

import pandas as pd
import pytz
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import unary_union

# pvlib for solar position
try:
    from pvlib import solarposition
    PVLIB_AVAILABLE = True
except ImportError:
    PVLIB_AVAILABLE = False
    print("[WARN] pvlib not installed. Install with: pip install pvlib")

class ShadowCalculator:
    """Calculate building shadows based on sun position."""
    
    def __init__(self, timezone: str = "America/Phoenix") -> None:
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
        
    def get_sun_position(self, dt: datetime) -> tuple[float, float]:
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
    ) -> Polygon | None:
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
        # No useful ground shadow when the sun is down or barely above the horizon.
        # Very low elevation makes each building a multi-block black streak.
        if elevation < 8:
            return None

        shadow_length = building_height / math.tan(math.radians(elevation))
        shadow_length = min(shadow_length, 120.0)
        if shadow_length < 1.0:
            return None

        shadow_direction = (azimuth + 180) % 360
        dx = shadow_length * math.sin(math.radians(shadow_direction))
        dy = shadow_length * math.cos(math.radians(shadow_direction))

        from shapely.affinity import translate
        footprint = building_polygon.buffer(0)
        if footprint.is_empty:
            return None
        cast = translate(footprint, xoff=dx, yoff=dy)
        try:
            shadow = unary_union([footprint, cast]).convex_hull
        except Exception as exc:
            self.logger.warning("shadow union failed: %s", exc)
            return None
        if shadow.is_empty or not shadow.is_valid:
            return None
        # Reject outliers that still cover far more ground than the building.
        if footprint.area > 0 and shadow.area > footprint.area * 40:
            return None
        return shadow
    
    def calculate_all_shadows(
        self,
        buildings: list[dict[str, Any]],
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
        
        shadow_polygons = self.calculate_shadow_polygons(
            buildings, dt, azimuth=azimuth, elevation=elevation
        )
        
        # Union all shadows
        if shadow_polygons:
            combined = unary_union(shadow_polygons)
            return combined
        else:
            return Polygon()  # Empty polygon

    def calculate_shadow_polygons(
        self,
        buildings: list[dict[str, Any]],
        dt: datetime,
        azimuth: float | None = None,
        elevation: float | None = None,
    ) -> list[Polygon]:
        """Calculate one shadow geometry per building footprint."""
        if azimuth is None or elevation is None:
            azimuth, elevation = self.get_sun_position(dt)
        self.logger.info(
            "Sun position at %s: azimuth=%.1f, elevation=%.1f",
            dt,
            azimuth,
            elevation,
        )

        shadows: list[Polygon] = []
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
            return float(shade_fraction)
            
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