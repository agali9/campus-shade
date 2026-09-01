# CampusShade - Full Technical Rundown

This document explains how the project works end-to-end for a programmer who is new to the codebase. How to use the live site is in `README.md`.

## 1) What this project is

CampusShade plans walking routes on ASU Tempe for shade, not only distance.

- The live frontend is a React + MapLibre app at [https://campus-shade.agali9.workers.dev/](https://campus-shade.agali9.workers.dev/), served by a Cloudflare Worker.
- The backend is FastAPI on Render. It computes sun position, building shadows, and both the fastest and shade-optimized walks.
- There is no Google Maps or Google Directions call. Both paths come from `POST /route`.

The panel shows distance in meters, shade percent, and a short exposure profile along the walk.

## 2) High-level architecture

### Frontend (TypeScript + React + MapLibre)

- Place search (Nominatim, campus viewbox) and map tap (snap to the walk graph).
- Phoenix clock, plus a **Plan** date/time picker that uses that day’s sunrise and sunset.
- Status line from `GET /` so the user knows when Render is awake and routing is ready.
- Map overlays: grey shade mask, green shade route, blue fastest route.
- Layer chips for shadows and the shade route.

### Backend (Python + FastAPI)

- Load campus building footprints and the bundled walk graph.
- Compute sun, sunrise/sunset, and shadow polygons.
- Snap points, run shortest path and time-aware shade routing.
- Cache route responses. Optional Redis.
- Request metrics, logs, and tracing.

### Data

- Buildings: `backend/data/buildings/asu_campus_only.geojson`, then SQLAlchemy `building_footprints`.
- Walk network: `backend/data/osm/campus_walk.json` (shipped with the app).
- Optional caches: SQLite or Postgres graph blob, GraphML on disk, in-memory shadow and route caches.

## 3) Technology stack

### Backend

- API: FastAPI, Pydantic v2
- DB: SQLAlchemy
- Graph: networkx. osmnx is only the live-download fallback.
- Geometry: shapely, pyproj, geopandas, rtree
- Solar position: pvlib. Sunrise/sunset: Open-Meteo, then a local elevation scan.
- Metrics: prometheus-client, structlog, opentelemetry
- Optional cache: redis
- Tests: pytest, hypothesis, mypy, ruff, locust

### Frontend

- React 18, TypeScript, Vite
- Map: `react-map-gl/maplibre` and `maplibre-gl`. Default style is Esri World Street Map tiles. Override with `VITE_MAP_STYLE_URL`.
- Search: Nominatim
- Tests: vitest, Testing Library
- Cloudflare: `frontend/worker.mjs`, `frontend/wrangler.jsonc`

### CI

- GitHub Actions: ruff, mypy, pytest, frontend tests and build, benchmark gate, Docker build.
- Backend image runs `uvicorn src.api:app`.

## 4) Repository layout

- `README.md` — live site, how to use it, short local run.
- `ARCHITECTURE.md` — current design.
- `PERFORMANCE.md` — local benchmark numbers vs what the live site feels like.
- `backend/src/api.py` — endpoints and startup.
- `backend/src/routing.py` — bundled graph, snap, Dijkstra.
- `backend/src/shadow_calculator.py` — solar position and shadow geometry.
- `backend/src/sun_schedule.py` — Open-Meteo sunrise/sunset.
- `backend/src/building_data_loader.py` — GeoJSON load and projection.
- `frontend/src/App.tsx` — clock, status poll, route requests.
- `frontend/src/components/CampusMap.tsx` — map layers.
- `frontend/src/components/RoutePanel.tsx` — the route sheet UI.
- `frontend/src/components/SearchBox.tsx` — Nominatim search.
- `frontend/src/services/api.ts` — API client.

## 5) Backend startup

If `SKIP_DATA_LOADING` is not `1`:

1. Seed or load building footprints. Fewer than 100 rows is treated as a fixture and reseeded.
2. Build an in-memory bbox index (`ALL_BUILDINGS`, `BUILDING_INDEX`).
3. Load the walk graph. Order: bundled JSON, then DB cache, then disk GraphML, then OSMnx.
4. Optionally precompute the edge shade index if `PRECOMPUTE_SHADE_INDEX=1`.

`GET /` then reports:

- `buildings_loaded`
- `street_network_ready` (`route_service.graph` is set)
- `route_data_source` (`postgresql` or `sqlite`)

CORS allows localhost dev ports and `https://campus-shade.agali9.workers.dev`. Extra origins can be set with `CORS_ORIGINS`.

## 6) HTTP API

### Used by the site

- `GET /` — readiness. The panel polls this every 10 seconds with a 20 second timeout.
- `GET /snap?lat=&lon=` — snap a click onto the nearest walk edge. Rejected if farther than 300 m.
- `GET /sun?hour=&day=` — azimuth, elevation, daytime, sunrise, sunset.
- `GET /sun/day?date=YYYY-MM-DD` — sunrise and sunset for **Plan**.
- `GET /shadows?hour=&day=` — GeoJSON shade mask. Empty features when the sun is down.
- `POST /route` — both paths, comparison, and `sun_below_horizon`.

`POST /route` body includes `start`, `end`, `time_of_day`, `day_of_year`, `optimize_for`, `shade_weight`, and optional `calendar_date`. The frontend always asks for `optimize_for: shade`. The response still includes the fastest path.

### Also present

- `GET /campus/bounds`, `/buildings`, `/health/db`, `/metrics`
- `GET /debug/snap`, `/debug/nodes`, `/debug/graph`, `/debug/shadows`, `/debug/edge_shade`
- `GET /benchmark`, `/profile/route`
- `POST /shade/precompute`

## 7) Walk graph

`RouteDataStore.load_bundled_walk_graph` reads Overpass-style JSON and builds a `MultiDiGraph`.

- Ways kept: footway, path, pedestrian, steps, cycleway.
- Those types are treated as two-way.
- Edge length is haversine meters. Geometry is a WGS84 `LineString`.
- Node `x` is longitude, `y` is latitude.

This is what production uses. A live Overpass download is only a fallback and has failed on Render before.

## 8) Sun, night, and shadows

Timezone is `America/Phoenix`.

- Sun position: pvlib, with a sinusoidal fallback.
- Daily window: Open-Meteo forecast for campus lat/lon, cached by date. Fallback scans elevation every 5 minutes.
- A planned date uses `calendar_date` so the clock is not “day 180 of 2024”.

Shadow length is `height / tan(elevation)`, capped, cast opposite the sun azimuth. The API unions those polygons and subtracts building footprints so the map shows flat grey shade, not overlapping fills. If elevation is at or below the horizon, `/shadows` returns no features.

If the chosen time is outside sunrise–sunset, `/route` copies the fastest path into the shade result and sets `comparison.sun_below_horizon`. The panel then marks the shade route as the same as fastest.

## 9) Routing

Snap projects the click onto the nearest edge, inserts a temporary node, and rejects points too far from the network.

Fastest: `networkx.shortest_path` weighted by length.

Shade: Dijkstra with cost `length * (1 + shade_weight * sun_fraction)`. The frontend uses `shade_weight` `0.7`. Arrival time buckets shade so a longer walk is not scored at the departure instant only. Missing index rows compute shade from the shadow union.

Walking time is `distance / 1.4` meters per second.

Response comparison includes distance, time, average shade, and `sun_below_horizon`.

## 10) Frontend flow

`App.tsx` owns start/end, Phoenix time, plan lock, shadow and route layers, and the status poll.

On load it starts the clock (unless **Plan** is locked or `?debug=1` is showing manual sliders), fetches shadows for the current 5-minute bucket, and polls `GET /`.

Status text:

- not checked yet — checking the route server
- no response — Render is waking up; shadows may appear first
- buildings up, graph not ready — do not press Go
- `street_network_ready` — ready to route

**Go** does not block on a health check. It posts `/route` directly. If the graph is still down, the error says to wait and try again.

Map clicks call `/snap`, then reverse-geocode with Nominatim. Search uses Nominatim bounded to the campus viewbox.

`CampusMap` draws the raster basemap, start/end markers, a grey shade fill, a blue fastest line, and a green shade line. The MapLibre worker URL is set explicitly so Vite emits it; otherwise the SPA fallback serves HTML and the worker fails its MIME check.

`RoutePanel` is the sheet: search, map-pin pick, swap, status, Go, Plan/Time, Clear, layer chips, and comparison cards. Distances are meters.

## 11) Configuration

- `VITE_API_BASE_URL` — API origin. Local default `http://localhost:8000`. Production build must point at the Render URL.
- `VITE_MAP_STYLE_URL` — optional MapLibre style.
- `DATABASE_URL` — default SQLite file. Render may set Postgres.
- `REDIS_URL` — optional route cache.
- `SKIP_DATA_LOADING=1` — tests.
- `PRECOMPUTE_SHADE_INDEX=1` — startup shade index.
- `CORS_ORIGINS` — extra allowed origins.
- `ENABLE_CONSOLE_TRACING=1` — optional tracing.

No map API key is required.

## 12) Tests

Backend, from `backend`, with data loading skipped on Windows PowerShell:

```powershell
$env:SKIP_DATA_LOADING="1"
python -m pytest -q
```

- `test_api.py` — contracts, including 503 when routing is down.
- `test_route_integration.py` — tiny graph fixture.
- `test_properties.py` — randomized route invariants.
- `test_building_heights.py`, `test_unit_core.py` — height and core helpers.

Frontend:

```bash
cd frontend
npm run test
```

`CampusMap.test.tsx` mocks MapLibre. `RoutePanel.test.tsx` covers Go enablement.

## 13) Run locally

Only needed to change the code. The deployed site is enough to use the app.

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn src.api:app --host 0.0.0.0 --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The first start still loads buildings and the walk graph. Add `?debug=1` for the system panel.

## 14) Mental model

The browser draws the campus. The API owns the walk graph and the sun. A shade route is a longer-cost shortest path through building shadows. At night that search is skipped and the fastest walk is shown twice.
