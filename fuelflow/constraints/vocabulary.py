"""Closed constraint vocabulary and evaluators."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ConstraintType = Literal[
    "capacity",
    "thermal",
    "temporal",
    "resource",
    "precedence",
    "regulatory",
]

ALLOWED_CONSTRAINT_TYPES = frozenset({
    "capacity",
    "thermal",
    "temporal",
    "resource",
    "precedence",
    "regulatory",
})


class Constraint(BaseModel):
    id: str
    scope: Literal["node", "edge", "resource", "path", "global"]
    target: str
    type: ConstraintType
    predicate: dict[str, Any] = Field(default_factory=dict)
    hard: bool = True
    params: dict[str, Any] = Field(default_factory=dict)


class Violation(BaseModel):
    rule_id: str
    constraint_id: str
    scope: str
    target: str
    hard: bool
    message: str
    entity_ids: list[str] = Field(default_factory=list)
    t_min: float | None = None
    reason_code: str | None = None


def evaluate_constraint(
    constraint: Constraint,
    *,
    t_min: float,
    node_occupancy: dict[str, list[str]],
    resource_usage: dict[str, int],
    entity_heat: dict[str, float],
    move_active: dict[str, bool] | None = None,
) -> Violation | None:
    params = constraint.params
    move_active = move_active or {}

    if constraint.type == "capacity":
        limit = int(params.get("max_entities", 0))
        occupants = node_occupancy.get(constraint.target, [])
        if len(occupants) > limit:
            return Violation(
                rule_id="C-capacity",
                constraint_id=constraint.id,
                scope=constraint.scope,
                target=constraint.target,
                hard=constraint.hard,
                message=f"Node {constraint.target} exceeds capacity {limit}",
                entity_ids=list(occupants),
                t_min=t_min,
            )

    if constraint.type == "thermal":
        limit_kw = float(params.get("max_heat_kw", 0))
        total = sum(entity_heat.get(eid, 0.0) for eid in node_occupancy.get(constraint.target, []))
        if total > limit_kw:
            return Violation(
                rule_id="C-thermal",
                constraint_id=constraint.id,
                scope=constraint.scope,
                target=constraint.target,
                hard=constraint.hard,
                message=f"Thermal limit exceeded at {constraint.target}: {total:.2f} > {limit_kw}",
                entity_ids=node_occupancy.get(constraint.target, []),
                t_min=t_min,
            )

    if constraint.type == "temporal":
        earliest = float(params.get("earliest_min", 0))
        latest = float(params.get("latest_min", float("inf")))
        if t_min < earliest or t_min > latest:
            return Violation(
                rule_id="C-temporal",
                constraint_id=constraint.id,
                scope=constraint.scope,
                target=constraint.target,
                hard=constraint.hard,
                message=f"Time {t_min} outside [{earliest}, {latest}]",
                t_min=t_min,
            )

    if constraint.type == "resource":
        limit = int(params.get("max_concurrent", 1))
        used = resource_usage.get(constraint.target, 0)
        if used > limit:
            return Violation(
                rule_id="C-resource",
                constraint_id=constraint.id,
                scope=constraint.scope,
                target=constraint.target,
                hard=constraint.hard,
                message=f"Resource {constraint.target} concurrent use {used} > {limit}",
                t_min=t_min,
            )

    if constraint.type == "precedence":
        before = params.get("before_move")
        after = params.get("after_move")
        if before and after and move_active.get(after) and not move_active.get(before):
            return Violation(
                rule_id="C-precedence",
                constraint_id=constraint.id,
                scope=constraint.scope,
                target=constraint.target,
                hard=constraint.hard,
                message=f"Move {after} started before prerequisite {before}",
                t_min=t_min,
            )

    if constraint.type == "regulatory":
        min_cooling = float(params.get("min_cooling_min", 0))
        required = float(params.get("required_cooling_min", 0))
        if required < min_cooling:
            return Violation(
                rule_id="C-regulatory",
                constraint_id=constraint.id,
                scope=constraint.scope,
                target=constraint.target,
                hard=constraint.hard,
                message=f"Regulatory cooling {required} < minimum {min_cooling}",
                t_min=t_min,
            )

    return None
