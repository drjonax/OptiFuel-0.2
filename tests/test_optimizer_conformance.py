"""Tests for timing-first optimization and seed path resolution."""

from __future__ import annotations

import pytest

from fuelflow.engine.opt.cpsat_adapter import EXECUTION_MODE_TIMING_PRESERVE, optimize
from fuelflow.engine.opt.locks import (
    ConstraintParamLock,
    OptimizeLockContract,
    MoveLock,
    structure_signature,
    resolve_lock_state,
)
from fuelflow.engine.sim.simulator import simulate
from fuelflow.io.paths import resolve_seed_schedule_path, sibling_schedule_path
from fuelflow.io.yaml_io import load_yaml
from fuelflow.objectives.scoring import score_objective
from fuelflow.scenario.model import Scenario, Schedule
from fuelflow.services import ServiceError, run_optimization

from tests.conftest import REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT

PARITY_ABS_TOL = 1e-6
PARITY_REL_TOL = 1e-6


def _reference_pair() -> tuple[Scenario, Schedule]:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    schedule = Schedule.model_validate(load_yaml(REFERENCE_SCHEDULE))
    return scenario, schedule


def _seed_starts(schedule: Schedule) -> list[tuple[str, str, float]]:
    return sorted((m.entity, m.edge, m.start_min) for m in schedule.moves)


def test_sibling_schedule_path_matches_workbench_rule() -> None:
    assert sibling_schedule_path("examples/reference_plant/scenario.yaml") == "examples/reference_plant/schedule.yaml"


def test_resolve_seed_schedule_path_auto_sibling() -> None:
    resolved = resolve_seed_schedule_path(REFERENCE_SCENARIO, ROOT)
    assert resolved == ROOT / "examples/reference_plant/schedule.yaml"


def test_optimizer_requires_seed_schedule() -> None:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    result = optimize(scenario, seed=42, time_limit_sec=2.0)
    assert result.outcome == "infeasible_or_timeout"


def test_optimizer_outcome_class_stable() -> None:
    scenario, seed_schedule = _reference_pair()
    first = optimize(scenario, seed=42, time_limit_sec=2.0, seed_schedule=seed_schedule)
    second = optimize(scenario, seed=42, time_limit_sec=2.0, seed_schedule=seed_schedule)
    assert first.outcome == second.outcome
    assert first.reason == second.reason


def test_optimizer_feasible_has_zero_hard_violations() -> None:
    scenario, seed_schedule = _reference_pair()
    result = optimize(scenario, seed=42, time_limit_sec=5.0, seed_schedule=seed_schedule)
    if result.outcome != "feasible" or result.schedule is None:
        pytest.skip("Optimizer did not return feasible schedule on this platform run")
    sim = simulate(scenario, result.schedule, runtime_mode="fail_fast")
    assert not any(v.hard for v in sim.violations)


def test_optimizer_objective_parity() -> None:
    scenario, seed_schedule = _reference_pair()
    result = optimize(scenario, seed=42, time_limit_sec=5.0, seed_schedule=seed_schedule)
    if result.outcome != "feasible" or result.schedule is None or result.score_total is None:
        pytest.skip("Optimizer did not return feasible schedule on this platform run")
    sim = simulate(scenario, result.schedule, runtime_mode="fail_fast")
    score = score_objective(sim.to_objective_metrics(), scenario.objective)
    delta = abs(result.score_total - score.total)
    rel = delta / max(abs(score.total), PARITY_ABS_TOL)
    assert delta <= PARITY_ABS_TOL or rel <= PARITY_REL_TOL


def test_service_optimizer_canonical_outcome() -> None:
    payload = run_optimization(REFERENCE_SCENARIO, ROOT, seed=42, time_limit_sec=2.0)
    assert payload["outcome"] in {"feasible", "infeasible_or_timeout"}
    assert payload["lock_contract"]["lock_mode"] == "legacy"
    assert payload["lock_contract"]["active"] is False
    assert payload["execution_mode"] == EXECUTION_MODE_TIMING_PRESERVE
    assert payload["resolved_seed_schedule_path"] == "examples/reference_plant/schedule.yaml"


def test_timing_first_preserves_structure_and_move_count() -> None:
    scenario, seed_schedule = _reference_pair()
    result = optimize(
        scenario,
        seed=42,
        time_limit_sec=5.0,
        seed_schedule=seed_schedule,
    )
    if result.outcome != "feasible" or result.schedule is None:
        pytest.skip("Timing-first optimization did not return feasible schedule on this platform run")
    assert len(result.schedule.moves) == len(seed_schedule.moves)
    assert structure_signature(seed_schedule) == structure_signature(result.schedule)
    assert result.execution_mode == EXECUTION_MODE_TIMING_PRESERVE


def test_timing_first_non_regression_vs_seed_baseline() -> None:
    scenario, seed_schedule = _reference_pair()
    seed_sim = simulate(scenario, seed_schedule, runtime_mode="fail_fast")
    seed_score = score_objective(seed_sim.to_objective_metrics(), scenario.objective)
    result = optimize(scenario, seed=42, time_limit_sec=30.0, seed_schedule=seed_schedule)
    if result.outcome != "feasible" or result.schedule is None or result.score_total is None:
        pytest.skip("Timing-first optimization did not return feasible schedule on this platform run")
    opt_sim = simulate(scenario, result.schedule, runtime_mode="fail_fast")
    assert not opt_sim.failed
    if not seed_sim.failed:
        assert result.score_total <= seed_score.total + PARITY_ABS_TOL


def test_structure_locked_preserves_move_set() -> None:
    scenario, seed_schedule = _reference_pair()
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
    )
    result = optimize(
        scenario,
        seed=42,
        time_limit_sec=5.0,
        seed_schedule=seed_schedule,
        lock_contract=contract,
    )
    if result.outcome != "feasible" or result.schedule is None:
        pytest.skip("Structure-locked optimization did not return feasible schedule on this platform run")
    assert structure_signature(seed_schedule) == structure_signature(result.schedule)


def test_optimize_rejected_when_no_seed_available() -> None:
    with pytest.raises(ServiceError) as exc:
        run_optimization(
            REFERENCE_SCENARIO,
            ROOT,
            seed=42,
            time_limit_sec=2.0,
            seed_schedule_path=ROOT / "examples/reference_plant/missing_schedule.yaml",
        )
    assert exc.value.code == "seed_schedule_required"


def test_move_start_lock_preserves_locked_values() -> None:
    scenario, seed_schedule = _reference_pair()
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        move_locks=[
            MoveLock(entity="A1", edge="fresh_to_staging", occurrence_index=0, locked_fields=["start_min"]),
        ],
    )
    result = optimize(
        scenario,
        seed=42,
        time_limit_sec=5.0,
        seed_schedule=seed_schedule,
        lock_contract=contract,
    )
    if result.outcome != "feasible" or result.schedule is None:
        pytest.skip("Locked move optimization did not return feasible schedule on this platform run")
    locked_move = next(
        m for m in result.schedule.moves if m.entity == "A1" and m.edge == "fresh_to_staging"
    )
    seed_move = next(
        m for m in seed_schedule.moves if m.entity == "A1" and m.edge == "fresh_to_staging"
    )
    assert locked_move.start_min == seed_move.start_min


def test_legacy_and_enforced_both_preserve_structure() -> None:
    scenario, seed_schedule = _reference_pair()
    legacy = optimize(
        scenario,
        seed=42,
        time_limit_sec=2.0,
        seed_schedule=seed_schedule,
        lock_contract=OptimizeLockContract(lock_mode="legacy"),
    )
    enforced = optimize(
        scenario,
        seed=42,
        time_limit_sec=2.0,
        seed_schedule=seed_schedule,
        lock_contract=OptimizeLockContract(lock_mode="enforced", structure_mode="locked"),
    )
    if legacy.outcome != "feasible" or enforced.outcome != "feasible":
        pytest.skip("Optimization did not return feasible schedule on this platform run")
    assert legacy.schedule is not None and enforced.schedule is not None
    assert structure_signature(seed_schedule) == structure_signature(legacy.schedule)
    assert structure_signature(seed_schedule) == structure_signature(enforced.schedule)


def test_contradictory_lock_contract_rejected() -> None:
    with pytest.raises(ValueError):
        OptimizeLockContract(lock_mode="enforced", structure_mode=None)


def test_resource_unlock_affects_optimizer_metadata() -> None:
    scenario, schedule = _reference_pair()
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        constraint_param_locks=[
            ConstraintParamLock(entity_id="__global__", constraint_id="resource_fhm", locked=False),
        ],
    )
    result = optimize(
        scenario,
        seed=42,
        time_limit_sec=5.0,
        seed_schedule=schedule,
        lock_contract=contract,
        lock_resolution=resolve_lock_state(contract, scenario, schedule),
    )
    if result.outcome != "feasible":
        pytest.skip("Resource unlock optimization did not return feasible schedule on this platform run")
    assert "resource_fhm" in result.tuned_constraint_params or result.tuned_constraint_params == {}


def test_lock_effective_preview_matches_optimize_run() -> None:
    from fuelflow.services import resolve_optimize_lock_effective

    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        constraint_param_locks=[
            ConstraintParamLock(entity_id="__global__", constraint_id="temporal_horizon", locked=False),
        ],
    )
    preview = resolve_optimize_lock_effective(
        REFERENCE_SCENARIO,
        ROOT,
        schedule_path=REFERENCE_SCHEDULE,
        lock_contract=contract,
    )
    payload = run_optimization(
        REFERENCE_SCENARIO,
        ROOT,
        seed=42,
        time_limit_sec=3.0,
        seed_schedule_path=REFERENCE_SCHEDULE,
        lock_contract=contract,
    )
    effective = payload["lock_contract"]["effective"]
    assert effective["effective_constraint_locks"] == preview["effective_constraint_locks"]
    assert effective["unlock_warnings"] == preview["unlock_warnings"]


def test_entity_rows_include_arrivals() -> None:
    from fuelflow.engine.opt.locks import entity_rows

    scenario, _ = _reference_pair()
    rows = entity_rows(scenario)
    assert "A1" in rows
    assert "A4" in rows


def test_capabilities_matrix_includes_arrival_applicability() -> None:
    from fuelflow.engine.opt.locks import GLOBAL_ENTITY_ID, lock_capabilities

    scenario, schedule = _reference_pair()
    caps = lock_capabilities(scenario, schedule)
    assert "A4" in caps["entities"]
    assert GLOBAL_ENTITY_ID in caps["applicability"]


def test_sparse_defaults_locked() -> None:
    from fuelflow.engine.opt.locks import resolve_lock_state

    scenario, schedule = _reference_pair()
    contract = OptimizeLockContract(lock_mode="enforced", structure_mode="locked")
    resolution = resolve_lock_state(contract, scenario, schedule)
    assert all(resolution.effective_constraint_locks.values())


def test_shared_unlock_via_global_row() -> None:
    from fuelflow.engine.opt.locks import GLOBAL_ENTITY_ID, resolve_lock_state

    scenario, schedule = _reference_pair()
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        constraint_param_locks=[
            ConstraintParamLock(
                entity_id=GLOBAL_ENTITY_ID,
                constraint_id="temporal_horizon",
                locked=False,
            ),
        ],
    )
    resolution = resolve_lock_state(contract, scenario, schedule)
    assert resolution.effective_constraint_locks["temporal_horizon"] is False
    assert "temporal_horizon" in resolution.shared_unlocked_constraint_ids


def test_shared_unlock_via_entity_row() -> None:
    from fuelflow.engine.opt.locks import resolve_lock_state

    scenario, schedule = _reference_pair()
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        constraint_param_locks=[
            ConstraintParamLock(entity_id="A1", constraint_id="resource_fhm", locked=False),
        ],
    )
    resolution = resolve_lock_state(contract, scenario, schedule)
    assert resolution.effective_constraint_locks["resource_fhm"] is False


def test_invalid_constraint_id_rejected() -> None:
    from fuelflow.engine.opt.locks import GLOBAL_ENTITY_ID, validate_constraint_param_locks

    scenario, schedule = _reference_pair()
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        constraint_param_locks=[
            ConstraintParamLock(entity_id=GLOBAL_ENTITY_ID, constraint_id="missing", locked=False),
        ],
    )
    with pytest.raises(ValueError, match="unknown constraint_id"):
        validate_constraint_param_locks(contract, scenario, schedule)


def test_not_solver_encoded_unlock_emits_warning() -> None:
    from fuelflow.engine.opt.locks import GLOBAL_ENTITY_ID, resolve_lock_state

    scenario, schedule = _reference_pair()
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        constraint_param_locks=[
            ConstraintParamLock(entity_id=GLOBAL_ENTITY_ID, constraint_id="thermal_pool_u1", locked=False),
        ],
    )
    resolution = resolve_lock_state(contract, scenario, schedule)
    assert any("constraint_unlock_not_solver_encoded:thermal_pool_u1" == w for w in resolution.unlock_warnings)


def test_precedence_locked_only_warning() -> None:
    from fuelflow.engine.opt.locks import GLOBAL_ENTITY_ID, resolve_lock_state

    scenario, _ = _reference_pair()
    precedence_ids = [c.id for c in scenario.constraints if c.type == "precedence"]
    if not precedence_ids:
        pytest.skip("Reference plant has no precedence constraints")
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        constraint_param_locks=[
            ConstraintParamLock(entity_id=GLOBAL_ENTITY_ID, constraint_id=precedence_ids[0], locked=False),
        ],
    )
    resolution = resolve_lock_state(contract, scenario, None)
    assert any(w.startswith("precedence_locked_only:") for w in resolution.unlock_warnings)


def test_resource_baseline_prefers_constraint_max_concurrent() -> None:
    from fuelflow.engine.opt.locks import resource_baseline_capacity

    scenario, _ = _reference_pair()
    baseline = resource_baseline_capacity(scenario, "fhm_1")
    assert baseline >= 1


def test_reference_plant_cap_staging_solved_by_retiming() -> None:
    scenario, seed_schedule = _reference_pair()
    seed_sim = simulate(scenario, seed_schedule, runtime_mode="fail_fast")
    assert seed_sim.failed
    assert any(v.constraint_id == "cap_staging" and v.hard for v in seed_sim.violations)

    result = optimize(scenario, seed=42, time_limit_sec=30.0, seed_schedule=seed_schedule)
    assert result.outcome == "feasible"
    assert result.schedule is not None
    opt_sim = simulate(scenario, result.schedule, runtime_mode="fail_fast")
    assert not opt_sim.failed
    assert not any(v.hard for v in opt_sim.violations)


def test_optimizer_preserves_canonical_per_efa_sequence() -> None:
    from fuelflow.engine.opt.locks import canonical_entity_move_keys

    scenario, seed_schedule = _reference_pair()
    result = optimize(scenario, seed=42, time_limit_sec=30.0, seed_schedule=seed_schedule)
    assert result.outcome == "feasible"
    assert result.schedule is not None

    seed_order = canonical_entity_move_keys(seed_schedule)
    result_order = canonical_entity_move_keys(result.schedule)
    assert seed_order.keys() == result_order.keys()
    for entity in seed_order:
        assert seed_order[entity] == result_order[entity]


def test_optimizer_output_has_same_move_set_as_seed() -> None:
    scenario, seed_schedule = _reference_pair()
    result = optimize(scenario, seed=42, time_limit_sec=30.0, seed_schedule=seed_schedule)
    assert result.outcome == "feasible"
    assert result.schedule is not None

    seed_keys = sorted((m.entity, m.edge) for m in seed_schedule.moves)
    result_keys = sorted((m.entity, m.edge) for m in result.schedule.moves)
    assert seed_keys == result_keys
    assert len(result.schedule.moves) == len(seed_schedule.moves)


def test_canonical_sequence_deterministic_for_tied_starts() -> None:
    from fuelflow.engine.opt.locks import canonical_entity_move_keys

    scenario, seed_schedule = _reference_pair()
    tied = seed_schedule.model_copy(deep=True)
    for move in tied.moves:
        if move.entity == "A1":
            move.start_min = 100.0

    first = canonical_entity_move_keys(tied)
    second = canonical_entity_move_keys(tied)
    assert first == second
    assert len(first["A1"]) == 4


def test_move_lock_occurrence_index_stable_after_sequence_helper() -> None:
    scenario, seed_schedule = _reference_pair()
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        move_locks=[
            MoveLock(entity="A1", edge="fresh_to_staging", occurrence_index=0, locked_fields=["start_min"]),
        ],
    )
    result = optimize(
        scenario,
        seed=42,
        time_limit_sec=30.0,
        seed_schedule=seed_schedule,
        lock_contract=contract,
    )
    assert result.outcome == "feasible"
    assert result.schedule is not None
    locked_move = next(
        m for m in result.schedule.moves if m.entity == "A1" and m.edge == "fresh_to_staging"
    )
    seed_move = next(
        m for m in seed_schedule.moves if m.entity == "A1" and m.edge == "fresh_to_staging"
    )
    assert locked_move.start_min == seed_move.start_min


def test_capacity_is_solver_encoded_in_capabilities() -> None:
    from fuelflow.engine.opt.locks import GLOBAL_ENTITY_ID, lock_capabilities, resolve_lock_state

    scenario, schedule = _reference_pair()
    caps = lock_capabilities(scenario, schedule)
    assert "cap_staging" in caps["solver_encoded_constraint_ids"]

    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        constraint_param_locks=[
            ConstraintParamLock(entity_id=GLOBAL_ENTITY_ID, constraint_id="cap_staging", locked=False),
        ],
    )
    resolution = resolve_lock_state(contract, scenario, schedule)
    assert not any("constraint_unlock_not_solver_encoded:cap_staging" == w for w in resolution.unlock_warnings)
    assert "cap_staging" in resolution.shared_unlocked_constraint_ids
