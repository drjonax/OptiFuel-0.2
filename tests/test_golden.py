"""Golden scenario acceptance tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from fuelflow.engine.sim.simulator import simulate
from fuelflow.io.yaml_io import load_yaml
from fuelflow.scenario.model import Scenario, Schedule
from fuelflow.scenario.validation import validate_scenario, validate_schedule
from fuelflow.services import run_simulation

from tests.conftest import MEDIUM_SCHEDULE, REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT


def test_short_ci_reference_feasible() -> None:
    scenario, schedule = (
        Scenario.model_validate(load_yaml(REFERENCE_SCENARIO)),
        Schedule.model_validate(load_yaml(REFERENCE_SCHEDULE)),
    )
    assert not any(i.severity == "error" for i in validate_scenario(scenario))
    assert not any(i.severity == "error" for i in validate_schedule(schedule, scenario))
    result = simulate(scenario, schedule, runtime_mode="fail_fast")
    assert result.handling_ops_count > 0


def test_medium_horizon_reference_feasible() -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    scenario.horizon_min = 20160
    schedule = Schedule.model_validate(load_yaml(MEDIUM_SCHEDULE))
    result = simulate(scenario, schedule, runtime_mode="continue_and_report")
    assert len(result.timeline) > 20
    assert result.outage_duration_min >= 0


def test_infeasible_schedule_produces_constraint_signal() -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    scenario.entities[0].location = "corridor_staging"
    scenario.entities[1].location = "corridor_staging"
    schedule = Schedule(schema_version=4, scenario="reference_plant", moves=[])
    result = simulate(scenario, schedule, runtime_mode="continue_and_report")
    assert any(v.constraint_id == "cap_staging" and v.hard for v in result.violations)


def test_golden_service_simulation_artifact_bundle() -> None:
    bundle = run_simulation(REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT)
    assert bundle["manifest"]["scenario_id"] == "reference_plant"
    assert bundle["timeline"]
    assert "deterministic_digest" in bundle
