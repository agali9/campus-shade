import os

from fastapi.testclient import TestClient

os.environ["SKIP_DATA_LOADING"] = "1"
from src import api


client = TestClient(api.app)


def test_root_endpoint_returns_service_metadata():
    response = client.get("/")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert "/route" in payload["endpoints"]


def test_campus_bounds_contract():
    response = client.get("/campus/bounds")
    assert response.status_code == 200
    payload = response.json()
    assert payload["min_lat"] < payload["max_lat"]
    assert payload["min_lon"] < payload["max_lon"]
    assert "center" in payload


def test_sun_endpoint_contract():
    response = client.get("/sun?hour=12&day=180")
    assert response.status_code == 200
    payload = response.json()
    assert "azimuth" in payload
    assert "elevation" in payload
    assert isinstance(payload["is_daytime"], bool)


def test_buildings_endpoint_returns_feature_collection():
    response = client.get("/buildings")
    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "FeatureCollection"
    assert "features" in payload


def test_shadows_endpoint_returns_geojson_feature():
    response = client.get("/shadows?hour=12&day=180")
    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "Feature"
    assert payload["geometry"]["type"] in {"Polygon", "MultiPolygon"}


def test_route_returns_503_when_router_unavailable():
    original_service = api.route_service
    api.route_service = None
    try:
        response = client.post(
            "/route",
            json={
                "start": {"lat": 33.4242, "lon": -111.9281},
                "end": {"lat": 33.4252, "lon": -111.9271},
                "time_of_day": 12,
                "day_of_year": 180,
                "optimize_for": "shade",
                "shade_weight": 0.7,
            },
        )
    finally:
        api.route_service = original_service

    assert response.status_code == 503


def test_database_health_endpoint_contract():
    response = client.get("/health/db")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload.keys()) == {"configured", "connected", "database_url_present"}
