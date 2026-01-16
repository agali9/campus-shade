"""Pydantic models for API request/response validation."""

from pydantic import BaseModel, Field, validator
from typing import List, Tuple, Optional

class Location(BaseModel):
    """Geographic location."""
    lat: float = Field(..., ge=-90, le=90, description="Latitude")
    lon: float = Field(..., ge=-180, le=180, description="Longitude")

class RouteRequest(BaseModel):
    """Request for route computation."""
    start: Location
    end: Location
    time_of_day: float = Field(..., ge=0, lt=24, description="Hour of day")
    day_of_year: float = Field(default=180, ge=0, le=365, description="Day of year")
    optimize_for: str = Field(default="shade", pattern="^(shade|speed)$")
    shade_weight: float = Field(default=0.7, ge=0, le=1, description="Weight for shade vs distance")

# more fields later
