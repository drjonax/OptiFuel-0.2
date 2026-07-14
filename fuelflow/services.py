"""Shared service layer for CLI and API."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from fuelflow.engine.opt.cpsat_adapter import optimize
from fuelflow.engine.sim.simulator import simulate
from fuelflow.io.artifacts import create_run_directory, write_artifact_bundle
from fuelflow.io.canonical import digest
from fuelflow.io.yaml_io import YamlIOError, cleanup_orphan_temps, load_yaml, save_yaml
from fuelflow.objectives.scoring import score_objective
from fuelflow.scenario.fork import ForkError, fork_scenario
from fuelflow.scenario.model import Scenario, Schedule
from fuelflow.scenario.validation import has_errors, validate_schedule, validate_scenario

MAX_HORIZON_MIN = 525600  # 1 year
_active_runs = 0
_run_lock = threading.Lock()
MAX_CONCURRENT_RUNS = 2


class ServiceError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _parse_scenario(data: dict[str, Any]) -> Scenario:
    return Scenario.model_validate(data)


def _parse_schedule(data: dict[str, Any]) -> Schedule:
    return Schedule.model_validate(data)


def load_scenario_file(path: Path, workspace: Path) -> tuple[Scenario, str]:
    data = load_yaml(path if path.is_absolute() else workspace / path)
    horizon = float(data.get("horizon_min", 0))
    if horizon > MAX_HORIZON_MIN:
        raise ServiceError("horizon_limit", f"horizon_min exceeds {MAX_HORIZON_MIN}")
    scenario = _parse_scenario(data)
    return scenario, digest(data)


def load_schedule_file(path: Path, workspace: Path) -> tuple[Schedule, str]:
    data = load_yaml(path if path.is_absolute() else workspace / path)
    return _parse_schedule(data), digest(data)


def validate_scenario_file(path: Path, workspace: Path) -> dict[str, Any]:
    scenario, scenario_digest = load_scenario_file(path, workspace)
    issues = validate_scenario(scenario)
    return {
        "valid": not has_errors(issues),
        "digest": scenario_digest,
        "issues": [{"rule_id": i.rule_id, "severity": i.severity, "message": i.message} for i in issues],
    }


def run_simulation(
    scenario_path: Path,
    schedule_path: Path,
    workspace: Path,
    *,
    runtime_mode: str = "fail_fast",
) -> dict[str, Any]:
    global _active_runs
    with _run_lock:
        if _active_runs >= MAX_CONCURRENT_RUNS:
            raise ServiceError("queue_limit", "Run concurrency limit reached")
        _active_runs += 1
    try:
        scenario, _ = load_scenario_file(scenario_path, workspace)
        schedule, _ = load_schedule_file(schedule_path, workspace)
        issues = validate_scenario(scenario) + validate_schedule(schedule, scenario)
        if has_errors(issues):
            raise ServiceError("validation_failed", "Scenario or schedule validation failed")

        sim = simulate(scenario, schedule, runtime_mode=runtime_mode)  # type: ignore[arg-type]
        objective = score_objective(sim, scenario.objective)
        run_dir = create_run_directory(workspace)
        return write_artifact_bundle(
            run_dir,
            scenario=scenario,
            schedule=schedule,
            sim=sim,
            objective=objective,
            runtime_mode=runtime_mode,
        )
    finally:
        with _run_lock:
            _active_runs -= 1


def run_optimization(
    scenario_path: Path,
    workspace: Path,
    *,
    seed: int = 42,
    time_limit_sec: float = 5.0,
    seed_schedule_path: Path | None = None,
) -> dict[str, Any]:
    scenario, _ = load_scenario_file(scenario_path, workspace)
    issues = validate_scenario(scenario)
    if has_errors(issues):
        raise ServiceError("validation_failed", "Scenario validation failed")

    seed_schedule = None
    if seed_schedule_path:
        seed_schedule, _ = load_schedule_file(seed_schedule_path, workspace)

    result = optimize(
        scenario,
        seed=seed,
        time_limit_sec=time_limit_sec,
        seed_schedule=seed_schedule,
    )

    payload: dict[str, Any] = {
        "outcome": result.outcome,
        "reason": result.reason,
        "score_total": result.score_total,
    }

    if result.outcome == "feasible" and result.schedule:
        sim = simulate(scenario, result.schedule, runtime_mode="fail_fast")
        objective = score_objective(sim, scenario.objective)
        run_dir = create_run_directory(workspace)
        bundle = write_artifact_bundle(
            run_dir,
            scenario=scenario,
            schedule=result.schedule,
            sim=sim,
            objective=objective,
            runtime_mode="fail_fast",
            optimizer_meta={
                "solver": "cp-sat",
                "seed": seed,
                "time_limit_sec": time_limit_sec,
            },
        )
        payload["schedule"] = result.schedule.model_dump(by_alias=True)
        payload["artifacts"] = bundle

    return payload


def run_fork(
    scenario_path: Path,
    schedule_path: Path,
    workspace: Path,
    *,
    state_at_min: float,
    amendments: dict[str, Any],
    precedence: str | None = None,
    output_path: Path | None = None,
) -> dict[str, Any]:
    scenario, digest_before = load_scenario_file(scenario_path, workspace)
    schedule, _ = load_schedule_file(schedule_path, workspace)
    try:
        forked = fork_scenario(
            scenario,
            schedule,
            state_at_min=state_at_min,
            amendments=amendments,
            precedence=precedence,
        )
    except ForkError as exc:
        raise ServiceError(exc.code, str(exc)) from exc

    out = output_path or scenario_path.with_name(f"{forked.id}.yaml")
    new_digest = save_yaml(out, forked.model_dump(by_alias=True), root=workspace, expected_digest=None)
    return {"scenario_id": forked.id, "path": str(out), "digest": new_digest, "parent_digest": digest_before}


def save_scenario(
    path: Path,
    data: dict[str, Any],
    workspace: Path,
    *,
    expected_digest: str | None = None,
) -> str:
    scenario = _parse_scenario(data)
    issues = validate_scenario(scenario)
    if has_errors(issues):
        raise ServiceError("validation_failed", "Scenario validation failed")
    try:
        return save_yaml(path, data, root=workspace, expected_digest=expected_digest)
    except YamlIOError as exc:
        raise ServiceError(exc.code, str(exc)) from exc


def save_schedule(
    path: Path,
    data: dict[str, Any],
    workspace: Path,
    *,
    expected_digest: str | None = None,
) -> str:
    schedule = _parse_schedule(data)
    try:
        return save_yaml(path, data, root=workspace, expected_digest=expected_digest)
    except YamlIOError as exc:
        raise ServiceError(exc.code, str(exc)) from exc


def startup_cleanup(workspace: Path) -> int:
    return cleanup_orphan_temps(workspace)
