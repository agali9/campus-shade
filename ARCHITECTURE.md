# Architecture

CampusShade is a shade-aware walking planner for ASU Tempe.

- The live map is a Cloudflare Worker at [https://campus-shade.agali9.workers.dev/](https://campus-shade.agali9.workers.dev/).
- Route and shadow math run on a FastAPI service hosted on Render (`https://campus-shade.onrender.com`).
- There is no Google Maps API key. The map is MapLibre over a public raster basemap. Place search uses Nominatim.

## Data flow

1. The page polls `GET /` until `street_network_ready` is true. Shadows can return before that.
2. The user sets start and end by search or by tapping the map. Clicks call `GET /snap` and stick to the nearest walk edge.
3. **Go** posts `POST /route` once. The backend returns both the shade path and the fastest path. There is no separate directions provider.
4. `GET /shadows` returns one grey shade mask for the current Phoenix time. **Plan** calls `GET /sun/day` for that date’s sunrise and sunset, then sends `calendar_date` with the route.

Render free tier sleeps. The first request after idle can take about a minute. Grey shadows only mean `/shadows` answered. Routing is ready when the panel says **Ready to route.**

## Walk graph

Startup prefers a graph shipped with the repo: `backend/data/osm/campus_walk.json`. That file is an OSM walk extract (footway, path, pedestrian, steps, cycleway). Render does not need Overpass.

Fallback order if the bundle is missing:

1. SQLAlchemy graph cache (`osm_graph_cache`)
2. Disk GraphML (`backend/data/cache/osm_walk.graphml`)
3. Live OSMnx download (`all`, `all_public`, `walk`, then `drive`)

Building footprints come from `backend/data/buildings/asu_campus_only.geojson` and are kept in memory after startup.

## Why a real walk network

A campus grid invents edges through buildings and makes snapping unreliable. The bundled OSM ways are the paths people actually walk, and clicks can snap onto them.

## Shade vs fastest

Fastest mode is shortest path on edge length.

Shade mode is a time-aware Dijkstra. Edge cost is `length * (1 + shade_weight * sun_fraction)`. Shade comes from the union of building shadows at the arrival-time bucket, or from a precomputed `(edge, time_bucket)` index when that has been built.

At night, or whenever the chosen time is outside sunrise–sunset, there are no cast shadows. The shade route is the fastest route. Showing a second path would just pick another street of equal cost.

## Sun

Timezone is `America/Phoenix`. Solar position is `pvlib`, with a local approximation if that fails.

Sunrise and sunset for a planned date come from Open-Meteo, cached in process. If that call fails, the backend scans elevation in 5-minute steps.

## Shade on the map

`GET /shadows` unions building shadows and subtracts footprints so the overlay is a single grey mask, not stacked polygons. Empty features when the sun is down.

## Deployment

- Frontend: Vite build served by `frontend/worker.mjs` and `frontend/wrangler.jsonc`. The MapLibre worker is emitted as its own file so the SPA fallback does not return `index.html` for it.
- API base URL is `VITE_API_BASE_URL`, baked in at build time. Local default is `http://localhost:8000`.
- CORS allows the Workers origin and localhost dev ports.
- Production database is whatever `DATABASE_URL` Render sets. SQLite is the local default. Route cache is Redis only if `REDIS_URL` is set; otherwise it is in-process.

## Observability

- `GET /` exposes `buildings_loaded` and `street_network_ready`. The panel uses that, not a hard health gate before `/route`.
- Structlog request logs, Prometheus on `/metrics`, optional OpenTelemetry spans.
- `?debug=1` shows the same status plus sun details.

## Measured routing outcome

On a local noon June 21 comparison, fastest shade coverage was `1.46%` and the shade route reached `6.82%` (about `4.6x` more shade, about `1.06x` the distance). Those figures are from the local benchmark, not the Render cold-start path. See `PERFORMANCE.md`.
