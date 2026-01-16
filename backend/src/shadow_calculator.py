"""
Building shadow calculator using real sun position and geometry.
Requires: geopandas, shapely, pvlib, pytz
"""

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
    print("ΓÜá∩╕Å pvlib not installed. Install with: pip install pvlib")

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
        
    def get_sun_position(self, dt: datetime) -> Tuple[float, float]:
        """
        Calculate sun azimuth and elevation for given time.
        
        Args:
            dt: DateTime object (timezone-aware)
            
        Returns:
            (azimuth, elevation) in degrees
        """
        if not PVLIB_AVAILABLE:
            # Fallback: simple approximation
            hour = dt.hour + dt.minute / 60
            # Elevation: peak at solar noon (12pm)
            elevation = 60 * math.sin((hour - 6) / 12 * math.pi)
            # Azimuth: rotate from east (90┬░) through south (180┬░) to west (270┬░)
            azimuth = 90 + (hour - 6) / 12 * 180
            return azimuth, max(0, elevation)
        
        # Use pvlib for accurate calculation
        times = pd.DatetimeIndex([dt])
        solar_pos = solarposition.get_solarposition(
            times, 
            self.latitude, 
            self.longitude,
            method='nrel_numpy'
        )
        
        azimuth = solar_pos['azimuth'].iloc[0]
        elevation = solar_pos['apparent_elevation'].iloc[0]
        
        return azimuth, elevation
    
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
        # Note: 0┬░ = North = +Y, 90┬░ = East = +X
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

# expand shadow union later
