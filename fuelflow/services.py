"""Shared service layer for CLI and API."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from fuelflow.engine.opt.cpsat_adapter import EXECUTION_MODE_TIMING_PRESERVE, optimize
from fuelflow.engine.opt.locks import (
    OptimizeLockContract,
    lock_capabilities,
    resolve_lock_state,
    structure_signature,
    validate_constraint_param_locks,
)
from fuelflow.io.paths import resolve_seed_schedule_path
from fuelflow.engine.sim.simulator import simulate
from fuelflow.engine.sim.feasibility import map_simulation_outcome
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
        objective = score_objective(sim.to_objective_metrics(), scenario.objective)
        run_dir = create_run_directory(workspace)
        bundle = write_artifact_bundle(
            run_dir,
            scenario=scenario,
            schedule=schedule,
            sim=sim,
            objective=objective,
            runtime_mode=runtime_mode,
        )
        bundle.update(map_simulation_outcome(failed=sim.failed, violations=sim.violations))
        return bundle
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
    lock_contract: OptimizeLockContract | None = None,
) -> dict[str, Any]:
    global _active_runs
    with _run_lock:
        if _active_runs >= MAX_CONCURRENT_RUNS:
            raise ServiceError("queue_limit", "Run concurrency limit reached")
        _active_runs += 1
    try:
        scenario, _ = load_scenario_file(scenario_path, workspace)
        issues = validate_scenario(scenario)
        if has_errors(issues):
            raise ServiceError("validation_failed", "Scenario validation failed")

        contract = lock_contract or OptimizeLockContract(lock_mode="legacy")
        resolved_seed_path = resolve_seed_schedule_path(
            scenario_path,
            workspace,
            explicit_seed_path=seed_schedule_path,
        )
        if not resolved_seed_path.exists():
            raise ServiceError(
                "seed_schedule_required",
                "Optimize requires a saved seed schedule; provide seed_schedule_path or save sibling schedule.yaml",
            )

        try:
            resolved_rel = str(resolved_seed_path.relative_to(workspace))
        except ValueError:
            resolved_rel = str(resolved_seed_path)

        seed_schedule, _ = load_schedule_file(resolved_seed_path, workspace)
        seed_issues = validate_schedule(seed_schedule, scenario)
        if has_errors(seed_issues):
            raise ServiceError("validation_failed", "Seed schedule validation failed")

        try:
            contract = OptimizeLockContract.model_validate(contract.model_dump())
        except ValueError as exc:
            raise ServiceError("lock_contract_invalid", str(exc)) from exc

        validate_constraint_param_locks(contract, scenario, seed_schedule)
        lock_resolution = resolve_lock_state(contract, scenario, seed_schedule)

        scenario_lock_warning: str | None = None
        if contract.active and contract.scenario_locks and not lock_capabilities()["scenario_tunable_active"]:
            scenario_lock_warning = "scenario_locks_not_applied"

        result = optimize(
            scenario,
            seed=seed,
            time_limit_sec=time_limit_sec,
            seed_schedule=seed_schedule,
            lock_contract=contract,
            lock_resolution=lock_resolution,
        )

        if (
            result.outcome == "feasible"
            and result.schedule
            and seed_schedule is not None
            and structure_signature(seed_schedule) != structure_signature(result.schedule)
        ):
            return {
                "outcome": "infeasible_or_timeout",
                "reason": "structure_violation",
                "score_total": None,
                "execution_mode": EXECUTION_MODE_TIMING_PRESERVE,
                "resolved_seed_schedule_path": resolved_rel,
                "lock_contract": _lock_contract_meta(
                    contract, scenario, seed_schedule, scenario_lock_warning=scenario_lock_warning
                ),
                "lock_capabilities": lock_capabilities(scenario, seed_schedule),
            }

        payload: dict[str, Any] = {
            "outcome": result.outcome,
            "reason": result.reason,
            "score_total": result.score_total,
            "execution_mode": result.execution_mode or EXECUTION_MODE_TIMING_PRESERVE,
            "resolved_seed_schedule_path": resolved_rel,
            "lock_contract": _lock_contract_meta(
                contract,
                scenario,
                seed_schedule,
                scenario_lock_warning=scenario_lock_warning,
                tuned_constraint_params=result.tuned_constraint_params,
            ),
            "lock_capabilities": lock_capabilities(scenario, seed_schedule),
        }

        if result.outcome == "feasible" and result.schedule:
            sim = simulate(scenario, result.schedule, runtime_mode="fail_fast")
            objective = score_objective(sim.to_objective_metrics(), scenario.objective)
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
                    "execution_mode": result.execution_mode or EXECUTION_MODE_TIMING_PRESERVE,
                    "resolved_seed_schedule_path": resolved_rel,
                    "lock_contract": _lock_contract_meta(
                        contract,
                        scenario,
                        seed_schedule,
                        scenario_lock_warning=scenario_lock_warning,
                        tuned_constraint_params=result.tuned_constraint_params,
                    ),
                },
            )
            payload["schedule"] = result.schedule.model_dump(by_alias=True)
            payload["artifacts"] = bundle

        return payload
    finally:
        with _run_lock:
            _active_runs -= 1


def get_optimize_lock_capabilities(
    scenario_path: Path,
    workspace: Path,
    *,
    schedule_path: Path | None = None,
) -> dict[str, Any]:
    scenario, _ = load_scenario_file(scenario_path, workspace)
    schedule = None
    if schedule_path:
        schedule, _ = load_schedule_file(schedule_path, workspace)
    return lock_capabilities(scenario, schedule)


def resolve_optimize_lock_effective(
    scenario_path: Path,
    workspace: Path,
    *,
    schedule_path: Path | None = None,
    lock_contract: OptimizeLockContract | None = None,
) -> dict[str, Any]:
    scenario, _ = load_scenario_file(scenario_path, workspace)
    schedule = None
    if schedule_path:
        schedule, _ = load_schedule_file(schedule_path, workspace)
    contract = lock_contract or OptimizeLockContract(lock_mode="legacy")
    try:
        contract = OptimizeLockContract.model_validate(contract.model_dump())
    except ValueError as exc:
        raise ServiceError("lock_contract_invalid", str(exc)) from exc
    validate_constraint_param_locks(contract, scenario, schedule)
    resolution = resolve_lock_state(contract, scenario, schedule)
    return {
        "effective_constraint_locks": resolution.effective_constraint_locks,
        "unlock_warnings": resolution.unlock_warnings,
        "shared_unlocked_constraint_ids": resolution.shared_unlocked_constraint_ids,
    }


def _lock_contract_meta(
    contract: OptimizeLockContract,
    scenario: Scenario,
    schedule: Schedule | None,
    *,
    scenario_lock_warning: str | None = None,
    tuned_constraint_params: dict[str, dict[str, int | float]] | None = None,
) -> dict[str, Any]:
    meta = contract.model_dump()
    meta["active"] = contract.active
    if scenario_lock_warning:
        meta["warning"] = scenario_lock_warning
    if contract.active:
        resolution = resolve_lock_state(contract, scenario, schedule)
        meta["effective"] = {
            "effective_constraint_locks": resolution.effective_constraint_locks,
            "unlock_warnings": resolution.unlock_warnings,
            "shared_unlocked_constraint_ids": resolution.shared_unlocked_constraint_ids,
        }
        if tuned_constraint_params:
            meta["effective"]["tuned_constraint_params"] = tuned_constraint_params
    return meta


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
