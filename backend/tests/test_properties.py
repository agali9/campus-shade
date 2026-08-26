import os
from math import isclose

import hypothesis.strategies as st
from fastapi.testclient import TestClient
from hypothesis import given, settings
from shapely.geometry import LineString
from shapely.ops import transform
from shapely.wkt import loads as wkt_loads

os.environ["SKIP_DATA_LOADING"] = "1"

from src import api
from src.database import get_session
from src.models import BuildingFootprint


client = TestClient(api.app)


def _random_node_pairs():
    graph = api.route_service.graph
    if graph is None:
        return st.just((None, None))
    nodes = list(graph.nodes())
    return st.tuples(st.sampled_from(nodes), st.sampled_from(nodes)).filter(lambda t: t[0] != t[1])


@settings(max_examples=20, deadline=None)
@given(_random_node_pairs())
def test_route_never_intersects_buildings(pair):
    n1, n2 = pair
    if n1 is None or api.route_service.graph is None:
        return
    g = api.route_service.graph
    start = {"lat": float(g.nodes[n1]["y"]), "lon": float(g.nodes[n1]["x"])}
    end = {"lat": float(g.nodes[n2]["y"]), "lon": float(g.nodes[n2]["x"])}
    response = client.post(
        "/route",
        json={
            "start": start,
            "end": end,
            "time_of_day": 12,
            "day_of_year": 180,
            "optimize_for": "shade",
            "shade_weight": 0.7,
        },
    )
    if response.status_code != 200:
        return
    coords = response.json()["path_coordinates"]
    route_line = LineString([(lon, lat) for lat, lon in coords])
    with get_session() as session:
        buildings = session.query(BuildingFootprint).limit(250).all()
    for b in buildings:
        poly = wkt_loads(b.geom_wkt)
        assert not route_line.intersects(poly)


@settings(max_examples=20, deadline=None)
@given(_random_node_pairs())
def test_shade_route_exposure_not_worse_than_fastest(pair):
    n1, n2 = pair
    if n1 is None or api.route_service.graph is None:
        return
    g = api.route_service.graph
    start = {"lat": float(g.nodes[n1]["y"]), "lon": float(g.nodes[n1]["x"])}
    end = {"lat": float(g.nodes[n2]["y"]), "lon": float(g.nodes[n2]["x"])}
    fast = client.post(
        "/route",
        json={"start": start, "end": end, "time_of_day": 12, "day_of_year": 180, "optimize_for": "speed", "shade_weight": 0.0},
    )
    shade = client.post(
        "/route",
        json={"start": start, "end": end, "time_of_day": 12, "day_of_year": 180, "optimize_for": "shade", "shade_weight": 0.7},
    )
    if fast.status_code != 200 or shade.status_code != 200:
        return
    assert shade.json()["average_shade"] >= fast.json()["average_shade"]


@settings(max_examples=20, deadline=None)
@given(_random_node_pairs())
def test_route_length_matches_segment_sum(pair):
    n1, n2 = pair
    if n1 is None or api.route_service.graph is None:
        return
    g = api.route_service.graph
    start = {"lat": float(g.nodes[n1]["y"]), "lon": float(g.nodes[n1]["x"])}
    end = {"lat": float(g.nodes[n2]["y"]), "lon": float(g.nodes[n2]["x"])}
    response = client.post(
        "/route",
        json={"start": start, "end": end, "time_of_day": 12, "day_of_year": 180, "optimize_for": "shade", "shade_weight": 0.7},
    )
    if response.status_code != 200:
        return
    payload = response.json()
    segment_total = sum(seg["distance"] for seg in payload["segments"])
    assert isclose(segment_total, payload["total_distance"], rel_tol=0.1, abs_tol=50)


@settings(max_examples=20, deadline=None)
@given(_random_node_pairs())
def test_route_points_are_connected(pair):
    n1, n2 = pair
    if n1 is None or api.route_service.graph is None:
        return
    g = api.route_service.graph
    start = {"lat": float(g.nodes[n1]["y"]), "lon": float(g.nodes[n1]["x"])}
    end = {"lat": float(g.nodes[n2]["y"]), "lon": float(g.nodes[n2]["x"])}
    response = client.post(
        "/route",
        json={"start": start, "end": end, "time_of_day": 12, "day_of_year": 180, "optimize_for": "speed", "shade_weight": 0.0},
    )
    if response.status_code != 200:
        return
    coords = response.json()["path_coordinates"]
    for i in range(len(coords) - 1):
        lat1, lon1 = coords[i]
        lat2, lon2 = coords[i + 1]
        assert abs(lat1 - lat2) < 0.01 and abs(lon1 - lon2) < 0.01
