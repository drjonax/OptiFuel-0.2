"""Scenario fork semantics."""

from __future__ import annotations

from typing import Any

from fuelflow.engine.sim.simulator import SimulationResult, simulate
from fuelflow.scenario.model import Scenario, Schedule
from fuelflow.scenario.validation import validate_scenario


class ForkError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def fork_scenario(
    parent: Scenario,
    schedule: Schedule,
    *,
    state_at_min: float,
    amendments: dict[str, Any],
    precedence: str | None = None,
) -> Scenario:
    sim = simulate(parent, schedule, runtime_mode="continue_and_report")

    boundary_times = sorted({event.t_min for event in sim.timeline})
    if state_at_min not in boundary_times and state_at_min != 0.0:
        raise ForkError("illegal_boundary", f"Fork time {state_at_min} is not an event boundary")

    if amendments.get("ambiguous") and not precedence:
        raise ForkError(
            "ambiguous_amendment",
            "Ambiguous same-boundary amendments require precedence metadata",
        )

    # Snapshot entity locations at fork boundary from timeline replay.
    boundary_locations = {e.id: e.location for e in parent.entities}
    for event in sim.timeline:
        if event.t_min > state_at_min:
            break
        if event.kind == "move_completed" and event.entity:
            edge = parent.topology.edge_map().get(event.edge or "")
            if edge:
                boundary_locations[event.entity] = edge.to_node
        if event.kind == "entity_created" and event.entity:
            arrival = next((a for a in parent.arrivals if a.entity_id == event.entity), None)
            if arrival:
                boundary_locations[event.entity] = arrival.node_id
        if event.kind == "entity_departed" and event.entity:
            boundary_locations[event.entity] = "departed"

    forked = parent.model_copy(deep=True)
    forked.lineage_parent_id = parent.id
    forked.forked_at_min = state_at_min

    if "horizon_min" in amendments:
        forked.horizon_min = float(amendments["horizon_min"])

    if "entities" in amendments:
        entity_map = {e.id: e for e in forked.entities}
        for patch in amendments["entities"]:
            eid = patch["id"]
            if eid not in entity_map:
                raise ForkError("replay_inconsistent", f"Unknown entity in amendment: {eid}")
            if patch.get("location"):
                entity_map[eid].location = patch["location"]
        forked.entities = list(entity_map.values())
    else:
        for entity in forked.entities:
            if entity.id in boundary_locations:
                entity.location = boundary_locations[entity.id]

    if "constraints" in amendments:
        forked.constraints = amendments["constraints"]

    issues = validate_scenario(forked)
    if any(i.severity == "error" for i in issues):
        raise ForkError("validation_failed", "Forked scenario failed validation")

    # replay consistency: amended entity locations must match boundary snapshot
    for entity in forked.entities:
        expected = boundary_locations.get(entity.id)
        if expected and entity.location != expected and not amendments.get("entities"):
            raise ForkError(
                "replay_inconsistent",
                f"Entity {entity.id} location mismatch at fork boundary",
            )

    forked.id = amendments.get("new_id", f"{parent.id}-fork-{int(state_at_min)}")
    return forked
