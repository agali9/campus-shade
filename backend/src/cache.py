"""Route query caching with Redis and in-memory fallback."""

from __future__ import annotations

import json
import os
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from redis import Redis


@dataclass
class CacheEntry:
    value: Any
    expires_at: float


class RouteCache:
    """Two-tier route cache.

    Staleness tradeoff: quantized origin/destination/time buckets improve hit rate for
    near-identical queries,
    but can return slightly different routes than exact-point recomputation.
    """

    def __init__(self, max_items: int = 5000, ttl_seconds: int = 300) -> None:
        self.max_items = max_items
        self.ttl_seconds = ttl_seconds
        self._memory: OrderedDict[str, CacheEntry] = OrderedDict()
        self._redis: Redis[str] | None = None
        redis_url = os.getenv("REDIS_URL")
        if redis_url:
            try:
                client: Redis[str] = Redis.from_url(redis_url, decode_responses=True)
                client.ping()
                self._redis = client
            except Exception:
                self._redis = None

    @staticmethod
    def quantize(value: float, precision: float) -> float:
        return round(value / precision) * precision

    def key(
        self,
        start_lat: float,
        start_lon: float,
        end_lat: float,
        end_lon: float,
        minutes: int,
        optimize_for: str = "shade",
        shade_weight: float = 0.7,
        day_of_year: int = 180,
    ) -> str:
        s_lat = self.quantize(start_lat, 0.0005)
        s_lon = self.quantize(start_lon, 0.0005)
        e_lat = self.quantize(end_lat, 0.0005)
        e_lon = self.quantize(end_lon, 0.0005)
        time_bucket = int(minutes / 5) * 5
        weight_bucket = self.quantize(shade_weight, 0.05)
        return (
            f"{s_lat}:{s_lon}:{e_lat}:{e_lon}:{time_bucket}:"
            f"{day_of_year}:{optimize_for}:{weight_bucket}"
        )

    def get(self, key: str) -> Any | None:
        now = time.time()
        if self._redis:
            raw = self._redis.get(key)
            if raw:
                return json.loads(raw)

        entry = self._memory.get(key)
        if not entry:
            return None
        if entry.expires_at < now:
            self._memory.pop(key, None)
            return None
        self._memory.move_to_end(key)
        return entry.value

    def set(self, key: str, value: Any) -> None:
        if self._redis:
            self._redis.setex(key, self.ttl_seconds, json.dumps(value))
            return
        now = time.time()
        self._memory[key] = CacheEntry(value=value, expires_at=now + self.ttl_seconds)
        self._memory.move_to_end(key)
        while len(self._memory) > self.max_items:
            self._memory.popitem(last=False)
