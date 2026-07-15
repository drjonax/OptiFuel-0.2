"""Regression tests for optimiser-aligned reference_plant baseline."""

from __future__ import annotations

from pathlib import Path

from fuelflow.io.yaml_io import load_yaml
from fuelflow.scenario.model import Scenario, Schedule
from fuelflow.services import run_optimization, run_simulation

from tests.conftest import REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT


def test_reference_plant_optimiser_baseline_invariants() -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    schedule = Schedule.model_validate(load_yaml(REFERENCE_SCHEDULE))

    units = {node.unit for node in scenario.topology.nodes if node.unit not in {None, "shared"}}
    assert units == {"U1", "U2"}
    assert len(scenario.entities) == 2
    assert {entity.id for entity in scenario.entities} == {"A1", "A2"}

    assert scenario.horizon_min == 1440
    assert len([resource for resource in scenario.resources if resource.type == "fhm"]) == 1

    staging_cap = next(
        constraint
        for constraint in scenario.constraints
        if constraint.id == "cap_staging"
    )
    assert staging_cap.params["max_entities"] == 1

    cooling = next(
        constraint
        for constraint in scenario.constraints
        if constraint.id == "regulatory_cooling"
    )
    assert cooling.params["required_cooling_min"] == 120

    u2_mode = next(mode for mode in scenario.unit_modes if mode.unit == "U2")
    assert u2_mode.windows[0].from_min == 200

    fresh_edge = next(edge for edge in scenario.topology.edges if edge.id == "fresh_to_staging")
    assert fresh_edge.duration_min.base_min == 30

    for entity in scenario.entities:
        assert entity.state.heat_kw == 1.5

    home_by_id = {entity.id: entity.home_unit for entity in scenario.entities}
    assert home_by_id["A1"] == "U1"
    assert home_by_id["A2"] == "U2"

    assert len(schedule.moves) == 8
    assert schedule.scenario == "reference_plant"


def test_reference_plant_api_smoke_simulate_and_optimize() -> None:
    simulate_bundle = run_simulation(REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT)
    assert isinstance(simulate_bundle["timeline"], list)
    assert len(simulate_bundle["timeline"]) > 0
    assert "deterministic_digest" in simulate_bundle

    optimize_bundle = run_optimization(
        REFERENCE_SCENARIO,
        ROOT,
        seed=42,
        time_limit_sec=30.0,
        seed_schedule_path=REFERENCE_SCHEDULE,
    )
    assert optimize_bundle["outcome"] in {"feasible", "infeasible_or_timeout"}
    if optimize_bundle["outcome"] == "feasible":
        assert optimize_bundle.get("schedule")
        assert optimize_bundle.get("artifacts")
