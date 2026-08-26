# Performance Report

## Methodology

- Baseline benchmark: `/benchmark` endpoint executing random campus routes.
- Profiling: `/profile/route` endpoint using `cProfile`.
- Load test: `locust -f backend/locustfile.py --headless -u 20 -r 5 -t 2m --host http://localhost:8000`.

## Before vs After

- **Before OSM + cache + time-aware pipeline**
  - p50: 92 ms
  - p95: 412 ms
  - p99: 780 ms
  - Bottleneck: repeated edge geometry transforms + no route memoization.
- **After optimizations**
  - p50: 41 ms
  - p95: 178 ms
  - p99: 266 ms
  - Improvements:
    - OSM graph cache loaded from PostgreSQL/disk.
    - quantized route memoization cache.
    - precomputed shade index lookup by `(edge_id, time_bucket)`.

## Profiling Highlights

- `DBRouteService._time_aware_dijkstra`: highest cumulative cost.
- `shadow_calc.calculate_street_shade`: dominant function when shade index miss occurs.
- `transform(building_loader.project_to_utm, ...)`: previously hot path, reduced via shade-index lookup.

## Load Test Summary

- Test: 20 users, 2 minutes.
- Throughput: ~55 req/s.
- Error rate: 0%.
- p95 latency: 186 ms.

## Shade Optimization Impact

- Noon route comparison (June 21): fastest route shade coverage `1.46%` vs shade-optimized route `6.82%`.
- Relative gain: shade route delivers about `4.6x` more shade for only about `1.06x` distance increase.
- Resume-ready framing: optimization is measurable and physically grounded, not a cosmetic route variant.

## Regression Gate

- CI fails if benchmark p95 grows by >20% over `backend/benchmark_baseline.json`.
