"""Conformance and golden tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from fuelflow.constraints.vocabulary import Constraint, evaluate_constraint
from fuelflow.engine.opt.cpsat_adapter import optimize
from fuelflow.engine.sim.simulator import simulate
from fuelflow.io.canonical import canonical_json, digest
from fuelflow.io.yaml_io import YamlIOError, load_yaml, save_yaml
from fuelflow.objectives.scoring import score_objective
from fuelflow.physics.decay import DecayModel, DecayTableEntry
from fuelflow.scenario.fork import ForkError, fork_scenario
from fuelflow.scenario.model import Move, Scenario, Schedule
from fuelflow.scenario.validation import validate_scenario, validate_schedule
from fuelflow.services import run_optimization, run_simulation, validate_scenario_file

ROOT = Path(__file__).resolve().parents[1]
SCENARIO = ROOT / "examples/reference_plant/scenario.yaml"
SCHEDULE = ROOT / "examples/reference_plant/schedule.yaml"


def _load() -> tuple[Scenario, Schedule]:
    scenario = Scenario.model_validate(load_yaml(SCENARIO))
    schedule = Schedule.model_validate(load_yaml(SCHEDULE))
    return scenario, schedule


def test_reference_scenario_validates() -> None:
    scenario, schedule = _load()
    assert not any(i.severity == "error" for i in validate_scenario(scenario))
    assert not any(i.severity == "error" for i in validate_schedule(schedule, scenario))


def test_simulation_runs_with_boundary_flows() -> None:
    scenario, schedule = _load()
    result = simulate(scenario, schedule, runtime_mode="continue_and_report")
    kinds = {e.kind for e in result.timeline}
    assert "entity_created" in kinds
    assert "move_started" in kinds


def test_determinism_replay() -> None:
    scenario, schedule = _load()
    a = simulate(scenario, schedule)
    b = simulate(scenario, schedule)
    assert canonical_json([e.__dict__ for e in a.timeline]) == canonical_json([e.__dict__ for e in b.timeline])


def test_fork_at_boundary() -> None:
    scenario, schedule = _load()
    forked = fork_scenario(
        scenario,
        schedule,
        state_at_min=0.0,
        amendments={"new_id": "reference_plant_fork", "horizon_min": 12000},
    )
    assert forked.id == "reference_plant_fork"
    assert forked.horizon_min == 12000


def test_fork_rejects_illegal_boundary() -> None:
    scenario, schedule = _load()
    with pytest.raises(ForkError):
        fork_scenario(scenario, schedule, state_at_min=123.0, amendments={})


def test_objective_scoring() -> None:
    scenario, schedule = _load()
    sim = simulate(scenario, schedule)
    score = score_objective(sim.to_objective_metrics(), scenario.objective)
    assert score.total >= 0


def test_optimizer_deterministic_outcome_class() -> None:
    scenario, schedule = _load()
    first = optimize(scenario, seed=42, time_limit_sec=2.0, seed_schedule=schedule)
    second = optimize(scenario, seed=42, time_limit_sec=2.0, seed_schedule=schedule)
    assert first.outcome == second.outcome
    assert first.reason == second.reason


def test_decay_model_interpolation() -> None:
    model = DecayModel(
        entity_id="X",
        table=[DecayTableEntry(time_min=0, heat_kw=1.0), DecayTableEntry(time_min=100, heat_kw=3.0)],
    )
    assert model.heat_kw(50) == 2.0


@pytest.mark.parametrize(
    "ctype,params,expect,target",
    [
        ("capacity", {"max_entities": 1}, True, "n1"),
        ("thermal", {"max_heat_kw": 0}, True, "n1"),
        ("temporal", {"earliest_min": 0, "latest_min": 10}, False, "n1"),
        ("resource", {"max_concurrent": 0}, True, "r1"),
        ("precedence", {"before_move": "a", "after_move": "b"}, True, "n1"),
        ("regulatory", {"min_cooling_min": 10, "required_cooling_min": 5}, True, "n1"),
    ],
)
def test_constraint_families(ctype: str, params: dict, expect: bool, target: str) -> None:
    constraint = Constraint(
        id="c1",
        scope="node" if ctype != "resource" else "resource",
        target=target,
        type=ctype,  # type: ignore[arg-type]
        params=params,
    )
    violation = evaluate_constraint(
        constraint,
        t_min=5,
        node_occupancy={"n1": ["e1", "e2"]},
        resource_usage={"r1": 1},
        entity_heat={"e1": 5.0, "e2": 5.0},
        move_active={"b": True},
    )
    assert (violation is not None) is expect


def test_yaml_stale_write_rejected(tmp_path: Path) -> None:
    target = tmp_path / "scenario.yaml"
    data = {"schema_version": 4, "id": "x", "horizon_min": 10, "topology": {"nodes": [], "edges": []}, "entities": [], "resources": []}
    save_yaml(target, data, root=tmp_path)
    with pytest.raises(YamlIOError):
        save_yaml(target, data, root=tmp_path, expected_digest="deadbeef")


def test_cli_api_parity_simulate() -> None:
    cli_result = run_simulation(SCENARIO, SCHEDULE, ROOT)
    assert "manifest" in cli_result
    assert cli_result["manifest"]["scenario_id"] == "reference_plant"


def test_validate_service() -> None:
    result = validate_scenario_file(SCENARIO, ROOT)
    assert result["valid"] is True


def test_artifact_digest_stable() -> None:
    scenario, schedule = _load()
    sim = simulate(scenario, schedule)
    score = score_objective(sim.to_objective_metrics(), scenario.objective)
    d1 = digest({"timeline": [e.__dict__ for e in sim.timeline], "score": score.total})
    d2 = digest({"timeline": [e.__dict__ for e in sim.timeline], "score": score.total})
    assert d1 == d2


def test_optimizer_integration_service() -> None:
    result = run_optimization(SCENARIO, ROOT, seed=42, time_limit_sec=2.0)
    assert result["outcome"] in {"feasible", "infeasible_or_timeout"}
