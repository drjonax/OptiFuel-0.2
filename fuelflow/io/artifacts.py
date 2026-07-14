"""Run artifact bundle management."""

from __future__ import annotations

import json
import os
import platform
import sys
import uuid
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from fuelflow.engine.sim.simulator import SimulationResult
from fuelflow.io.canonical import canonical_json, digest
from fuelflow.objectives.scoring import ObjectiveScore
from fuelflow.scenario.model import Scenario, Schedule

ENGINE_VERSION = "0.1.0-alpha"
ARTIFACT_ROOT = Path("artifacts")


def _serialize(obj: Any) -> Any:
    if is_dataclass(obj):
        return asdict(obj)
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    return obj


def create_run_directory(workspace: Path) -> Path:
    run_dir = workspace / ARTIFACT_ROOT / str(uuid.uuid4())
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def write_artifact_bundle(
    run_dir: Path,
    *,
    scenario: Scenario,
    schedule: Schedule,
    sim: SimulationResult,
    objective: ObjectiveScore,
    runtime_mode: str,
    optimizer_meta: dict[str, Any] | None = None,
    status: str = "completed",
) -> dict[str, Any]:
    scenario_digest = digest(scenario.model_dump_canonical())
    schedule_digest = digest(schedule.model_dump_canonical())

    timeline = [_serialize(e) for e in sim.timeline]
    violations = [_serialize(v) for v in sim.violations]

    manifest = {
        "status": status,
        "engine_version": ENGINE_VERSION,
        "scenario_id": scenario.id,
        "scenario_digest": scenario_digest,
        "schedule_digest": schedule_digest,
        "runtime_mode": runtime_mode,
        "determinism_profile": {
            "python_version": sys.version,
            "platform": platform.platform(),
            "locale": os.environ.get("LC_ALL", "unset"),
            "timezone": os.environ.get("TZ", "unset"),
        },
        "objective_total": objective.total,
        "failed": sim.failed,
        "optimizer": optimizer_meta or {},
    }

    deterministic_manifest = {k: v for k, v in manifest.items() if k not in {"status"}}

    (run_dir / "timeline.json").write_text(canonical_json(timeline), encoding="utf-8")
    (run_dir / "violations.json").write_text(canonical_json(violations), encoding="utf-8")
    (run_dir / "objective.json").write_text(canonical_json(objective.model_dump()), encoding="utf-8")
    (run_dir / "run_manifest.json").write_text(canonical_json(deterministic_manifest), encoding="utf-8")

    return {
        "run_dir": str(run_dir),
        "manifest": manifest,
        "timeline": timeline,
        "violations": violations,
        "objective": objective.model_dump(),
        "deterministic_digest": digest(deterministic_manifest),
    }
