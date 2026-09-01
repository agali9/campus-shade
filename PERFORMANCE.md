# Performance Report

Numbers below are from local runs against a warm process. They are not Render cold-start times. The live API sleeps when idle; the first request after that can take about a minute before `GET /` returns.

The deployed router does not download OSM at startup. It loads `backend/data/osm/campus_walk.json`. That avoids Overpass timeouts on Render. Shade-index precompute is optional (`PRECOMPUTE_SHADE_INDEX=1` or `POST /shade/precompute`). The default path computes shade on the request from the current shadow union.

## Methodology

- Baseline benchmark: `/benchmark` endpoint executing random campus routes.
- Profiling: `/profile/route` using `cProfile`.
- Load test: `locust -f backend/locustfile.py --headless -u 20 -r 5 -t 2m --host http://localhost:8000`.

## Before vs After

- **Before OSM + cache + time-aware pipeline**
  - p50: 92 ms
  - p95: 412 ms
  - p99: 780 ms
  - Bottleneck: repeated edge geometry transforms + no route memoization.
- **After optimizations** (warm local process)
  - p50: 41 ms
  - p95: 178 ms
  - p99: 266 ms
  - Improvements:
    - walk graph reused from bundle, then SQL/disk cache, then OSMnx
    - quantized route memoization cache
    - optional precomputed shade index lookup by `(edge_id, time_bucket)`

## Profiling Highlights

- `DBRouteService._time_aware_dijkstra`: highest cumulative cost.
- `shadow_calc.calculate_street_shade`: dominant function when the shade index misses.
- Building projection used to be hot; lookups against a shadow union or a shade index cut that work on repeat requests.

## Load Test Summary

- Test: 20 users, 2 minutes, localhost.
- Throughput: ~55 req/s.
- Error rate: 0%.
- p95 latency: 186 ms.

## Shade Optimization Impact

- Noon route comparison (June 21): fastest route shade coverage `1.46%` vs shade-optimized route `6.82%`.
- Relative gain: about `4.6x` more shade for about `1.06x` distance.
- At night the shade route is the fastest route, so the ratio is `1.0`.

## What users feel on the live site

- Cloudflare serves the map immediately.
- Render may still be waking. The panel polls `GET /` (20s timeout, every 10s) and does not call the graph ready until `street_network_ready` is true.
- Shadows can paint before routes work. Distance in the panel is meters.

## Regression Gate

- CI fails if benchmark p95 grows by >20% over `backend/benchmark_baseline.json`.
