# Architecture

## Data Flow

1. FastAPI receives route request with origin/destination/time.
2. Request middleware assigns `request_id`, captures metrics/tracing spans.
3. Route cache checks quantized key `(origin_cell, dest_cell, time_bucket)`.
4. If cache miss:
   - graph is loaded from PostgreSQL-backed OSM cache.
   - points snap to nearest OSM edges.
   - time-aware shortest-path runs with arrival-time-dependent weights.
   - response assembled with route segments and shade stats.
5. Response is cached, metrics emitted, request logged.

## Why OSMnx Over Custom Grid

- OSMnx gives a real pedestrian network with topological correctness.
- Grid graphs produce non-physical edges and ambiguous snapping near buildings.
- OSM graph improves routing realism and debugging confidence in interviews.

## Why Time-Dependent Weights

- Shade changes during a walk; static sun assumptions are physically wrong for longer routes.
- Time-aware Dijkstra propagates arrival time and chooses edges based on edge-local time buckets.
- Produces a stronger algorithmic story than simple static-weight shortest path.

## Shade Precomputation Tradeoff

- Precompute `(edge_id, time_bucket)` shade fractions at 5-minute granularity.
- Read path: fast indexed DB lookup.
- Write path: heavier startup / offline precompute cost.
- Chosen tradeoff: favors query latency and predictable p95.

## Observability Model

- Structlog JSON logs for request-scoped diagnostics.
- Prometheus metrics on `/metrics` for latency, counts, route distance, and cache hits.
- OpenTelemetry spans across pathfind and stage timing.

## Measured Routing Outcome

- On a noon June 21 scenario, fastest route shade coverage is `1.46%` while shade-optimized route reaches `6.82%`.
- This is about `4.6x` shade improvement with about `1.06x` distance cost, showing the objective function meaningfully shifts path choice.
- This metric is a key proof point that the system optimizes for real shade exposure rather than merely distance.

## What I Would Do Differently With Another Month

- Move shade-index precompute to a dedicated async worker with checkpointing.
- Replace pickle graph blob with versioned graph shards + migration tooling.
- Add map-matching quality tests using real GPS traces.
- Introduce scenario-based SLO dashboards and alerting policies.
