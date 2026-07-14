"""Weighted objective scoring."""

from __future__ import annotations

from pydantic import BaseModel

from fuelflow.engine.sim.simulator import SimulationResult
from fuelflow.scenario.model import ObjectiveConfig


class ObjectiveBreakdown(BaseModel):
    metric: str
    raw_value: float
    normalized_value: float
    weight: float
    weighted_value: float


class ObjectiveScore(BaseModel):
    total: float
    terms: list[ObjectiveBreakdown]


def _normalize(metric: str, raw: float, normalise: dict) -> float:
    if "ref" in normalise:
        ref = float(normalise["ref"])
        return raw / ref if ref else 0.0
    if "range" in normalise:
        low, high = normalise["range"]
        span = float(high) - float(low)
        return (raw - float(low)) / span if span else 0.0
    return raw


def metric_value(metric: str, sim: SimulationResult) -> float:
    if metric == "outage_duration_h":
        return sim.outage_duration_min / 60.0
    if metric == "peak_storage_heat_kw":
        return sim.peak_storage_heat_kw
    if metric == "handling_ops_count":
        return float(sim.handling_ops_count)
    return 0.0


def score_objective(sim: SimulationResult, config: ObjectiveConfig) -> ObjectiveScore:
    terms: list[ObjectiveBreakdown] = []
    total = 0.0
    for term in sorted(config.terms, key=lambda t: t.metric):
        raw = metric_value(term.metric, sim)
        normalized = round(_normalize(term.metric, raw, term.normalise), 10)
        weighted = round(normalized * term.weight, 10)
        total = round(total + weighted, 10)
        terms.append(
            ObjectiveBreakdown(
                metric=term.metric,
                raw_value=raw,
                normalized_value=normalized,
                weight=term.weight,
                weighted_value=weighted,
            )
        )
    return ObjectiveScore(total=total, terms=terms)
