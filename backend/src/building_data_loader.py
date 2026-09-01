"""
Load and process ASU building data for shadow calculations.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pyproj
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform

logger = logging.getLogger("uvicorn.error")


def _parse_building_height(props: dict[str, Any], default: float = 9.0) -> float:
    """Prefer Maricopa/ASU LiDAR-derived AGL fields, then OSM-style keys."""
    for key in ("HGT_AGL", "AVGHT_M", "MAXHT_M", "height", "Height"):
        raw = props.get(key)
        if raw is None or raw == "":
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value

    levels = props.get("building:levels")
    if levels is not None and levels != "":
        try:
            return max(3.0, float(levels) * 3.0)
        except (TypeError, ValueError):
            pass
    return default


class BuildingDataLoader:
    """Load and process building footprints for ASU campus."""

    def __init__(self, use_fallback: bool = False) -> None:
        self.bounds = {
            "min_lat": 33.4120,
            "max_lat": 33.4320,
            "min_lon": -111.9420,
            "max_lon": -111.9180,
        }

        # ASU Tempe is UTM zone 12N
        self.crs_wgs84 = pyproj.CRS("EPSG:4326")
        self.crs_utm = pyproj.CRS("EPSG:32612")
        self.transformer_to_utm = pyproj.Transformer.from_crs(
            self.crs_wgs84, self.crs_utm, always_xy=True
        )
        self.transformer_to_wgs84 = pyproj.Transformer.from_crs(
            self.crs_utm, self.crs_wgs84, always_xy=True
        )

        self.use_fallback = use_fallback
        if not use_fallback:
            x, y = self.transformer_to_utm.transform(-111.9281, 33.4242)
            if not (410000 < x < 420000 and 3695000 < y < 3705000):
                logger.warning(
                    "UTM transform looks off for ASU center (%.0f, %.0f); enabling fallback",
                    x,
                    y,
                )
                self.use_fallback = True
            else:
                logger.info("Using EPSG:32612 (got ASU center ~%.0f, %.0f)", x, y)

    def project_to_utm(self, lon: float, lat: float) -> tuple[float, float]:
        if self.use_fallback:
            center_lon, center_lat = -111.9281, 33.4242
            center_x, center_y = 412900.0, 3702500.0
            x = center_x + (lon - center_lon) * 92600.0
            y = center_y + (lat - center_lat) * 111000.0
            return x, y
        return self.transformer_to_utm.transform(lon, lat)

    def project_to_wgs84(self, x: float, y: float) -> tuple[float, float]:
        if self.use_fallback:
            center_lon, center_lat = -111.9281, 33.4242
            center_x, center_y = 412900.0, 3702500.0
            lon = center_lon + (x - center_x) / 92600.0
            lat = center_lat + (y - center_y) / 111000.0
            return lon, lat
        return self.transformer_to_wgs84.transform(x, y)

    def create_synthetic_buildings(self, count: int = 20) -> list[dict[str, Any]]:
        np.random.seed(42)
        buildings: list[dict[str, Any]] = []
        min_x, min_y = self.project_to_utm(self.bounds["min_lon"], self.bounds["min_lat"])
        max_x, max_y = self.project_to_utm(self.bounds["max_lon"], self.bounds["max_lat"])
        grid_size = int(np.sqrt(count))
        x_step = (max_x - min_x) / (grid_size + 1)
        y_step = (max_y - min_y) / (grid_size + 1)
        building_id = 1
        for i in range(grid_size):
            for j in range(grid_size):
                if building_id > count:
                    break
                center_x = min_x + (i + 1) * x_step
                center_y = min_y + (j + 1) * y_step
                width = np.random.uniform(20, 50)
                length = np.random.uniform(20, 50)
                angle_rad = np.radians(np.random.uniform(0, 90))
                corners = [
                    (-width / 2, -length / 2),
                    (width / 2, -length / 2),
                    (width / 2, length / 2),
                    (-width / 2, length / 2),
                ]
                rotated = []
                for x, y in corners:
                    x_rot = x * np.cos(angle_rad) - y * np.sin(angle_rad)
                    y_rot = x * np.sin(angle_rad) + y * np.cos(angle_rad)
                    rotated.append((center_x + x_rot, center_y + y_rot))
                rotated.append(rotated[0])
                buildings.append(
                    {
                        "polygon": Polygon(rotated),
                        "height": float(np.random.uniform(10, 30)),
                        "name": f"Building {building_id}",
                        "id": building_id,
                    }
                )
                building_id += 1
        return buildings

    def load_from_geojson(self, filepath: str) -> list[dict[str, Any]]:
        buildings: list[dict[str, Any]] = []
        try:
            with open(filepath, encoding="utf-8") as f:
                data = json.load(f)

            features = data.get("features", [])
            logger.info("Loading %s features from %s", len(features), filepath)

            for idx, feature in enumerate(features):
                geom = shape(feature["geometry"])
                if geom.is_empty:
                    continue

                def to_utm_func(x: float, y: float, z: float | None = None) -> tuple[float, float]:
                    return self.project_to_utm(x, y)

                geom_utm = transform(to_utm_func, geom)
                props = feature.get("properties", {}) or {}
                height = _parse_building_height(props)
                name = (
                    props.get("name")
                    or props.get("NAME")
                    or props.get("BLDGID")
                    or props.get("ID")
                    or f"Building {idx}"
                )
                buildings.append(
                    {
                        "polygon": geom_utm,
                        "height": float(height),
                        "name": str(name),
                        "id": props.get("id", props.get("OBJECTID", idx)),
                    }
                )

            if buildings:
                heights = [b["height"] for b in buildings]
                logger.info(
                    "Loaded %s buildings (height min=%.1f mean=%.1f max=%.1f)",
                    len(buildings),
                    min(heights),
                    sum(heights) / len(heights),
                    max(heights),
                )
            return buildings
        except FileNotFoundError:
            logger.error("Building GeoJSON not found: %s", filepath)
            return []
        except Exception as exc:
            logger.exception("Error loading GeoJSON %s: %s", filepath, exc)
            return []

    def load_canopy_from_geojson(self, filepath: str) -> list[dict[str, Any]]:
        """Load canopy crown polygons (same shape contract as buildings)."""
        path = Path(filepath)
        if not path.exists():
            logger.info("No canopy GeoJSON at %s (trees not loaded)", filepath)
            return []
        items = self.load_from_geojson(str(path))
        for item in items:
            item["kind"] = "canopy"
        logger.info("Loaded %s canopy crowns", len(items))
        return items

    def save_to_geojson(self, buildings: list[dict[str, Any]], filepath: str) -> None:
        features = []

        def to_wgs84_func(x: float, y: float, z: float | None = None) -> tuple[float, float]:
            return self.project_to_wgs84(x, y)

        for building in buildings:
            polygon_wgs84 = transform(to_wgs84_func, building["polygon"])
            features.append(
                {
                    "type": "Feature",
                    "geometry": mapping(polygon_wgs84),
                    "properties": {
                        "height": building["height"],
                        "name": building["name"],
                        "id": building.get("id", 0),
                    },
                }
            )

        Path(filepath).parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "features": features}, f, indent=2)

    def get_buildings_in_bounds(
        self,
        buildings: list[dict[str, Any]],
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
    ) -> list[dict[str, Any]]:
        min_x, min_y = self.project_to_utm(min_lon, min_lat)
        max_x, max_y = self.project_to_utm(max_lon, max_lat)
        out: list[dict[str, Any]] = []
        for b in buildings:
            minx, miny, maxx, maxy = b["polygon"].bounds
            if not (maxx < min_x or minx > max_x or maxy < min_y or miny > max_y):
                out.append(b)
        return out
