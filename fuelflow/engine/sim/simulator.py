"""Deterministic event-phase simulator."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from fuelflow.constraints.vocabulary import Violation, evaluate_constraint
from fuelflow.entities.models import Entity, EntityState
from fuelflow.scenario.model import RuntimeMode, Scenario, Schedule

EventKind = Literal[
    "move_started",
    "move_completed",
    "dwell_started",
    "entity_created",
    "entity_departed",
    "constraint_violated",
]


@dataclass
class TimelineEvent:
    t_min: float
    entity: str | None
    kind: EventKind
    edge: str | None = None
    detail: dict = field(default_factory=dict)


@dataclass
class ActiveMove:
    entity: str
    edge: str
    start_min: float
    end_min: float
    resources: list[str]


@dataclass
class SimulationResult:
    timeline: list[TimelineEvent]
    violations: list[Violation]
    entities: dict[str, Entity]
    handling_ops_count: int
    peak_storage_heat_kw: float
    outage_duration_min: float
    failed: bool


def _move_key(entity: str, edge: str, start_min: float, ordinal: int) -> str:
    return f"{entity}|{edge}|{start_min}|{ordinal}"


def _unit_mode_allows_refueling(scenario: Scenario, unit: str, t_min: float) -> bool:
    for mode in scenario.unit_modes:
        if mode.unit != unit:
            continue
        for window in mode.windows:
            if window.from_min <= t_min < window.to_min and window.mode == "refueling":
                return True
    return False


def simulate(
    scenario: Scenario,
    schedule: Schedule,
    *,
    runtime_mode: RuntimeMode = "fail_fast",
) -> SimulationResult:
    entities = {e.id: e.model_copy(deep=True) for e in scenario.entities}
    timeline: list[TimelineEvent] = []
    violations: list[Violation] = []
    failed = False

    edge_map = scenario.topology.edge_map()
    node_map = scenario.topology.node_map()

    ordinal_map: dict[tuple[str, str, float], int] = {}
    planned_moves: list[ActiveMove] = []
    for move in sorted(schedule.moves, key=lambda m: (m.start_min, m.entity, m.edge)):
        key = (move.entity, move.edge, move.start_min)
        ordinal = ordinal_map.get(key, 0)
        ordinal_map[key] = ordinal + 1
        edge = edge_map[move.edge]
        duration = edge.duration_min.base_min
        planned_moves.append(
            ActiveMove(
                entity=move.entity,
                edge=move.edge,
                start_min=move.start_min,
                end_min=move.start_min + duration,
                resources=list(edge.requires),
            )
        )

    active_moves: list[ActiveMove] = []
    completed_moves: set[str] = set()
    handling_ops = 0
    peak_heat = 0.0
    outage_start: float | None = None
    outage_end: float | None = None

    events_by_time: dict[float, list[str]] = {}
    for arrival in scenario.arrivals:
        events_by_time.setdefault(arrival.t_min, []).append(f"arrival:{arrival.entity_id}")
    for departure in scenario.departures:
        events_by_time.setdefault(departure.t_min, []).append(f"departure:{departure.entity_id}")
    for move in planned_moves:
        events_by_time.setdefault(move.start_min, []).append(f"start:{move.entity}:{move.edge}")
        events_by_time.setdefault(move.end_min, []).append(f"complete:{move.entity}:{move.edge}")

    times = sorted(set([0.0, scenario.horizon_min] + list(events_by_time.keys())))
    resource_rr_index: dict[str, int] = {}

    def entity_heat(entity_id: str, t_min: float) -> float:
        model = scenario.physics.decay_for(entity_id)
        if model:
            return model.heat_kw(t_min)
        return entities[entity_id].state.heat_kw

    def node_occupancy() -> dict[str, list[str]]:
        occ: dict[str, list[str]] = {}
        for eid, ent in entities.items():
            occ.setdefault(ent.location, []).append(eid)
        for key in occ:
            occ[key] = sorted(occ[key])
        return occ

    def resource_usage() -> dict[str, int]:
        usage: dict[str, int] = {}
        for move in active_moves:
            for res in move.resources:
                usage[res] = usage.get(res, 0) + 1
        return usage

    def emit_violations(t_min: float) -> None:
        nonlocal failed
        occ = node_occupancy()
        heat = {eid: entity_heat(eid, t_min) for eid in entities}
        usage = resource_usage()
        move_active = {
            _move_key(m.entity, m.edge, m.start_min, 0): True for m in active_moves
        }
        for constraint in scenario.constraints:
            violation = evaluate_constraint(
                constraint,
                t_min=t_min,
                node_occupancy=occ,
                resource_usage=usage,
                entity_heat=heat,
                move_active=move_active,
            )
            if violation:
                violations.append(violation)
                timeline.append(
                    TimelineEvent(
                        t_min=t_min,
                        entity=None,
                        kind="constraint_violated",
                        detail={"constraint_id": constraint.id, "message": violation.message},
                    )
                )
                if violation.hard:
                    failed = True
                    if runtime_mode == "fail_fast":
                        return

    def emit_schedule_executability_violation(t_min: float, move: ActiveMove, reason: str) -> None:
        nonlocal failed
        violation = Violation(
            rule_id="C-schedule-executability",
            constraint_id="schedule_executability",
            scope="global",
            target=move.edge,
            hard=True,
            message=(
                f"Move {move.entity}:{move.edge} could not start at {move.start_min}: {reason}"
            ),
            entity_ids=[move.entity],
            t_min=t_min,
        )
        violations.append(violation)
        timeline.append(
            TimelineEvent(
                t_min=t_min,
                entity=None,
                kind="constraint_violated",
                detail={
                    "constraint_id": "schedule_executability",
                    "message": violation.message,
                },
            )
        )
        failed = True

    for t_min in times:
        if t_min > scenario.horizon_min:
            break

        # Phase 1: ingress
        for arrival in sorted(scenario.arrivals, key=lambda a: (a.t_min, a.entity_id)):
            if arrival.t_min != t_min:
                continue
            state = EntityState(**{k: v for k, v in arrival.state.items() if k in EntityState.model_fields})
            entities[arrival.entity_id] = Entity(
                id=arrival.entity_id,
                location=arrival.node_id,
                state=state,
            )
            timeline.append(
                TimelineEvent(t_min=t_min, entity=arrival.entity_id, kind="entity_created")
            )

        # Phase 2: completion
        completing = [m for m in active_moves if m.end_min == t_min]
        for move in sorted(completing, key=lambda m: (m.entity, m.edge)):
            edge = edge_map[move.edge]
            entities[move.entity].location = edge.to_node
            timeline.append(
                TimelineEvent(
                    t_min=t_min,
                    entity=move.entity,
                    kind="move_completed",
                    edge=move.edge,
                )
            )
            completed_moves.add(_move_key(move.entity, move.edge, move.start_min, 0))
            active_moves.remove(move)

        # Phase 3: state / dwell
        for eid in sorted(entities.keys()):
            timeline.append(TimelineEvent(t_min=t_min, entity=eid, kind="dwell_started"))
            heat = entity_heat(eid, t_min)
            entities[eid].state.heat_kw = heat

        occ = node_occupancy()
        for node_id, ids in occ.items():
            node = node_map.get(node_id)
            if node and node.type in {"interim_pool", "lts"}:
                heat_sum = sum(entity_heat(eid, t_min) for eid in ids)
                peak_heat = max(peak_heat, heat_sum)

        for mode in scenario.unit_modes:
            for window in mode.windows:
                if window.from_min <= t_min < window.to_min and window.mode == "refueling":
                    if outage_start is None:
                        outage_start = t_min
                    outage_end = window.to_min

        # Phase 4: allocation
        starting = [m for m in planned_moves if m.start_min == t_min and _move_key(m.entity, m.edge, m.start_min, 0) not in completed_moves and m not in active_moves]
        # fairness: round-robin by resource signature
        def sort_key(move: ActiveMove) -> tuple:
            sig = ",".join(sorted(move.resources))
            idx = resource_rr_index.get(sig, 0)
            resource_rr_index[sig] = idx + 1
            return (sig, idx, move.entity, move.edge)

        for move in sorted(starting, key=sort_key):
            edge = edge_map[move.edge]
            from_node = node_map[edge.from_node]
            if from_node.type == "core" and from_node.unit != "shared":
                if not _unit_mode_allows_refueling(scenario, from_node.unit, t_min):
                    emit_schedule_executability_violation(
                        t_min,
                        move,
                        f"unit mode forbids refueling for unit {from_node.unit}",
                    )
                    if runtime_mode == "fail_fast":
                        break
                    continue
            usage = resource_usage()
            blocked_resource: str | None = None
            for res in move.resources:
                cap = next((r.capacity for r in scenario.resources if r.id == res), 1)
                if usage.get(res, 0) >= cap:
                    blocked_resource = res
                    break
            if blocked_resource is not None:
                emit_schedule_executability_violation(
                    t_min,
                    move,
                    f"resource {blocked_resource} capacity exceeded at start time",
                )
                if runtime_mode == "fail_fast":
                    break
                continue
            if move.entity not in entities:
                emit_schedule_executability_violation(
                    t_min, move, "entity is unavailable at start time"
                )
                if runtime_mode == "fail_fast":
                    break
                continue
            if entities[move.entity].location != edge.from_node:
                emit_schedule_executability_violation(
                    t_min,
                    move,
                    (
                        f"entity at {entities[move.entity].location}, "
                        f"expected {edge.from_node}"
                    ),
                )
                if runtime_mode == "fail_fast":
                    break
                continue
            active_moves.append(move)
            handling_ops += 1
            timeline.append(
                TimelineEvent(
                    t_min=t_min,
                    entity=move.entity,
                    kind="move_started",
                    edge=move.edge,
                    detail={"status": "executed"},
                )
            )

        # Phase 5: egress
        for departure in sorted(scenario.departures, key=lambda d: (d.t_min, d.entity_id)):
            if departure.t_min != t_min:
                continue
            if departure.entity_id in entities:
                entities[departure.entity_id].location = "departed"
                timeline.append(
                    TimelineEvent(t_min=t_min, entity=departure.entity_id, kind="entity_departed")
                )

        # Phase 6: validation
        emit_violations(t_min)
        if failed and runtime_mode == "fail_fast":
            break

    outage_duration = 0.0
    if outage_start is not None and outage_end is not None:
        outage_duration = max(0.0, outage_end - outage_start)

    return SimulationResult(
        timeline=timeline,
        violations=violations,
        entities=entities,
        handling_ops_count=handling_ops,
        peak_storage_heat_kw=peak_heat,
        outage_duration_min=outage_duration,
        failed=failed or any(v.hard for v in violations),
    )
