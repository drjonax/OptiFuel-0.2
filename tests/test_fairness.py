"""Fairness and contention invariants."""

from __future__ import annotations

from fuelflow.engine.sim.simulator import simulate
from fuelflow.io.canonical import canonical_json
from fuelflow.scenario.model import Move, Scenario, Schedule
from fuelflow.topology.models import Edge, EdgeDuration, Node, Topology
from fuelflow.entities.models import Entity
from fuelflow.resources.models import Resource


def _contention_fixture() -> tuple[Scenario, Schedule]:
    scenario = Scenario(
        id="contention",
        horizon_min=1000,
        topology=Topology(
            nodes=[
                Node(id="fresh", type="fresh_store"),
                Node(id="staging", type="corridor_staging"),
            ],
            edges=[
                Edge(
                    id="move_a",
                    **{"from": "fresh", "to": "staging"},
                    requires=["fhm"],
                    duration_min=EdgeDuration(base_min=30),
                ),
                Edge(
                    id="move_b",
                    **{"from": "fresh", "to": "staging"},
                    requires=["fhm"],
                    duration_min=EdgeDuration(base_min=30),
                ),
            ],
        ),
        entities=[
            Entity(id="E_B", location="fresh"),
            Entity(id="E_A", location="fresh"),
        ],
        resources=[Resource(id="fhm", type="fhm", capacity=1)],
        constraints=[],
    )
    schedule = Schedule(
        schema_version=4,
        scenario="contention",
        moves=[
            Move(entity="E_B", edge="move_b", start_min=0),
            Move(entity="E_A", edge="move_a", start_min=0),
        ],
    )
    return scenario, schedule


def test_persistent_contention_deterministic_ordering() -> None:
    scenario, schedule = _contention_fixture()
    first = simulate(scenario, schedule)
    second = simulate(scenario, schedule)
    starts = [
        (event.entity, event.edge)
        for event in first.timeline
        if event.kind == "move_started"
    ]
    starts_repeat = [
        (event.entity, event.edge)
        for event in second.timeline
        if event.kind == "move_started"
    ]
    assert starts == starts_repeat
    assert starts[0][0] == "E_A"


def test_fairness_second_contender_starts_after_resource_release() -> None:
    scenario, _ = _contention_fixture()
    schedule = Schedule(
        schema_version=4,
        scenario="contention",
        moves=[
            Move(entity="E_A", edge="move_a", start_min=0),
            Move(entity="E_B", edge="move_b", start_min=30),
        ],
    )
    result = simulate(scenario, schedule, runtime_mode="continue_and_report")
    started_entities = {event.entity for event in result.timeline if event.kind == "move_started"}
    assert started_entities == {"E_A", "E_B"}


def test_same_start_contention_is_infeasible_not_silently_dropped() -> None:
    scenario, schedule = _contention_fixture()
    result = simulate(scenario, schedule, runtime_mode="continue_and_report")
    started_entities = {event.entity for event in result.timeline if event.kind == "move_started"}

    assert started_entities == {"E_A"}
    assert result.failed
    assert any(v.constraint_id == "schedule_executability" and v.hard for v in result.violations)
