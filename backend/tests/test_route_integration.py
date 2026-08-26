import os
import time

from fastapi.testclient import TestClient
import networkx as nx
from shapely.geometry import LineString

os.environ["SKIP_DATA_LOADING"] = "1"

from src import api
from src.database import get_engine, get_session
from src.models import Base, BuildingFootprint
from src.routing import DBRouteService, RouteDataStore


def _seed_minimal_fixture() -> nx.MultiDiGraph:
    Base.metadata.create_all(bind=get_engine())
    with get_session() as session:
        session.query(BuildingFootprint).delete()

        session.add(
            BuildingFootprint(
                id=1001,
                name="Test Building",
                height=12.0,
                min_lat=33.4243,
                max_lat=33.4245,
                min_lon=-111.9280,
                max_lon=-111.9277,
                geom_wkt="POLYGON((-111.9280 33.4243,-111.9277 33.4243,-111.9277 33.4245,-111.9280 33.4245,-111.9280 33.4243))",
            )
        )
        session.commit()

    graph = nx.MultiDiGraph()
    graph.add_node(1, x=-111.9282, y=33.4242)
    graph.add_node(2, x=-111.9278, y=33.4246)
    graph.add_node(3, x=-111.9274, y=33.4250)
    graph.add_edge(
        1,
        2,
        key=0,
        length=60.0,
        geometry=LineString([(-111.9282, 33.4242), (-111.9278, 33.4246)]),
    )
    graph.add_edge(
        2,
        3,
        key=0,
        length=60.0,
        geometry=LineString([(-111.9278, 33.4246), (-111.9274, 33.4250)]),
    )
    graph.add_edge(
        2,
        1,
        key=0,
        length=60.0,
        geometry=LineString([(-111.9278, 33.4246), (-111.9282, 33.4242)]),
    )
    graph.add_edge(
        3,
        2,
        key=0,
        length=60.0,
        geometry=LineString([(-111.9274, 33.4250), (-111.9278, 33.4246)]),
    )
    return graph


def test_route_integration_real_db_under_1s():
    graph = _seed_minimal_fixture()

    store = RouteDataStore()
    service = DBRouteService(store)
    service.set_graph(graph)

    original_store = api.route_store
    original_service = api.route_service
    api.route_store = store
    api.route_service = service
    try:
        client = TestClient(api.app)
        start = time.perf_counter()
        response = client.post(
            "/route",
            json={
                "start": {"lat": 33.4242, "lon": -111.9282},
                "end": {"lat": 33.4250, "lon": -111.9274},
                "time_of_day": 12,
                "day_of_year": 180,
                "optimize_for": "shade",
                "shade_weight": 0.7,
            },
        )
        elapsed_ms = (time.perf_counter() - start) * 1000
    finally:
        api.route_store = original_store
        api.route_service = original_service

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["path_coordinates"]
    assert len(payload["path_coordinates"]) >= 2
    assert elapsed_ms < 1000
