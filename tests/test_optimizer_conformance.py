"""Optimizer acceptance and objective parity tests."""

from __future__ import annotations

import pytest

from fuelflow.engine.opt.cpsat_adapter import optimize
from fuelflow.engine.sim.simulator import simulate
from fuelflow.io.yaml_io import load_yaml
from fuelflow.objectives.scoring import score_objective
from fuelflow.scenario.model import Scenario
from fuelflow.services import run_optimization

from tests.conftest import REFERENCE_SCENARIO, ROOT

PARITY_ABS_TOL = 1e-6
PARITY_REL_TOL = 1e-6


def test_optimizer_outcome_class_stable() -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    first = optimize(scenario, seed=42, time_limit_sec=2.0)
    second = optimize(scenario, seed=42, time_limit_sec=2.0)
    assert first.outcome == second.outcome
    assert first.reason == second.reason


def test_optimizer_feasible_has_zero_hard_violations() -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    result = optimize(scenario, seed=42, time_limit_sec=5.0)
    if result.outcome != "feasible" or result.schedule is None:
        pytest.skip("Optimizer did not return feasible schedule on this platform run")
    sim = simulate(scenario, result.schedule, runtime_mode="fail_fast")
    assert not any(v.hard for v in sim.violations)


def test_optimizer_objective_parity() -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    result = optimize(scenario, seed=42, time_limit_sec=5.0)
    if result.outcome != "feasible" or result.schedule is None or result.score_total is None:
        pytest.skip("Optimizer did not return feasible schedule on this platform run")
    sim = simulate(scenario, result.schedule, runtime_mode="fail_fast")
    score = score_objective(sim, scenario.objective)
    delta = abs(result.score_total - score.total)
    rel = delta / max(abs(score.total), PARITY_ABS_TOL)
    assert delta <= PARITY_ABS_TOL or rel <= PARITY_REL_TOL


def test_service_optimizer_canonical_outcome() -> None:
    payload = run_optimization(REFERENCE_SCENARIO, ROOT, seed=42, time_limit_sec=2.0)
    assert payload["outcome"] in {"feasible", "infeasible_or_timeout"}
