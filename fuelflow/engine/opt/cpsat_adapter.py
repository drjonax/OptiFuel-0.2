"""Minimal CP-SAT optimizer adapter."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from fuelflow.engine.opt.locks import (
    LockResolution,
    OptimizeLockContract,
    _seed_move_keys,
    canonical_entity_move_keys,
    default_lock_contract,
    index_seed_moves,
    locked_start_fields,
    resource_baseline_capacity,
    resolve_lock_state,
)
from fuelflow.engine.sim.simulator import simulate
from fuelflow.objectives.scoring import score_objective
from fuelflow.scenario.model import Move, Scenario, Schedule

try:
    from ortools.sat.python import cp_model
except ImportError:  # pragma: no cover
    cp_model = None

EXECUTION_MODE_TIMING_PRESERVE = "timing_preserve_structure"


class OptimizerResult(BaseModel):
    outcome: Literal["feasible", "infeasible_or_timeout"]
    reason: Literal["infeasible", "timeout", "structure_violation"] | None = None
    schedule: Schedule | None = None
    score_total: float | None = None
    tuned_constraint_params: dict[str, dict[str, int | float]] = Field(default_factory=dict)
    execution_mode: str | None = None


def _build_model_bounds(
    scenario: Scenario,
    model: cp_model.CpModel,
    resolution: LockResolution | None,
) -> tuple[int, int | cp_model.IntVar, dict[str, dict[str, int | float]], dict[str, cp_model.IntVar]]:
    """Return earliest, latest cap (int or decision var), tuned metadata, slack vars by constraint id."""
    horizon = int(scenario.horizon_min)
    earliest = 0
    tuned: dict[str, dict[str, int | float]] = {}
    slack_by_constraint: dict[str, cp_model.IntVar] = {}
    temporal_constraints = [c for c in scenario.constraints if c.type == "temporal" and c.hard]

    if not temporal_constraints:
        return earliest, horizon, tuned, slack_by_constraint

    locked_latest = horizon
    unlocked_present = False
    for constraint in temporal_constraints:
        base_earliest = int(float(constraint.params.get("earliest_min", 0)))
        base_latest = int(float(constraint.params.get("latest_min", horizon)))
        earliest = max(earliest, base_earliest)
        locked = resolution.effective_constraint_locks.get(constraint.id, True) if resolution else True
        if locked:
            locked_latest = min(locked_latest, base_latest)
        else:
            unlocked_present = True
            max_slack = max(120, int(base_latest * 0.1))
            slack = model.NewIntVar(0, max_slack, f"temporal_slack_{constraint.id}")
            slack_by_constraint[constraint.id] = slack
            tuned.setdefault(constraint.id, {})["latest_min"] = base_latest

    if not unlocked_present:
        return earliest, min(locked_latest, horizon), tuned, slack_by_constraint

    global_latest = model.NewIntVar(0, horizon, "global_latest_cap")
    model.Add(global_latest <= horizon)
    if locked_latest < horizon:
        model.Add(global_latest <= locked_latest)
    for constraint in temporal_constraints:
        base_latest = int(float(constraint.params.get("latest_min", horizon)))
        locked = resolution.effective_constraint_locks.get(constraint.id, True) if resolution else True
        if locked:
            model.Add(global_latest <= base_latest)
        elif constraint.id in slack_by_constraint:
            slack = slack_by_constraint[constraint.id]
            model.Add(global_latest <= base_latest + slack)

    return earliest, global_latest, tuned, slack_by_constraint


def _latest_start_ub(
    earliest: int,
    latest_cap: int | cp_model.IntVar,
    duration: int,
    horizon: int,
) -> tuple[int, cp_model.IntVar | None]:
    """Upper bound for start var creation; optional constraint when latest_cap is a var."""
    if isinstance(latest_cap, int):
        return max(earliest, latest_cap - duration), None
    ub = max(earliest, horizon - duration)
    return ub, latest_cap


def _resource_capacity_vars(
    model: cp_model.CpModel,
    scenario: Scenario,
    resolution: LockResolution | None,
    tuned: dict[str, dict[str, int | float]],
) -> dict[str, cp_model.IntVar | int]:
    capacities: dict[str, cp_model.IntVar | int] = {}
    resource_constraints = {
        c.target: c for c in scenario.constraints if c.type == "resource"
    }
    for resource in scenario.resources:
        baseline = resource_baseline_capacity(scenario, resource.id)
        constraint = resource_constraints.get(resource.id)
        locked = True
        if constraint and resolution:
            locked = resolution.effective_constraint_locks.get(constraint.id, True)
        if locked or constraint is None:
            capacities[resource.id] = baseline
        else:
            upper = max(baseline + 1, baseline)
            cap_var = model.NewIntVar(baseline, upper, f"resource_cap_{resource.id}")
            capacities[resource.id] = cap_var
            tuned.setdefault(constraint.id, {})["max_concurrent"] = baseline
    return capacities


def _add_resource_cumulative(
    model: cp_model.CpModel,
    scenario: Scenario,
    edges,
    start_vars: dict[tuple[str, str, int], cp_model.IntVar],
    presence_or_fixed: dict[tuple[str, str, int], cp_model.IntVar | int],
    resource_capacities: dict[str, cp_model.IntVar | int],
) -> None:
    edge_map = {edge.id: edge for edge in edges}
    resources = {resource.id for resource in scenario.resources}
    for resource in sorted(resources):
        intervals = []
        demands = []
        for key, start in start_vars.items():
            _, edge_id, _ = key
            edge = edge_map.get(edge_id)
            if edge is None or resource not in edge.requires:
                continue
            duration = int(edge.duration_min.base_min)
            presence = presence_or_fixed.get(key, 0)
            if isinstance(presence, int):
                if presence == 0:
                    continue
                interval = model.NewFixedSizeIntervalVar(start, duration, f"fixed_{resource}_{key}")
            else:
                interval = model.NewOptionalIntervalVar(
                    start, duration, start + duration, presence, f"interval_{resource}_{key}"
                )
            intervals.append(interval)
            demands.append(1)
        cap = resource_capacities.get(resource, 1)
        if intervals:
            model.AddCumulative(intervals, demands, cap)


def _add_entity_order_constraints(
    model: cp_model.CpModel,
    edge_map: dict,
    start_vars: dict[tuple[str, str, int], cp_model.IntVar],
    canonical_sequences: dict[str, list[tuple[str, str, int]]],
) -> None:
    for move_keys in canonical_sequences.values():
        for idx in range(len(move_keys) - 1):
            prev_key = move_keys[idx]
            next_key = move_keys[idx + 1]
            if prev_key not in start_vars or next_key not in start_vars:
                continue
            prev_edge = edge_map[prev_key[1]]
            duration = int(prev_edge.duration_min.base_min)
            model.Add(start_vars[next_key] >= start_vars[prev_key] + duration)


def _add_node_capacity_cumulative(
    model: cp_model.CpModel,
    scenario: Scenario,
    seed_schedule: Schedule,
    edge_map: dict,
    start_vars: dict[tuple[str, str, int], cp_model.IntVar],
    canonical_sequences: dict[str, list[tuple[str, str, int]]],
    horizon: int,
) -> None:
    capacity_nodes = {
        c.target: int(c.params.get("max_entities", 0))
        for c in scenario.constraints
        if c.type == "capacity" and c.scope == "node" and c.hard
    }
    if not capacity_nodes:
        return

    entity_locations = {entity.id: entity.location for entity in scenario.entities}
    departures = {departure.entity_id: int(departure.t_min) for departure in scenario.departures}

    for node_id, cap in capacity_nodes.items():
        intervals: list = []
        demands: list[int] = []

        for entity, move_keys in sorted(canonical_sequences.items()):
            initial = entity_locations.get(entity)
            moves_info: list[tuple[tuple[str, str, int], object, int]] = []
            for key in move_keys:
                if key not in start_vars:
                    continue
                edge = edge_map[key[1]]
                duration = int(edge.duration_min.base_min)
                moves_info.append((key, edge, duration))

            if not moves_info:
                if initial == node_id:
                    end_t = departures.get(entity, horizon)
                    if end_t > 0:
                        intervals.append(
                            model.NewIntervalVar(0, end_t, end_t, f"nodecap_{node_id}_{entity}_init_only"),
                        )
                        demands.append(1)
                continue

            if initial == node_id:
                first_start = start_vars[moves_info[0][0]]
                intervals.append(
                    model.NewIntervalVar(0, first_start, first_start, f"nodecap_{node_id}_{entity}_init"),
                )
                demands.append(1)

            for idx, (key, edge, duration) in enumerate(moves_info):
                start = start_vars[key]
                end = model.NewIntVar(0, horizon, f"nodecap_end_{entity}_{edge.id}_{idx}")
                model.Add(end == start + duration)

                if edge.from_node == node_id:
                    intervals.append(
                        model.NewIntervalVar(start, duration, end, f"nodecap_{node_id}_{entity}_transit_{idx}"),
                    )
                    demands.append(1)

                if edge.to_node == node_id:
                    if idx + 1 < len(moves_info):
                        next_start = start_vars[moves_info[idx + 1][0]]
                        dwell_size = model.NewIntVar(0, horizon, f"nodecap_dwell_size_{entity}_{node_id}_{idx}")
                        model.Add(dwell_size == next_start - end)
                        intervals.append(
                            model.NewIntervalVar(end, dwell_size, next_start, f"nodecap_{node_id}_{entity}_dwell_{idx}"),
                        )
                        demands.append(1)
                    else:
                        final_end = departures.get(entity, horizon)
                        dwell_size = model.NewIntVar(0, horizon, f"nodecap_dwell_final_size_{entity}_{node_id}")
                        model.Add(dwell_size == final_end - end)
                        final_end_var = model.NewIntVar(0, horizon, f"nodecap_dwell_final_end_{entity}_{node_id}")
                        model.Add(final_end_var == final_end)
                        intervals.append(
                            model.NewIntervalVar(
                                end,
                                dwell_size,
                                final_end_var,
                                f"nodecap_{node_id}_{entity}_dwell_final",
                            ),
                        )
                        demands.append(1)

        if intervals:
            model.AddCumulative(intervals, demands, cap)


def _collect_tuned_values(
    solver: cp_model.CpSolver,
    tuned: dict[str, dict[str, int | float]],
    resource_capacities: dict[str, cp_model.IntVar | int],
    slack_by_constraint: dict[str, cp_model.IntVar],
    scenario: Scenario,
) -> dict[str, dict[str, int | float]]:
    out: dict[str, dict[str, int | float]] = {}
    for constraint in scenario.constraints:
        if constraint.type == "resource" and constraint.id in tuned:
            cap = resource_capacities.get(constraint.target)
            if isinstance(cap, cp_model.IntVar):
                out[constraint.id] = {"max_concurrent": float(solver.Value(cap))}
        if constraint.type == "temporal" and constraint.id in tuned:
            base_latest = float(tuned[constraint.id].get("latest_min", scenario.horizon_min))
            slack = slack_by_constraint.get(constraint.id)
            if slack is not None:
                out[constraint.id] = {"latest_min": base_latest + float(solver.Value(slack))}
            else:
                out[constraint.id] = dict(tuned[constraint.id])
    return out


def _optimize_legacy(
    scenario: Scenario,
    *,
    seed: int,
    time_limit_sec: float,
    seed_schedule: Schedule | None,
    contract: OptimizeLockContract,
    resolution: LockResolution | None,
) -> OptimizerResult:
    """Internal-only structure-search path; not used by API-facing optimize()."""
    edges = scenario.topology.edges
    entities = [e.id for e in scenario.entities] + [a.entity_id for a in scenario.arrivals]
    if not entities or not edges:
        return OptimizerResult(outcome="infeasible_or_timeout", reason="infeasible")

    model = cp_model.CpModel()
    earliest, latest_cap, tuned, slack_by = _build_model_bounds(scenario, model, resolution)
    resource_capacities = _resource_capacity_vars(model, scenario, resolution, tuned)
    start_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    presence_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    horizon = int(scenario.horizon_min)

    seed_starts: dict[tuple[str, str], float] = {}
    if seed_schedule:
        for entity, edge, _occ, start in index_seed_moves(seed_schedule):
            seed_starts[(entity, edge)] = start

    locked_starts = locked_start_fields(contract) if contract.active else set()

    for entity in sorted(entities):
        for edge in edges:
            key = (entity, edge.id)
            duration = int(edge.duration_min.base_min)
            ub, latest_var = _latest_start_ub(earliest, latest_cap, duration, horizon)
            start = model.NewIntVar(earliest, ub, f"start_{entity}_{edge.id}")
            if latest_var is not None:
                model.Add(start + duration <= latest_var)
            presence = model.NewBoolVar(f"present_{entity}_{edge.id}")
            start_vars[key] = start
            presence_vars[key] = presence
            model.NewOptionalIntervalVar(start, duration, start + duration, presence, f"interval_{entity}_{edge.id}")

            lock_key = (entity, edge.id, 0)
            if lock_key in locked_starts and (entity, edge.id) in seed_starts:
                model.Add(start == int(seed_starts[(entity, edge.id)]))

    for entity in entities:
        model.Add(sum(presence_vars[(entity, e.id)] for e in edges) <= 1)

    keyed_starts: dict[tuple[str, str, int], cp_model.IntVar] = {}
    keyed_presence: dict[tuple[str, str, int], cp_model.IntVar | int] = {}
    for (entity, edge_id), start in start_vars.items():
        key = (entity, edge_id, 0)
        keyed_starts[key] = start
        keyed_presence[key] = presence_vars[(entity, edge_id)]
    _add_resource_cumulative(model, scenario, edges, keyed_starts, keyed_presence, resource_capacities)

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
    tuned_values = _collect_tuned_values(solver, tuned, resource_capacities, slack_by, scenario)
    return OptimizerResult(
        outcome="feasible",
        schedule=schedule,
        score_total=objective.total,
        tuned_constraint_params=tuned_values,
    )


def _optimize_structure_locked(
    scenario: Scenario,
    seed_schedule: Schedule,
    *,
    seed: int,
    time_limit_sec: float,
    contract: OptimizeLockContract,
    resolution: LockResolution | None,
) -> OptimizerResult:
    edges = scenario.topology.edges
    edge_map = {edge.id: edge for edge in edges}
    indexed = index_seed_moves(seed_schedule)
    if not indexed:
        return OptimizerResult(outcome="infeasible_or_timeout", reason="infeasible")

    canonical_sequences = canonical_entity_move_keys(seed_schedule)

    model = cp_model.CpModel()
    earliest, latest_cap, tuned, slack_by = _build_model_bounds(scenario, model, resolution)
    resource_capacities = _resource_capacity_vars(model, scenario, resolution, tuned)
    locked = locked_start_fields(contract) if contract.active else set()
    start_vars: dict[tuple[str, str, int], cp_model.IntVar] = {}
    horizon = int(scenario.horizon_min)

    for entity, edge_id, occ, seed_start in indexed:
        if edge_id not in edge_map:
            return OptimizerResult(outcome="infeasible_or_timeout", reason="infeasible")
        key = (entity, edge_id, occ)
        duration = int(edge_map[edge_id].duration_min.base_min)
        if key in locked:
            start_vars[key] = model.NewIntVar(int(seed_start), int(seed_start), f"start_{entity}_{edge_id}_{occ}")
        else:
            ub, latest_var = _latest_start_ub(earliest, latest_cap, duration, horizon)
            start = model.NewIntVar(earliest, ub, f"start_{entity}_{edge_id}_{occ}")
            if latest_var is not None:
                model.Add(start + duration <= latest_var)
            start_vars[key] = start

    fixed_presence = {key: 1 for key in start_vars}
    _add_resource_cumulative(model, scenario, edges, start_vars, fixed_presence, resource_capacities)
    _add_entity_order_constraints(model, edge_map, start_vars, canonical_sequences)
    _add_node_capacity_cumulative(
        model,
        scenario,
        seed_schedule,
        edge_map,
        start_vars,
        canonical_sequences,
        horizon,
    )

    for constraint in scenario.constraints:
        if constraint.type != "precedence" or not constraint.hard:
            continue
        before = constraint.params.get("before_move")
        after = constraint.params.get("after_move")
        if not before or not after:
            continue
        before_keys = [k for k in start_vars if f"{k[0]}|{k[1]}" == before or k[1] == before]
        after_keys = [k for k in start_vars if f"{k[0]}|{k[1]}" == after or k[1] == after]
        for bk in before_keys:
            for ak in after_keys:
                b_edge = edge_map[bk[1]]
                model.Add(start_vars[ak] >= start_vars[bk] + int(b_edge.duration_min.base_min))

    model.Minimize(sum(start_vars[key] for key in sorted(start_vars)))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_sec
    solver.parameters.random_seed = seed
    solver.parameters.num_search_workers = 1

    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        reason = "timeout" if status == cp_model.UNKNOWN else "infeasible"
        return OptimizerResult(outcome="infeasible_or_timeout", reason=reason)

    key_map = _seed_move_keys(seed_schedule)
    moves: list[Move] = []
    for list_idx, move in enumerate(seed_schedule.moves):
        move_key = key_map.get((move.entity, move.edge, move.start_min, list_idx))
        if move_key is None:
            continue
        start_val = float(solver.Value(start_vars[move_key]))
        moves.append(Move(entity=move.entity, edge=move.edge, start_min=start_val))

    schedule = Schedule(schema_version=4, scenario=scenario.id, moves=moves)
    sim = simulate(scenario, schedule, runtime_mode="fail_fast")
    if sim.failed:
        return OptimizerResult(outcome="infeasible_or_timeout", reason="infeasible")

    objective = score_objective(sim, scenario.objective)
    tuned_values = _collect_tuned_values(solver, tuned, resource_capacities, slack_by, scenario)
    return OptimizerResult(
        outcome="feasible",
        schedule=schedule,
        score_total=objective.total,
        tuned_constraint_params=tuned_values,
        execution_mode=EXECUTION_MODE_TIMING_PRESERVE,
    )


def optimize(
    scenario: Scenario,
    *,
    seed: int = 42,
    time_limit_sec: float = 5.0,
    seed_schedule: Schedule | None = None,
    lock_contract: OptimizeLockContract | None = None,
    lock_resolution: LockResolution | None = None,
) -> OptimizerResult:
    if cp_model is None:
        return OptimizerResult(outcome="infeasible_or_timeout", reason="infeasible")

    if seed_schedule is None:
        return OptimizerResult(outcome="infeasible_or_timeout", reason="infeasible")

    contract = lock_contract or default_lock_contract()
    resolution = lock_resolution
    if contract.active and resolution is None:
        resolution = resolve_lock_state(contract, scenario, seed_schedule)

    return _optimize_structure_locked(
        scenario,
        seed_schedule,
        seed=seed,
        time_limit_sec=time_limit_sec,
        contract=contract,
        resolution=resolution,
    )
