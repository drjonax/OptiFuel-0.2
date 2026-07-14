"""Public library API conformance."""

from __future__ import annotations

import fuelflow
from fuelflow import (
    Scenario,
    Schedule,
    fork_scenario,
    load_yaml,
    optimize,
    run_optimization,
    run_simulation,
    score_objective,
    simulate,
    validate_scenario,
    validate_scenario_file,
    validate_schedule,
)
from tests.conftest import REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT


def test_public_exports_available() -> None:
    for name in fuelflow.__all__:
        assert hasattr(fuelflow, name)


def test_library_validate_and_simulate_paths() -> None:
    data = load_yaml(REFERENCE_SCENARIO)
    scenario = Scenario.model_validate(data)
    schedule = Schedule.model_validate(load_yaml(REFERENCE_SCHEDULE))
    issues = validate_scenario(scenario)
    assert not any(i.severity == "error" for i in issues)
    schedule_issues = validate_schedule(schedule, scenario)
    assert not any(i.severity == "error" for i in schedule_issues)
    sim = simulate(scenario, schedule)
    score = score_objective(sim, scenario.objective)
    assert score.total >= 0


def test_library_service_wrappers_match_public_api() -> None:
    validated = validate_scenario_file(REFERENCE_SCENARIO, ROOT)
    assert validated["valid"] is True
    bundle = run_simulation(REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT)
    assert bundle["manifest"]["scenario_id"] == "reference_plant"
    opt = run_optimization(REFERENCE_SCENARIO, ROOT, seed=42, time_limit_sec=2.0)
    assert opt["outcome"] in {"feasible", "infeasible_or_timeout"}


def test_library_optimize_and_fork_entrypoints() -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    schedule = Schedule.model_validate(load_yaml(REFERENCE_SCHEDULE))
    result = optimize(scenario, seed=42, time_limit_sec=2.0)
    assert result.outcome in {"feasible", "infeasible_or_timeout"}
    forked = fork_scenario(
        scenario,
        schedule,
        state_at_min=0.0,
        amendments={"new_id": "library_fork", "horizon_min": 11000},
    )
    assert forked.id == "library_fork"
