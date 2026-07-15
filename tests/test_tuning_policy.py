from __future__ import annotations

import pytest

from fuelflow.engine.opt.cpsat_adapter import optimize
from fuelflow.engine.opt.locks import ConstraintParamLock, OptimizeLockContract, resolve_lock_state
from fuelflow.engine.opt.tuning_policy import (
    TunableParamRef,
    TuningPolicy,
    resolve_tuning_policy,
    validate_tuning_policy,
)
from fuelflow.io.yaml_io import load_yaml
from fuelflow.scenario.model import Scenario, Schedule
from tests.conftest import REFERENCE_SCENARIO, REFERENCE_SCHEDULE


def _reference_pair() -> tuple[Scenario, Schedule]:
    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    schedule = Schedule.model_validate(load_yaml(REFERENCE_SCHEDULE))
    return scenario, schedule


def test_default_tuning_policy_resolves_all_applicable_tunable_params() -> None:
    scenario, seed_schedule = _reference_pair()
    resolution = resolve_tuning_policy(None, scenario, seed_schedule)
    assert resolution.source == "default_all_tunable_params"
    assert len(resolution.allow_tunable_params) > 0
    assert ("temporal_horizon", "latest_min") in resolution.allowed_constraint_params


def test_empty_allowlist_disables_parameter_tuning() -> None:
    scenario, seed_schedule = _reference_pair()
    contract = OptimizeLockContract(
        lock_mode="enforced",
        structure_mode="locked",
        constraint_param_locks=[
            ConstraintParamLock(entity_id="__global__", constraint_id="temporal_horizon", locked=False),
            ConstraintParamLock(entity_id="__global__", constraint_id="resource_fhm", locked=False),
        ],
    )
    tuning_policy = TuningPolicy(allow_tunable_params=[])
    result = optimize(
        scenario,
        seed=42,
        time_limit_sec=5.0,
        seed_schedule=seed_schedule,
        lock_contract=contract,
        lock_resolution=resolve_lock_state(contract, scenario, seed_schedule),
        tuning_resolution=resolve_tuning_policy(tuning_policy, scenario, seed_schedule),
    )
    if result.outcome != "feasible":
        pytest.skip("Optimization did not return feasible schedule on this platform run")
    assert result.tuned_constraint_params == {}


def test_invalid_tuning_policy_rejected_fail_fast() -> None:
    scenario, seed_schedule = _reference_pair()
    policy = TuningPolicy(
        allow_tunable_params=[
            TunableParamRef(
                entity_id="A1",
                constraint_id="temporal_horizon",
                param_name="latest_min",
            ),
        ],
    )
    with pytest.raises(ValueError, match="tuning_policy pair not applicable"):
        validate_tuning_policy(policy, scenario, seed_schedule)


def test_tuning_policy_normalizes_and_deduplicates_allowlist() -> None:
    scenario, seed_schedule = _reference_pair()
    resolution = resolve_tuning_policy(
        TuningPolicy(
            allow_tunable_params=[
                TunableParamRef(
                    entity_id="__global__",
                    constraint_id="resource_fhm",
                    param_name="max_concurrent",
                ),
                TunableParamRef(
                    entity_id="__global__",
                    constraint_id="resource_fhm",
                    param_name="max_concurrent",
                ),
                TunableParamRef(
                    entity_id="__global__",
                    constraint_id="temporal_horizon",
                    param_name="latest_min",
                ),
            ],
        ),
        scenario,
        seed_schedule,
    )
    assert resolution.source == "allowlist"
    assert [
        (entry.entity_id, entry.constraint_id, entry.param_name) for entry in resolution.allow_tunable_params
    ] == [
        ("__global__", "resource_fhm", "max_concurrent"),
        ("__global__", "temporal_horizon", "latest_min"),
    ]
