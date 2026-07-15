"""Calendar interval semantics and availability checks."""

from __future__ import annotations

from dataclasses import dataclass

from fuelflow.resources.models import CalendarWindow, Resource


@dataclass(frozen=True)
class TimeInterval:
    from_min: float
    to_min: float


def normalize_windows(
    windows: list[CalendarWindow],
    horizon_min: float,
) -> list[TimeInterval]:
    """Merge overlapping windows into sorted non-overlapping half-open intervals.

    Empty calendar means full-horizon availability.
    """
    if not windows:
        return [TimeInterval(0.0, horizon_min)]

    raw = sorted((float(w.from_min), float(w.to_min)) for w in windows)
    merged: list[TimeInterval] = []
    for start, end in raw:
        if start >= end:
            continue
        if not merged or start > merged[-1].to_min:
            merged.append(TimeInterval(start, end))
        else:
            merged[-1] = TimeInterval(merged[-1].from_min, max(merged[-1].to_min, end))
    return merged


def interval_fits_in_availability(
    start_min: float,
    end_min: float,
    availability: list[TimeInterval],
) -> bool:
    """Return True when half-open [start_min, end_min) is fully covered by availability."""
    if start_min >= end_min:
        return False
    if not availability:
        return False

    pos = start_min
    idx = 0
    while pos < end_min:
        found = False
        while idx < len(availability):
            window = availability[idx]
            if window.from_min <= pos < window.to_min:
                pos = min(end_min, window.to_min)
                found = True
                break
            if window.to_min <= pos:
                idx += 1
                continue
            break
        if not found:
            return False
    return True


def build_resource_availability_cache(
    resources: list[Resource],
    horizon_min: float,
) -> dict[str, list[TimeInterval]]:
    return {resource.id: normalize_windows(resource.calendar, horizon_min) for resource in resources}
