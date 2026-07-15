"""Calendar-based feasibility and simulation outcome contract tests."""

from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from fuelflow.api.app import WORKSPACE, app
from fuelflow.constraints.vocabulary import Constraint, Violation
from fuelflow.engine.sim.calendar_intervals import (
    TimeInterval,
    build_resource_availability_cache,
    interval_fits_in_availability,
    normalize_windows,
)
from fuelflow.engine.sim.feasibility import derive_infeasible_category, map_simulation_outcome
from fuelflow.engine.sim.simulator import simulate
from fuelflow.resources.models import CalendarWindow, Resource
from fuelflow.scenario.model import Move, Scenario, Schedule
from fuelflow.scenario.validation import validate_scenario
from fuelflow.services import run_simulation
from fuelflow.topology.models import Edge, EdgeDuration, Node, Topology
from fuelflow.entities.models import Entity

ROOT = Path(__file__).resolve().parents[1]
SCENARIO = ROOT / "examples/reference_plant/scenario.yaml"
SCHEDULE = ROOT / "examples/reference_plant/schedule.yaml"


def _base_scenario(**overrides) -> Scenario:
    scenario = Scenario(
        id="calendar_test",
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
            ],
        ),
        entities=[Entity(id="E1", location="fresh")],
        resources=[Resource(id="fhm", type="fhm", capacity=1, calendar=[])],
        constraints=[],
    )
    for key, value in overrides.items():
        setattr(scenario, key, value)
    return scenario


def test_empty_calendar_means_full_horizon_availability() -> None:
    windows = normalize_windows([], horizon_min=500)
    assert windows == [TimeInterval(0.0, 500.0)]
    assert interval_fits_in_availability(10, 40, windows)


def test_calendar_boundary_semantics() -> None:
    windows = normalize_windows(
        [CalendarWindow(**{"from": 100, "to": 200})],
        horizon_min=1000,
    )
    assert interval_fits_in_availability(100, 200, windows)
    assert not interval_fits_in_availability(200, 230, windows)
    assert not interval_fits_in_availability(90, 110, windows)


def test_move_in_resource_blackout_is_infeasible() -> None:
    scenario = _base_scenario(
        resources=[
            Resource(
                id="fhm",
                type="fhm",
                capacity=1,
                calendar=[CalendarWindow(**{"from": 100, "to": 200})],
            ),
        ],
    )
    schedule = Schedule(
        schema_version=4,
        scenario="calendar_test",
        moves=[Move(entity="E1", edge="move_a", start_min=50)],
    )
    result = simulate(scenario, schedule, runtime_mode="continue_and_report")
    assert result.failed
    assert any(v.reason_code == "resource_calendar_blocked" for v in result.violations)


def test_same_entity_overlap_is_infeasible() -> None:
    scenario = Scenario(
        id="overlap",
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
                    duration_min=EdgeDuration(base_min=60),
                ),
                Edge(
                    id="move_b",
                    **{"from": "fresh", "to": "staging"},
                    requires=["crew"],
                    duration_min=EdgeDuration(base_min=60),
                ),
            ],
        ),
        entities=[Entity(id="E1", location="fresh")],
        resources=[
            Resource(id="fhm", type="fhm", capacity=2),
            Resource(id="crew", type="crew", capacity=2),
        ],
        constraints=[],
    )
    schedule = Schedule(
        schema_version=4,
        scenario="overlap",
        moves=[
            Move(entity="E1", edge="move_a", start_min=0),
            Move(entity="E1", edge="move_b", start_min=10),
        ],
    )
    result = simulate(scenario, schedule, runtime_mode="continue_and_report")
    assert result.failed
    assert any(v.reason_code == "entity_overlap" for v in result.violations)


def test_concurrent_same_unit_moves_allowed_with_capacity() -> None:
    scenario = Scenario(
        id="unit_parallel",
        horizon_min=1000,
        topology=Topology(
            nodes=[
                Node(id="fresh_u1", type="fresh_store", unit="U1"),
                Node(id="fresh_u2", type="fresh_store", unit="U2"),
                Node(id="staging", type="corridor_staging", unit="shared"),
            ],
            edges=[
                Edge(
                    id="u1_move",
                    **{"from": "fresh_u1", "to": "staging"},
                    requires=["fhm_1"],
                    duration_min=EdgeDuration(base_min=30),
                ),
                Edge(
                    id="u2_move",
                    **{"from": "fresh_u2", "to": "staging"},
                    requires=["fhm_2"],
                    duration_min=EdgeDuration(base_min=30),
                ),
            ],
        ),
        entities=[
            Entity(id="E1", location="fresh_u1"),
            Entity(id="E2", location="fresh_u2"),
        ],
        resources=[
            Resource(id="fhm_1", type="fhm", capacity=1),
            Resource(id="fhm_2", type="fhm", capacity=1),
        ],
        constraints=[],
    )
    schedule = Schedule(
        schema_version=4,
        scenario="unit_parallel",
        moves=[
            Move(entity="E1", edge="u1_move", start_min=0),
            Move(entity="E2", edge="u2_move", start_min=0),
        ],
    )
    result = simulate(scenario, schedule)
    started = {event.entity for event in result.timeline if event.kind == "move_started"}
    assert started == {"E1", "E2"}
    assert not result.failed


def test_concurrent_same_unit_moves_rejected_on_shared_resource_capacity() -> None:
    scenario = Scenario(
        id="unit_contention",
        horizon_min=1000,
        topology=Topology(
            nodes=[
                Node(id="fresh_u1", type="fresh_store", unit="U1"),
                Node(id="fresh_u2", type="fresh_store", unit="U2"),
                Node(id="staging", type="corridor_staging", unit="shared"),
            ],
            edges=[
                Edge(
                    id="u1_move",
                    **{"from": "fresh_u1", "to": "staging"},
                    requires=["fhm"],
                    duration_min=EdgeDuration(base_min=30),
                ),
                Edge(
                    id="u2_move",
                    **{"from": "fresh_u2", "to": "staging"},
                    requires=["fhm"],
                    duration_min=EdgeDuration(base_min=30),
                ),
            ],
        ),
        entities=[
            Entity(id="E1", location="fresh_u1"),
            Entity(id="E2", location="fresh_u2"),
        ],
        resources=[Resource(id="fhm", type="fhm", capacity=1)],
        constraints=[],
    )
    schedule = Schedule(
        schema_version=4,
        scenario="unit_contention",
        moves=[
            Move(entity="E1", edge="u1_move", start_min=0),
            Move(entity="E2", edge="u2_move", start_min=0),
        ],
    )
    result = simulate(scenario, schedule, runtime_mode="continue_and_report")
    assert result.failed
    assert any(v.reason_code == "resource_capacity_exceeded" for v in result.violations)


def test_infeasible_category_tie_break_precedence() -> None:
    violations = [
        Violation(
            rule_id="C-schedule-executability",
            constraint_id="schedule_executability",
            scope="global",
            target="edge_a",
            hard=True,
            message="resource fhm capacity exceeded at start time",
            t_min=10,
            reason_code="resource_capacity_exceeded",
        ),
        Violation(
            rule_id="C-schedule-executability",
            constraint_id="schedule_executability",
            scope="global",
            target="edge_b",
            hard=True,
            message="resource fhm unavailable for move interval [0, 30)",
            t_min=10,
            reason_code="resource_calendar_blocked",
        ),
    ]
    assert derive_infeasible_category(violations) == "resource_calendar_blocked"


def test_map_simulation_outcome_fields() -> None:
    feasible = map_simulation_outcome(failed=False, violations=[])
    assert feasible == {"outcome": "feasible", "reason": None, "infeasible_category": None}

    infeasible = map_simulation_outcome(
        failed=True,
        violations=[
            Violation(
                rule_id="C-capacity",
                constraint_id="cap_staging",
                scope="node",
                target="staging",
                hard=True,
                message="Node staging exceeds capacity 1",
                t_min=5,
            ),
        ],
    )
    assert infeasible["outcome"] == "infeasible_or_timeout"
    assert infeasible["reason"] == "infeasible"
    assert infeasible["infeasible_category"] == "constraint_violation_other"


def test_scenario_validation_rejects_invalid_calendar_window() -> None:
    scenario = _base_scenario(
        resources=[
            Resource(
                id="fhm",
                type="fhm",
                capacity=1,
                calendar=[CalendarWindow(**{"from": 300, "to": 100})],
            ),
        ],
    )
    issues = validate_scenario(scenario)
    assert any("requires from < to" in issue.message for issue in issues)


def test_run_simulation_exposes_outcome_contract() -> None:
    result = run_simulation(SCENARIO, SCHEDULE, ROOT, runtime_mode="fail_fast")
    assert "manifest" in result
    assert "timeline" in result
    assert "violations" in result
    assert "objective" in result
    assert result["outcome"] in {"feasible", "infeasible_or_timeout"}
    if result["outcome"] == "infeasible_or_timeout":
        assert result["reason"] == "infeasible"
        assert result["infeasible_category"] is not None


def test_api_simulate_outcome_contract() -> None:
    client = TestClient(app)
    response = client.post(
        "/runs/simulate",
        json={
            "scenario_path": "examples/reference_plant/scenario.yaml",
            "schedule_path": "examples/reference_plant/schedule.yaml",
            "runtime_mode": "fail_fast",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["outcome"] in {"feasible", "infeasible_or_timeout"}
    assert "manifest" in body
    assert "timeline" in body
    assert "violations" in body
    assert "objective" in body


def test_calendar_availability_cache_performance_guardrail() -> None:
    resources = [
        Resource(
            id=f"res_{idx}",
            type="other",
            capacity=1,
            calendar=[
                CalendarWindow(**{"from": float(window * 10), "to": float(window * 10 + 5)})
                for window in range(50)
            ],
        )
        for idx in range(20)
    ]
    cache = build_resource_availability_cache(resources, horizon_min=1000)
    start = time.perf_counter()
    for move_start in range(0, 500, 5):
        for resource_id, availability in cache.items():
            interval_fits_in_availability(float(move_start), float(move_start + 4), availability)
    elapsed = time.perf_counter() - start
    assert elapsed < 1.0
