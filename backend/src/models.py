"""ORM and API models used by the live OSM routing pipeline."""

from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import Float, Index, Integer, LargeBinary, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base for SQLAlchemy models."""


class BuildingFootprint(Base):
    __tablename__ = "building_footprints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, default="Unknown", nullable=False)
    height: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)
    min_lat: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    max_lat: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    min_lon: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    max_lon: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    geom_wkt: Mapped[str] = mapped_column(String, nullable=False)


class OSMGraphCache(Base):
    __tablename__ = "osm_graph_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    building_count: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    bounds_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    graph_blob: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class OSMEdgeShadeIndex(Base):
    __tablename__ = "osm_edge_shade_index"
    __table_args__ = (
        Index("idx_edge_time_bucket", "edge_id", "time_bucket"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    day_of_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    edge_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # minutes from midnight, step=5
    time_bucket: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    shade_fraction: Mapped[float] = mapped_column(Float, nullable=False)


class Location(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class RouteRequest(BaseModel):
    start: Location
    end: Location
    time_of_day: float = Field(..., ge=0, lt=24)
    day_of_year: float = Field(default=180, ge=0, le=365)
    optimize_for: str = Field(default="shade", pattern="^(shade|speed)$")
    shade_weight: float = Field(default=0.7, ge=0, le=1)
    waypoints: list[Location] | None = None
    calendar_date: str | None = None


class RouteSegment(BaseModel):
    start: Location
    end: Location
    distance: float
    shade_probability: float
    orientation: float


class RouteResponse(BaseModel):
    segments: list[RouteSegment]
    total_distance: float
    average_shade: float
    total_time_minutes: float
    path_coordinates: list[list[float]]
    polyline_coordinates: list[list[float]]
    edge_geometries: list[list[list[float]]]
    edge_ids: list[str]
    comparison: dict[str, Any] | None = None
    fastest_segments: list[RouteSegment] | None = None
    fastest_polyline_coordinates: list[list[float]] | None = None