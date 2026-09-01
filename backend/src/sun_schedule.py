"""Daily sunrise/sunset for ASU Tempe, from Open-Meteo with a local fallback."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import pytz
import requests

logger = logging.getLogger("uvicorn.error")

CAMPUS_LAT = 33.4242
CAMPUS_LON = -111.9281
TZ = pytz.timezone("America/Phoenix")
_CACHE: dict[str, dict[str, Any]] = {}


def _hours(dt: datetime) -> float:
    local = dt.astimezone(TZ)
    return local.hour + local.minute / 60 + local.second / 3600


def _fallback_window(day: datetime, shadow_calc: Any) -> dict[str, Any]:
    """Find first and last minutes with the sun above the horizon."""
    start = TZ.localize(datetime(day.year, day.month, day.day))
    sunrise_hour = 6.0
    sunset_hour = 18.5
    seen_up = False
    for minute in range(0, 24 * 60, 5):
        sample = start + timedelta(minutes=minute)
        _, elevation = shadow_calc.get_sun_position(sample)
        hour = minute / 60
        if elevation > 0 and not seen_up:
            sunrise_hour = hour
            seen_up = True
        if seen_up and elevation <= 0:
            sunset_hour = hour
            break
    return {
        "sunrise_hour": sunrise_hour,
        "sunset_hour": sunset_hour,
        "source": "solar-position",
    }


def day_sun_window(day: datetime, shadow_calc: Any) -> dict[str, Any]:
    local_day = day.astimezone(TZ)
    key = local_day.strftime("%Y-%m-%d")
    cached = _CACHE.get(key)
    if cached is not None:
        return cached

    window: dict[str, Any]
    try:
        params: dict[str, str | float] = {
            "latitude": CAMPUS_LAT,
            "longitude": CAMPUS_LON,
            "daily": "sunrise,sunset",
            "timezone": "America/Phoenix",
            "start_date": key,
            "end_date": key,
        }
        response = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params=params,
            timeout=8,
        )
        response.raise_for_status()
        daily = response.json().get("daily") or {}
        sunrise_raw = (daily.get("sunrise") or [None])[0]
        sunset_raw = (daily.get("sunset") or [None])[0]
        if not sunrise_raw or not sunset_raw:
            raise ValueError("Open-Meteo sunrise/sunset missing")
        sunrise = datetime.fromisoformat(sunrise_raw)
        sunset = datetime.fromisoformat(sunset_raw)
        if sunrise.tzinfo is None:
            sunrise = TZ.localize(sunrise)
        if sunset.tzinfo is None:
            sunset = TZ.localize(sunset)
        window = {
            "sunrise_hour": _hours(sunrise),
            "sunset_hour": _hours(sunset),
            "source": "open-meteo",
        }
    except Exception:
        logger.exception("Open-Meteo sunrise/sunset failed for %s", key)
        window = _fallback_window(local_day, shadow_calc)

    payload = {
        "date": key,
        "sunrise": _clock(window["sunrise_hour"]),
        "sunset": _clock(window["sunset_hour"]),
        "sunrise_hour": float(window["sunrise_hour"]),
        "sunset_hour": float(window["sunset_hour"]),
        "source": window["source"],
    }
    _CACHE[key] = payload
    return payload


def sun_is_down(hour: float, window: dict[str, Any]) -> bool:
    return hour < float(window["sunrise_hour"]) or hour >= float(window["sunset_hour"])


def _clock(hour_float: float) -> str:
    total = int(round(hour_float * 60)) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"
