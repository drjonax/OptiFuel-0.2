"""Layer-neutral objective input metrics."""

from __future__ import annotations

from pydantic import BaseModel


class ObjectiveMetrics(BaseModel):
    outage_duration_min: float
    peak_storage_heat_kw: float
    handling_ops_count: int
