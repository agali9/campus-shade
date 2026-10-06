# CampusShade

Shade-aware walking routes for ASU Tempe. The live site is [https://campus-shade.agali9.workers.dev/](https://campus-shade.agali9.workers.dev/).

The map is hosted on Cloudflare. Route and shadow calculations run on a separate API at Render. You do not need to install anything to use it.

## How it works

- **Shadows:** the FastAPI backend computes the sun's position with pvlib and casts shadows from 2,648 campus building footprints.
- **Graph:** a pedestrian walk graph of 12,739 nodes and 28,477 directed edges.
- **Routing:** a custom time-aware shade Dijkstra returns a shade-weighted route alongside the fastest route.
- **Shade index:** 1,025,172 precomputed edge-time shade records for an 11:00-14:00 window, held in memory and in the database.
- **Frontend:** React and TypeScript with MapLibre.

## Results

**Route quality.** 50 seeded origin-destination pairs (at least 250 m apart), each routed at 08:00, 12:00, and 17:00 on 2024-06-21 with shade weight 0.7. All 150 routes succeeded.

| Metric (shade route vs fastest) | Median |
|---|---:|
| Modeled shade | 1.64x |
| Distance | 1.005x (0.5% longer) |

The shade route improved shade on 72.7% of route/time combinations; the shade-ratio interquartile range was 1.08x-2.42x.

**Routing time with the warm shade index:**

| | p50 | p95 | p99 |
|---|---:|---:|---:|
| Time-aware shade routing | 878 ms | 1,376 ms | 1,523 ms |
| Length-only routing | 806 ms | 1,357 ms | 1,525 ms |

Shade-aware routing adds about 1.4% at p95, nothing at p99, and about 9% at p50.

**Tests:** 16 backend pytest cases and 7 frontend Vitest cases pass locally. GitHub Actions runs linting, tests, and build checks on every push and pull request.

## Using the site

The campus map opens on Tempe. A panel in the corner is how you plan a walk.

1. Set a start and a destination. Type a campus place in either box, or press **Choose point** and tap the map. Clicks snap to the nearest walkable path.
2. Wait until the line under the buttons says **Ready to route.** Then press **Go**.
3. Two walks show up: a green **Shade route** and a blue **Fastest** walk. Distance is in meters. Turn either layer off with the chips if you only want one.
4. **Shadows** paints a flat grey mask where buildings cast shade. If the sun is down, that layer stays empty and the shade route matches the fastest route.
5. **Plan** lets you pick a date and time instead of "right now" in Phoenix. It shows that day's sunrise and sunset. **Use this time** applies it. **Now** goes back to the live clock.
6. **Clear** wipes the points and the drawn routes.

## When the backend is ready

Render sleeps when nobody has used it. The first visit can take up to a minute while it wakes.

The panel tells you where that stands:

- **Checking the route server…** — the page is asking the API if it is up.
- **The route server is waking up…** — the site is open, but the API has not answered yet. Shadows may appear before routes work.
- **The map server is up. Routes are still loading…** — buildings and shadows can load, but the walk network is not ready. Do not press Go yet.
- **Ready to route.** — press Go.

If you press Go too early, the panel says to wait and try again. Grey shadows on the map only mean the shadow request succeeded. Routes are ready when the status line says so.

## Run locally

You only need this if you are changing the code. The deployed site is enough to use the app.

**Backend**

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn src.api:app --host 0.0.0.0 --port 8000
```

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Optional `frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

Add `?debug=1` for extra system details. The first local start still has to load campus buildings and the walk graph.

## Tests

```bash
cd backend
# PowerShell
$env:SKIP_DATA_LOADING="1"
python -m pytest -q

cd frontend
npm run test
```

Routing details are in `PROJECT_RUNDOWN.md` and `ARCHITECTURE.md`.
