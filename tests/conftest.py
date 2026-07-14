"""Shared pytest fixtures and helpers."""

from __future__ import annotations

from pathlib import Path

import pytest

from fuelflow.io.yaml_io import load_yaml
from fuelflow.scenario.model import Scenario, Schedule

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_SCENARIO = ROOT / "examples/reference_plant/scenario.yaml"
REFERENCE_SCHEDULE = ROOT / "examples/reference_plant/schedule.yaml"
MEDIUM_SCHEDULE = ROOT / "examples/reference_plant/schedule_medium.yaml"
INFEASIBLE_SCHEDULE = ROOT / "examples/reference_plant/schedule_infeasible.yaml"


@pytest.fixture
def workspace_root() -> Path:
    return ROOT


@pytest.fixture
def reference_pair() -> tuple[Scenario, Schedule]:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    schedule = Schedule.model_validate(load_yaml(REFERENCE_SCHEDULE))
    return scenario, schedule


def load_pair(scenario_path: Path, schedule_path: Path) -> tuple[Scenario, Schedule]:
    scenario = Scenario.model_validate(load_yaml(scenario_path))
    schedule = Schedule.model_validate(load_yaml(schedule_path))
    return scenario, schedule
