"""Unit tests for RouteCache and ShadowCalculator (no OSM/data loading)."""

from __future__ import annotations

from datetime import datetime

import pytz
from shapely.geometry import LineString, Polygon

from src.cache import RouteCache
from src.database import check_database_connection
from src.shadow_calculator import ShadowCalculator


def test_route_cache_roundtrip_and_expiry():
    cache = RouteCache(max_items=2, ttl_seconds=60)
    key = cache.key(33.42, -111.93, 33.43, -111.92, minutes=12, shade_weight=0.7)
    assert cache.get(key) is None
    cache.set(key, {"ok": True})
    assert cache.get(key) == {"ok": True}

    # eviction when over max_items
    cache.set(cache.key(33.42, -111.93, 33.43, -111.92, minutes=20), {"a": 1})
    cache.set(cache.key(33.42, -111.93, 33.43, -111.92, minutes=30), {"b": 2})
    assert len(cache._memory) <= 2


def test_route_cache_quantize_and_key_stability():
    cache = RouteCache()
    # Values within the same 0.0005 quantization cell
    k1 = cache.key(33.42410, -111.92810, 33.42510, -111.92710, minutes=12)
    k2 = cache.key(33.42420, -111.92820, 33.42520, -111.92720, minutes=14)
    assert k1 == k2
    assert cache.quantize(1.04, 0.1) == 1.0


def test_shadow_calculator_sun_position_daytime():
    calc = ShadowCalculator()
    tz = pytz.timezone("America/Phoenix")
    noon = tz.localize(datetime(2024, 6, 21, 12, 0, 0))
    azimuth, elevation = calc.get_sun_position(noon)
    assert 0 <= azimuth <= 360
    assert elevation > 0


def test_shadow_calculator_polygon_and_street_shade():
    calc = ShadowCalculator()
    local = Polygon([(0, 0), (20, 0), (20, 20), (0, 20), (0, 0)])
    shadow = calc.calculate_shadow_polygon(
        local, building_height=10.0, azimuth=180.0, elevation=45.0
    )
    assert shadow is not None
    assert not shadow.is_empty

    night = calc.calculate_shadow_polygon(
        local, building_height=10.0, azimuth=180.0, elevation=-5.0
    )
    assert night is None

    street = LineString([(10, -10), (10, 40)])
    fraction = calc.calculate_street_shade(street, shadow)
    assert 0.0 <= fraction <= 1.0


def test_database_health_helper():
    assert isinstance(check_database_connection(), bool)
