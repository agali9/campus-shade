"""Structured logging, metrics, and tracing helpers."""

from __future__ import annotations

import logging
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any, cast

import structlog
from fastapi import Request, Response
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.responses import Response as StarletteResponse

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")
tracer = trace.get_tracer("campusshade.route")

REQUEST_COUNT = Counter(
    "campusshade_requests_total",
    "Total request count",
    ["path", "method", "status"],
)
REQUEST_LATENCY = Histogram(
    "campusshade_request_latency_seconds",
    "Request latency",
    ["path", "method"],
)
ROUTE_DISTANCE = Histogram("campusshade_route_distance_meters", "Route distance distribution")
CACHE_HIT_RATE = Counter("campusshade_route_cache_total", "Route cache events", ["result"])


def setup_logging() -> None:
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            structlog.processors.JSONRenderer(),
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    )


def setup_tracing() -> None:
    provider = TracerProvider()
    if os.getenv("ENABLE_CONSOLE_TRACING", "0") == "1":
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)


async def metrics_endpoint() -> StarletteResponse:
    return StarletteResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)


async def request_middleware(
    request: Request,
    call_next: Callable[..., Awaitable[Any]],
) -> Response:
    request_id = str(uuid.uuid4())
    request_id_ctx.set(request_id)
    start = time.perf_counter()
    with tracer.start_as_current_span("http_request") as span:
        span.set_attribute("http.path", request.url.path)
        span.set_attribute("request.id", request_id)
        response = await call_next(request)
    elapsed = time.perf_counter() - start
    REQUEST_COUNT.labels(
        path=request.url.path,
        method=request.method,
        status=str(response.status_code),
    ).inc()
    REQUEST_LATENCY.labels(path=request.url.path, method=request.method).observe(elapsed)
    response.headers["X-Request-ID"] = request_id
    return cast(Response, response)
