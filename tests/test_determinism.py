"""Determinism and artifact replay conformance."""

from __future__ import annotations

import json
from pathlib import Path

from fuelflow.engine.sim.simulator import simulate
from fuelflow.io.artifacts import write_artifact_bundle
from fuelflow.io.canonical import VOLATILE_FIELDS, canonical_json, digest
from fuelflow.io.yaml_io import load_yaml
from fuelflow.objectives.scoring import score_objective
from fuelflow.scenario.model import Scenario, Schedule
from fuelflow.services import run_simulation

from tests.conftest import REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT


def _bundle_payload(bundle: dict) -> dict:
    return {
        "timeline": bundle["timeline"],
        "violations": bundle["violations"],
        "objective": bundle["objective"],
        "manifest": {k: v for k, v in bundle["manifest"].items() if k not in VOLATILE_FIELDS},
    }


def test_timeline_byte_identical_replay() -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    schedule = Schedule.model_validate(load_yaml(REFERENCE_SCHEDULE))
    first = simulate(scenario, schedule)
    second = simulate(scenario, schedule)
    assert canonical_json([e.__dict__ for e in first.timeline]) == canonical_json(
        [e.__dict__ for e in second.timeline]
    )


def test_service_bundle_deterministic_digest_stable() -> None:
    first = run_simulation(REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT)
    second = run_simulation(REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT)
    assert digest(_bundle_payload(first)) == digest(_bundle_payload(second))


def test_artifact_files_use_canonical_json(tmp_path: Path) -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    schedule = Schedule.model_validate(load_yaml(REFERENCE_SCHEDULE))
    sim = simulate(scenario, schedule)
    objective = score_objective(sim.to_objective_metrics(), scenario.objective)
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    write_artifact_bundle(
        run_dir,
        scenario=scenario,
        schedule=schedule,
        sim=sim,
        objective=objective,
        runtime_mode="fail_fast",
    )
    manifest = json.loads((run_dir / "run_manifest.json").read_text(encoding="utf-8"))
    timeline = json.loads((run_dir / "timeline.json").read_text(encoding="utf-8"))
    assert manifest["scenario_id"] == "reference_plant"
    assert isinstance(timeline, list)
    assert (run_dir / "violations.json").exists()
    assert (run_dir / "objective.json").exists()


def test_volatile_fields_excluded_from_digest_policy() -> None:
    base = {"scenario_id": "x", "objective_total": 1.0}
    with_volatile = {**base, "run_id": "abc", "wall_clock_ts": "now"}
    assert digest(base) == digest(with_volatile, exclude_volatile=True)
