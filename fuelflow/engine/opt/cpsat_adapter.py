"""Minimal CP-SAT optimizer adapter."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from fuelflow.engine.sim.simulator import simulate
from fuelflow.objectives.scoring import score_objective
from fuelflow.scenario.model import Move, Scenario, Schedule

try:
    from ortools.sat.python import cp_model
except ImportError:  # pragma: no cover
    cp_model = None


class OptimizerResult(BaseModel):
    outcome: Literal["feasible", "infeasible_or_timeout"]
    reason: Literal["infeasible", "timeout"] | None = None
    schedule: Schedule | None = None
    score_total: float | None = None


def optimize(
    scenario: Scenario,
    *,
    seed: int = 42,
    time_limit_sec: float = 5.0,
    seed_schedule: Schedule | None = None,
) -> OptimizerResult:
    if cp_model is None:
        return OptimizerResult(outcome="infeasible_or_timeout", reason="infeasible")

    edges = scenario.topology.edges
    entities = [e.id for e in scenario.entities] + [a.entity_id for a in scenario.arrivals]
    if not entities or not edges:
        return OptimizerResult(outcome="infeasible_or_timeout", reason="infeasible")

    model = cp_model.CpModel()
    horizon = int(scenario.horizon_min)
    start_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    presence_vars: dict[tuple[str, str], cp_model.IntVar] = {}

    for entity in sorted(entities):
        for edge in edges:
            key = (entity, edge.id)
            start = model.NewIntVar(0, horizon, f"start_{entity}_{edge.id}")
            presence = model.NewBoolVar(f"present_{entity}_{edge.id}")
            start_vars[key] = start
            presence_vars[key] = presence
            duration = int(edge.duration_min.base_min)
            interval = model.NewOptionalIntervalVar(
                start, duration, start + duration, presence, f"interval_{entity}_{edge.id}"
            )
            for resource in edge.requires:
                resource_edges = [e for e in edges if resource in e.requires]
                intervals = []
                for re in resource_edges:
                    rk = (entity, re.id)
                    if rk in presence_vars:
                        d = int(re.duration_min.base_min)
                        s = start_vars[rk]
                        intervals.append(model.NewOptionalIntervalVar(s, d, s + d, presence_vars[rk], ""))
                cap = next((r.capacity for r in scenario.resources if r.id == resource), 1)
                if intervals:
                    model.AddCumulative(intervals, [1] * len(intervals), cap)

    # at most one move per entity
    for entity in entities:
        model.Add(sum(presence_vars[(entity, e.id)] for e in edges) <= 1)

    model.Minimize(
        sum(presence_vars[(entity, e.id)] * int(e.duration_min.base_min) for entity in entities for e in edges)
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_sec
    solver.parameters.random_seed = seed
    solver.parameters.num_search_workers = 1

    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        reason = "timeout" if status == cp_model.UNKNOWN else "infeasible"
        return OptimizerResult(outcome="infeasible_or_timeout", reason=reason)

    moves: list[Move] = []
    for entity in sorted(entities):
        for edge in edges:
            key = (entity, edge.id)
            if solver.Value(presence_vars[key]) == 1:
                moves.append(Move(entity=entity, edge=edge.id, start_min=float(solver.Value(start_vars[key]))))

    schedule = Schedule(schema_version=4, scenario=scenario.id, moves=moves)
    sim = simulate(scenario, schedule, runtime_mode="fail_fast")
    if sim.failed:
        return OptimizerResult(outcome="infeasible_or_timeout", reason="infeasible")

    objective = score_objective(sim, scenario.objective)
    return OptimizerResult(outcome="feasible", schedule=schedule, score_total=objective.total)
