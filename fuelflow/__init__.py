"""OptiFuel public library API."""

from __future__ import annotations

from pathlib import Path

from fuelflow.engine.opt.cpsat_adapter import optimize
from fuelflow.engine.sim.simulator import simulate
from fuelflow.io.yaml_io import load_yaml
from fuelflow.objectives.metrics import ObjectiveMetrics
from fuelflow.objectives.scoring import score_objective
from fuelflow.scenario.fork import fork_scenario
from fuelflow.scenario.model import Scenario, Schedule
from fuelflow.scenario.validation import validate_scenario, validate_schedule
from fuelflow.services import (
    run_fork,
    run_optimization,
    run_simulation,
    save_scenario,
    save_schedule,
    validate_scenario_file,
)

__all__ = [
    "Scenario",
    "Schedule",
    "simulate",
    "optimize",
    "ObjectiveMetrics",
    "score_objective",
    "fork_scenario",
    "validate_scenario",
    "validate_schedule",
    "load_yaml",
    "validate_scenario_file",
    "run_simulation",
    "run_optimization",
    "run_fork",
    "save_scenario",
    "save_schedule",
]

WORKSPACE_ROOT = Path(".")
