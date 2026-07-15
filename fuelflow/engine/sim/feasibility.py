"""Simulation feasibility outcome mapping."""

from __future__ import annotations

from typing import Literal

from fuelflow.constraints.vocabulary import Violation

InfeasibleCategory = Literal[
    "resource_calendar_blocked",
    "resource_capacity_exceeded",
    "entity_overlap",
    "entity_location_mismatch",
    "unit_mode_forbidden",
    "constraint_violation_other",
]

CATEGORY_PRECEDENCE: dict[str, int] = {
    "resource_calendar_blocked": 0,
    "resource_capacity_exceeded": 1,
    "entity_overlap": 2,
    "entity_location_mismatch": 3,
    "unit_mode_forbidden": 4,
    "constraint_violation_other": 5,
}


def infer_reason_code(violation: Violation) -> InfeasibleCategory:
    reason_code = getattr(violation, "reason_code", None)
    if reason_code:
        return reason_code  # type: ignore[return-value]
    message = violation.message.lower()
    if "calendar" in message or "blackout" in message or "availability" in message:
        return "resource_calendar_blocked"
    if "capacity exceeded" in message or "concurrent use" in message:
        return "resource_capacity_exceeded"
    if "overlap" in message or "already active" in message:
        return "entity_overlap"
    if "expected" in message and "entity at" in message:
        return "entity_location_mismatch"
    if "unit mode" in message or "refueling" in message:
        return "unit_mode_forbidden"
    return "constraint_violation_other"


def derive_infeasible_category(violations: list[Violation]) -> InfeasibleCategory | None:
    hard = [v for v in violations if v.hard]
    if not hard:
        return None

    def sort_key(violation: Violation) -> tuple[float, int, str]:
        t_min = violation.t_min if violation.t_min is not None else float("inf")
        code = infer_reason_code(violation)
        return (t_min, CATEGORY_PRECEDENCE.get(code, 999), code)

    selected = min(hard, key=sort_key)
    return infer_reason_code(selected)


def map_simulation_outcome(*, failed: bool, violations: list[Violation]) -> dict[str, str | None]:
    if not failed:
        return {"outcome": "feasible", "reason": None, "infeasible_category": None}
    return {
        "outcome": "infeasible_or_timeout",
        "reason": "infeasible",
        "infeasible_category": derive_infeasible_category(violations),
    }
