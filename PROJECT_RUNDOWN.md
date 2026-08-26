# CampusShade - Full Technical Rundown

This document explains how the project works end-to-end for a programmer who is new to the codebase.

## 1) What this project is

CampusShade is a route-planning application focused on **heat and sun exposure** rather than only distance/time.

- The frontend is a React app with Google Maps.
- The backend is a FastAPI service that computes sun position, building shadows, and route paths.
- The backend compares:
  - a fastest route (`optimize_for: speed`), and
  - a shade-optimized route (`optimize_for: shade`, with a penalty on sun-exposed edges).

The core output is a route with distance/time and shade metrics, plus a side-by-side comparison against fastest path behavior.

---

## 2) High-level architecture

### Frontend (TypeScript + React + Google Maps)

- Responsible for all user interaction and rendering:
  - place selection (search + map click),
  - time/day controls,
  - map overlays (buildings, shadows),
  - route rendering (Google fastest + backend shade path),
  - stats panel and exposure profile.

### Backend (Python + FastAPI + geospatial stack)

- Responsible for:
  - storing and loading building footprints,
  - loading/caching OSM graph,
  - computing sun and shadows,
  - running routing algorithms,
  - exposing REST APIs,
  - request metrics/logging/tracing,
  - route result caching.

### Data stores and caches

- SQLAlchemy-backed DB (`DATABASE_URL`, default SQLite):
  - building footprint table,
  - OSM graph cache table (pickled graph blob),
  - edge/time shade index table.
- File cache:
  - OSM graph GraphML file on disk.
- Runtime caches:
  - in-memory/Redis route cache,
  - in-process shadow polygon cache keyed by time and viewport.

---

## 3) Technology stack

## Backend stack

- API framework: `FastAPI`
- Validation: `Pydantic v2`
- ORM + DB access: `SQLAlchemy`
- Graph/routing: `networkx`, `osmnx`
- Geometry and transforms: `shapely`, `pyproj`, `geopandas`, `rtree`
- Solar position: `pvlib`
- Metrics/logging/tracing: `prometheus-client`, `structlog`, `opentelemetry-*`
- Optional distributed cache: `redis`
- Testing and quality: `pytest`, `hypothesis`, `pytest-cov`, `mypy`, `ruff`, `locust`

## Frontend stack

- UI: `React 18` + `TypeScript`
- Build/dev server: `Vite`
- Mapping: `@react-google-maps/api`
- Testing: `vitest`, `@testing-library/react`, `jsdom`
- Styling: Tailwind/PostCSS configured, with significant inline style usage

## CI/CD and packaging

- GitHub Actions workflow: lint + type-check + tests + frontend build + benchmark gate + Docker build.
- Backend Dockerfile runs `uvicorn src.api:app`.

---

## 4) Repository layout (important files)

### Root docs/config

- `README.md` - short project summary and key security note about API keys.
- `ARCHITECTURE.md` - design decisions and data flow.
- `PERFORMANCE.md` - benchmark methodology/results and optimization rationale.
- `.github/workflows/ci.yml` - CI pipeline.

### Backend

- `backend/src/api.py` - FastAPI app and endpoints; startup wiring.
- `backend/src/models.py` - SQLAlchemy models + Pydantic API schemas.
- `backend/src/routing.py` - OSM graph datastore + routing service + time-aware Dijkstra.
- `backend/src/shadow_calculator.py` - solar calculations and shadow geometry.
- `backend/src/building_data_loader.py` - building GeoJSON load and coordinate transforms.
- `backend/src/cache.py` - route response cache with Redis fallback.
- `backend/src/database.py` - DB engine/session helpers.
- `backend/src/observability.py` - logging, metrics, tracing.
- `backend/tests/*` - API, integration, and property tests.
- `backend/scripts/benchmark_check.py` - benchmark regression gate script.

### Frontend

- `frontend/src/main.tsx` - React bootstrap.
- `frontend/src/App.tsx` - top-level state machine and orchestration.
- `frontend/src/components/GoogleMap.tsx` - map rendering and overlays.
- `frontend/src/components/GoogleControls.tsx` - control panel and route comparison UI.
- `frontend/src/components/SearchBox.tsx` - Google Places autocomplete input.
- `frontend/src/services/api.ts` - backend API and Google Directions wrappers.
- `frontend/src/types/index.ts` - shared TS contracts.
- `frontend/src/*.test.tsx|ts` - frontend tests.

---

## 5) Backend startup and lifecycle

`backend/src/api.py` builds the app and initializes globals.

1. Creates `FastAPI` instance.
2. Configures structured logging + optional tracing.
3. Adds CORS for localhost frontend ports.
4. Instantiates long-lived service objects:
   - `ShadowCalculator`
   - `BuildingDataLoader`
   - `RouteDataStore`
   - `DBRouteService`
   - `RouteCache`
5. If `SKIP_DATA_LOADING != "1"`:
   - loads/seeds building data into DB,
   - builds spatial index over building bounds,
   - loads/builds OSM graph and attaches it to route service,
   - optionally precomputes edge shade index if `PRECOMPUTE_SHADE_INDEX=1`.
6. Adds middleware for request metrics, tracing span, and `X-Request-ID`.

### Important global state

- `ALL_BUILDINGS`: UTM-space building polygons (in memory).
- `BUILDING_INDEX`: simple bbox index for viewport filtering.
- `route_service.graph`: active OSM network graph.
- `SHADOW_CACHE`/`SHADOW_UNION_CACHE`: in-memory shadow geometry cache.

---

## 6) Backend API endpoints and behavior

## Core endpoints

- `GET /`
  - Service metadata and readiness indicators.
- `GET /campus/bounds`
  - Hardcoded campus bounds/center.
- `GET /health/db`
  - DB connectivity status.
- `GET /metrics`
  - Prometheus scrape output.
- `GET /sun?hour=&day=`
  - Sun azimuth/elevation and daytime boolean.
- `GET /buildings`
  - GeoJSON FeatureCollection of buildings (optionally bbox-filtered).
- `GET /shadows?hour=&day=&bbox`
  - Computes or returns cached shadow polygons as GeoJSON.
- `POST /route`
  - Computes route response (`RouteResponse`) and comparison metrics.

## Debug/perf endpoints

- `GET /debug/snap`, `/debug/nodes`, `/debug/graph`, `/debug/shadows`, `/debug/edge_shade`
- `GET /benchmark`
- `GET /profile/route`
- `POST /shade/precompute`

These support diagnostics and benchmark work, not just end-user behavior.

---

## 7) Data model details

Defined in `backend/src/models.py`.

## SQLAlchemy tables

### `building_footprints`

- `id`, `name`, `height`
- bbox columns: `min_lat`, `max_lat`, `min_lon`, `max_lon`
- `geom_wkt` (WKT geometry in WGS84)

### `osm_graph_cache`

- single-row cache keyed by:
  - building count,
  - graph bounds key.
- stores pickled NetworkX graph blob.

### `osm_edge_shade_index`

- one row per `(day_of_year, edge_id, time_bucket)` where `time_bucket` is in 5-minute increments.
- stores precomputed `shade_fraction`.
- indexed by edge/time for fast lookup.

## API schemas

- `Location { lat, lon }`
- `RouteRequest { start, end, time_of_day, day_of_year, optimize_for, shade_weight, waypoints? }`
- `RouteSegment { start, end, distance, shade_probability, orientation }`
- `RouteResponse` with:
  - `segments`
  - route totals (`total_distance`, `average_shade`, `total_time_minutes`)
  - path/polyline/edge geometries
  - `comparison` (fastest vs shade metrics)
  - `fastest_segments`

---

## 8) Graph loading and persistence strategy

Implemented in `RouteDataStore` (`backend/src/routing.py`).

### Building data seed/read path

1. Ensure DB tables exist.
2. If `building_footprints` empty, seed from GeoJSON.
3. If tiny fixture-like row count is detected (<100), reseed from full dataset.
4. Convert stored WKT back to Shapely, transform to UTM, return in-memory list.

### OSM graph cache hierarchy

Load order:

1. DB cached graph (`osm_graph_cache`)
2. Disk GraphML cache (`backend/data/cache/osm_walk.graphml`)
3. Live OSMnx fetch (`graph_from_bbox`) with network type fallback order:
   - `all`, `all_public`, `walk`, `drive`

On cache miss and successful fetch:

- write GraphML to disk,
- pickle and store in DB cache.

This avoids repeated network fetch and reduces startup latency in repeat runs.

---

## 9) Coordinate systems and geometry handling

The app routinely switches between:

- WGS84 lat/lon (for map and API contracts),
- local metric space (UTM-like) for geometric operations and lengths.

`BuildingDataLoader` currently contains:

- pyproj transformer setup attempts and diagnostics,
- a forced fallback linear projection mode (`use_fallback=True`) intended to stay consistent in project area.

This is functionally pragmatic for a limited campus bounding box but is a technical debt item if moving to broader geographies or strict geospatial correctness requirements.

---

## 10) Sun and shadow computation pipeline

Implemented in `ShadowCalculator` (`backend/src/shadow_calculator.py`).

## Sun position

- Uses `pvlib.solarposition.get_solarposition` when available.
- Falls back to a sinusoidal approximation if pvlib unavailable/fails.
- Timezone defaults to `America/Phoenix`.

## Building shadow polygon

For each building:

1. If elevation <= 0, no shadow.
2. Compute shadow length: `height / tan(elevation)`.
3. Clamp max shadow length (2 km cap).
4. Shadow direction is opposite sun azimuth.
5. Translate building footprint by computed offset.
6. Build quads between original and translated footprint edges.
7. Union parts to create full cast shadow geometry.

## Street shade fraction

Given a street line and shadow polygon:

- Intersect line with shadow geometry.
- Shade fraction = `shaded_length / total_line_length`.
- Clamp and return in [0,1].

---

## 11) Route computation algorithm

Core logic is in `DBRouteService`.

### 11.1 Snap origin/destination to graph

Input points are snapped to nearest OSM edge:

1. Find nearest edge.
2. Project clicked point onto edge geometry.
3. Reject if snap distance > 300m.
4. Insert temporary node at projected point.
5. Split edge into two segments (and reverse edge if present).

This allows realistic routing from arbitrary user points without requiring exact node coordinates.

### 11.2 Fastest route mode

- Runs `networkx.shortest_path` weighted by edge length.
- Equivalent to baseline shortest walking path in this graph.

### 11.3 Shade route mode (time-aware Dijkstra)

Custom Dijkstra keeps both:

- accumulated cost,
- elapsed traversal time.

At each candidate edge:

1. Estimate arrival time bucket (minutes from departure).
2. Lookup edge shade from precomputed index (`shade_for_edge_at_time`).
3. If index miss, compute on-the-fly using current shadow polygon and edge geometry.
4. Compute sun exposure fraction: `sun_fraction = 1 - shade_fraction`.
5. Compute edge cost:
   - `edge_cost = length * (1 + shade_weight * sun_fraction)`
6. Relax neighbor if new cost is lower.

This causes the router to prefer shadier edges when `shade_weight > 0`, with a tunable tradeoff.

### 11.4 Route response assembly

After path is built:

- Build polyline and per-edge geometry IDs.
- Compute segment-level metrics:
  - distance,
  - shade probability,
  - orientation.
- Compute route totals:
  - total distance,
  - average shade (distance-weighted),
  - time estimate (distance / 1.4 m/s).
- Compute both fastest and shaded variants, then include comparison block in response.

---

## 12) Route caching strategy

`RouteCache` in `backend/src/cache.py` implements a two-tier cache:

- Redis (if `REDIS_URL` set and reachable),
- else in-memory LRU-like ordered dict with TTL.

### Cache key quantization

Key includes:

- start/end coordinates quantized to `0.0005`,
- departure time bucketed to 5 min,
- day of year,
- optimization mode,
- quantized `shade_weight`.

This intentionally trades exactness for better hit-rate and lower latency for near-identical requests.

---

## 13) Observability and performance controls

`backend/src/observability.py` sets:

- `REQUEST_COUNT` (counter by path/method/status),
- `REQUEST_LATENCY` (histogram by path/method),
- `ROUTE_DISTANCE` histogram,
- `CACHE_HIT_RATE` counter.

Middleware also:

- creates request ID,
- wraps request in tracing span,
- emits `X-Request-ID` response header.

### Benchmark gate

`backend/scripts/benchmark_check.py`:

- calls `/benchmark?iterations=200`,
- compares current `p95_ms` to baseline in `backend/benchmark_baseline.json`,
- fails CI if regression is >20%.

---

## 14) Frontend architecture and state flow

Main orchestration is in `frontend/src/App.tsx`.

## 14.1 App state

`App` tracks:

- map center,
- start/end location + address,
- time/day inputs,
- visibility toggles (shadows, shade route),
- Google route result,
- backend shade route result,
- info panels,
- map-loaded state and computing state.

## 14.2 Startup effects

On load:

- fetch building data from backend.
- initialize `DirectionsService` once Maps API is loaded.

On time/day/toggle change:

- fetch sun position.
- fetch shadow polygons (if shadow layer enabled).

## 14.3 Route compute button workflow

When user clicks "Get Directions":

1. Validate start/end selected.
2. Health-check backend (`GET /`).
3. Ensure Google Directions service exists.
4. Kick off:
   - Google walking route request,
   - backend shade route request (if toggle enabled).
5. Render Google route first.
6. Render shaded route when backend returns.
7. Populate side panel with route comparison + exposure profile data.
8. Show actionable error messages for backend/maps/routing issues.

---

## 15) Frontend map rendering details

Implemented in `GoogleMapComponent`.

### Rendered layers (rough z-order)

1. Building polygons (gray)
2. Google Directions route (blue)
3. Shade route polyline (green, high z-index)
4. Shadow polygons (dark translucent overlay, very high z-index)
5. Start/end markers (`A`/`B`)

### Geometry conversion

- Backend returns coordinates in `[lng, lat]` for polyline arrays.
- Component remaps to `{ lat, lng }` objects expected by Google Maps components.

### Map restrictions

- campus-focused bounds/min-max zoom.
- POI labels hidden for cleaner visualization.

---

## 16) Frontend controls and analytics UI

Implemented in `GoogleControls`.

### Input controls

- SearchBox for origin/destination.
- swap button.
- time-of-day slider (6:00 to 20:00).
- day-of-year slider (0-365).
- toggles:
  - show building shadows,
  - show shade route.

### Result panel

- Fastest route metrics:
  - distance, duration (Google-provided).
- Shade route metrics:
  - distance, modeled duration, shade coverage, fastest shade.
- Exposure bars:
  - shaded vs sun percentages.
- Exposure profile chart:
  - bucketed shade along route progress.

The bucketed exposure profile is computed from segment list using segment midpoint progress (stable and cheap).

---

## 17) API boundary between frontend and backend

`frontend/src/services/api.ts` defines typed wrappers.

### Backend calls

- `getCampusBounds()`
- `computeRoute()` / `computeShadeOptimizedRoute()`
- `getSunPosition()`
- `getShadows()`
- `getBuildings()`
- `checkBackendHealth()`

### Google calls

- `getGoogleDirections()` wraps callback-based Directions API in Promise form.

---

## 18) Testing strategy

## Backend tests

### `test_api.py`

- endpoint contracts and status checks.
- includes degraded-state check (`/route` returns 503 if service unavailable).

### `test_route_integration.py`

- seeds minimal DB + tiny graph fixture.
- verifies real route response and latency under threshold.

### `test_properties.py` (Hypothesis)

Property-style randomized assertions over graph node pairs:

- route line should not intersect sampled building geometries,
- shade route average shade should be >= fastest route shade,
- segment distance sum approximately matches total route distance,
- successive route points are locally connected.

## Frontend tests

- `api.test.ts`: API wrapper behavior and error handling.
- `GoogleControls.test.tsx`: button enable/disable and compute trigger.
- `GoogleMap.test.tsx`: map shell render using mocked Google Maps components.

---

## 19) CI pipeline behavior

Defined in `.github/workflows/ci.yml`.

### Backend job

1. install Python deps,
2. run `ruff`,
3. run strict `mypy`,
4. run pytest with coverage gate (`>=80%`),
5. run property tests,
6. start backend,
7. run benchmark regression gate.

### Frontend job

1. `npm ci`,
2. run tests,
3. run production build.

### Docker job

- builds backend image.

---

## 20) Runtime configuration and environment variables

Common settings inferred from code:

- `VITE_GOOGLE_MAPS_API_KEY` (frontend map functionality)
- `DATABASE_URL` (backend DB, default local sqlite file)
- `REDIS_URL` (optional route cache backend)
- `SKIP_DATA_LOADING=1` (typically test mode)
- `PRECOMPUTE_SHADE_INDEX=1` (optional startup precompute)
- `ENABLE_CONSOLE_TRACING=1` (optional tracing exporter)

---

## 21) Typical request walkthrough (`POST /route`)

1. Validate request body via Pydantic model.
2. Compute timezone-aware datetime from `day_of_year` + `time_of_day`.
3. Build route cache key from quantized fields.
4. Return cached result if available.
5. Fetch buildings in padded bbox around origin/destination.
6. Convert WKT geometries to UTM and compute current shadows.
7. Compute fastest route.
8. Compute shade route (time-aware).
9. Summarize both routes into per-segment + aggregate metrics.
10. Build response payload with comparison object.
11. Emit route distance metric, cache payload, return JSON.

---

## 22) Practical strengths and limitations

## Strengths

- End-to-end pipeline is coherent: geospatial data + realistic road graph + shade objective.
- Time-aware route cost is a strong algorithmic choice.
- Good observability hooks and benchmark gating.
- Includes CI and multiple layers of testing.

## Limitations / technical debt visible in current code

- `BuildingDataLoader` has verbose debug prints and forced fallback projection path.
- Some docs mention PostGIS-ready flow, but default runtime appears SQLite-centric.
- Several global in-memory caches are process-local (multi-instance consistency not guaranteed).
- `RouteRequest.waypoints` exists in models/API wrapper but is not clearly integrated into route algorithm pathing.
- Error handling and startup modes are pragmatic but not yet fully production-hardened.

---

## 23) How to run locally

## Backend

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn src.api:app --host 0.0.0.0 --port 8000
```

## Frontend

```bash
cd frontend
npm ci
npm run dev
```

Create `frontend/.env.local` with:

```bash
VITE_GOOGLE_MAPS_API_KEY=your_key_here
```

---

## 24) How to run tests

## Backend

```bash
cd backend
python -m pytest -q --cov=src --cov-fail-under=80
python -m pytest -q tests/test_properties.py
ruff check src tests
mypy src
```

## Frontend

```bash
cd frontend
npm run test
npm run build
```

---

## 25) Suggested reading order for new contributors

1. `backend/src/api.py` (entrypoint and endpoint orchestration)
2. `backend/src/routing.py` (core graph + algorithm logic)
3. `backend/src/shadow_calculator.py` (shadow math)
4. `frontend/src/App.tsx` (end-to-end client flow)
5. `frontend/src/components/GoogleMap.tsx` and `GoogleControls.tsx` (UI behavior)
6. `backend/tests/test_route_integration.py` and `test_properties.py` (behavioral guarantees)
7. `ARCHITECTURE.md` and `PERFORMANCE.md` (design/perf narrative)

---

## 26) Short mental model

If you remember only one thing, remember this:

- **Google** gives a conventional walking route.
- **Backend** computes shadows and solves a weighted shortest-path where sun-exposed edges cost more.
- **Frontend** overlays both and shows the tradeoff so users can choose comfort versus strict speed.

That is the project in one sentence: **a geospatial optimization system wrapped in an interactive map UX.**
