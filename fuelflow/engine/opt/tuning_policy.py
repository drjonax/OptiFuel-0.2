"""Optimization tuning policy interface and validation."""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field

from fuelflow.engine.opt.locks import constraint_applicability, matrix_row_ids, tunable_params_for
from fuelflow.scenario.model import Scenario, Schedule


class TunableParamRef(BaseModel):
    entity_id: str
    constraint_id: str
    param_name: str


class TuningPolicy(BaseModel):
    allow_tunable_params: list[TunableParamRef] = Field(default_factory=list)


@dataclass(frozen=True)
class TuningResolution:
    source: str
    allow_tunable_params: list[TunableParamRef]
    allowed_constraint_params: set[tuple[str, str]]


def _normalize_entries(entries: list[TunableParamRef]) -> list[TunableParamRef]:
    deduped = {
        (entry.entity_id, entry.constraint_id, entry.param_name): entry
        for entry in entries
    }
    ordered = sorted(deduped.values(), key=lambda item: (item.entity_id, item.constraint_id, item.param_name))
    return ordered


def all_tunable_param_entries(scenario: Scenario, schedule: Schedule | None) -> list[TunableParamRef]:
    rows = matrix_row_ids(scenario)
    entries: list[TunableParamRef] = []
    for entity_id in rows:
        for constraint in scenario.constraints:
            if not constraint_applicability(scenario, schedule, entity_id, constraint):
                continue
            for param_name in tunable_params_for(constraint):
                entries.append(
                    TunableParamRef(
                        entity_id=entity_id,
                        constraint_id=constraint.id,
                        param_name=param_name,
                    ),
                )
    return _normalize_entries(entries)


def validate_tuning_policy(policy: TuningPolicy, scenario: Scenario, schedule: Schedule | None) -> None:
    rows = set(matrix_row_ids(scenario))
    constraints = {constraint.id: constraint for constraint in scenario.constraints}
    errors: list[str] = []

    for entry in _normalize_entries(policy.allow_tunable_params):
        if entry.entity_id not in rows:
            errors.append(f"unknown entity_id in tuning_policy: {entry.entity_id}")
            continue
        constraint = constraints.get(entry.constraint_id)
        if constraint is None:
            errors.append(f"unknown constraint_id in tuning_policy: {entry.constraint_id}")
            continue
        if not constraint_applicability(scenario, schedule, entry.entity_id, constraint):
            errors.append(
                f"tuning_policy pair not applicable: {entry.entity_id}/{entry.constraint_id}",
            )
            continue
        tunable_params = set(tunable_params_for(constraint))
        if entry.param_name not in tunable_params:
            errors.append(
                f"param not tunable for constraint {entry.constraint_id}: {entry.param_name}",
            )

    if errors:
        raise ValueError("; ".join(sorted(set(errors))))


def resolve_tuning_policy(
    policy: TuningPolicy | None,
    scenario: Scenario,
    schedule: Schedule | None,
) -> TuningResolution:
    if policy is None:
        allowed_entries = all_tunable_param_entries(scenario, schedule)
        source = "default_all_tunable_params"
    else:
        validate_tuning_policy(policy, scenario, schedule)
        allowed_entries = _normalize_entries(policy.allow_tunable_params)
        source = "allowlist"

    allowed_constraint_params = {(entry.constraint_id, entry.param_name) for entry in allowed_entries}
    return TuningResolution(
        source=source,
        allow_tunable_params=allowed_entries,
        allowed_constraint_params=allowed_constraint_params,
    )


def allows_tuning(
    resolution: TuningResolution | None,
    *,
    constraint_id: str,
    param_name: str,
) -> bool:
    if resolution is None:
        return True
    return (constraint_id, param_name) in resolution.allowed_constraint_params


