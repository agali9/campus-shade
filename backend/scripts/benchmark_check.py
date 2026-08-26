import json
from pathlib import Path

import requests


def main() -> None:
    baseline_path = Path(__file__).resolve().parents[1] / "benchmark_baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    response = requests.get("http://localhost:8000/benchmark?iterations=200", timeout=120)
    response.raise_for_status()
    current = response.json()
    allowed = baseline["p95_ms"] * 1.2
    if current["p95_ms"] > allowed:
        raise SystemExit(
            f"Benchmark regression: p95 {current['p95_ms']:.2f}ms exceeds allowed {allowed:.2f}ms"
        )
    print(
        f"Benchmark OK: p95={current['p95_ms']:.2f}ms baseline={baseline['p95_ms']:.2f}ms"
    )


if __name__ == "__main__":
    main()
