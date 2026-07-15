"""FastAPI integration and API/CLI parity tests."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from fuelflow.api.app import WORKSPACE, app
from fuelflow.services import run_simulation

client = TestClient(app)
SCENARIO = "examples/reference_plant/scenario.yaml"
SCHEDULE = "examples/reference_plant/schedule.yaml"


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["release"] == "v1-alpha"


def test_list_and_get_scenario() -> None:
    response = client.get("/scenarios")
    assert response.status_code == 200
    assert SCENARIO in response.json()

    detail = client.get(f"/scenarios/{SCENARIO}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["data"]["id"] == "reference_plant"
    assert "digest" in body
    assert body["etag"] == body["digest"]


def test_validate_scenario() -> None:
    response = client.post(f"/scenarios/{SCENARIO}/validate")
    assert response.status_code == 200
    assert response.json()["valid"] is True


def test_simulate_endpoint() -> None:
    response = client.post(
        "/runs/simulate",
        json={
            "scenario_path": SCENARIO,
            "schedule_path": SCHEDULE,
            "runtime_mode": "fail_fast",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert "manifest" in body
    assert body["manifest"]["scenario_id"] == "reference_plant"
    assert body["outcome"] in {"feasible", "infeasible_or_timeout"}
    assert "reason" in body
    assert "infeasible_category" in body
    assert "timeline" in body
    assert "violations" in body
    assert "objective" in body


def test_optimize_endpoint() -> None:
    response = client.post(
        "/runs/optimize",
        json={"scenario_path": SCENARIO, "seed": 42, "time_limit_sec": 2.0},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["outcome"] in {"feasible", "infeasible_or_timeout"}
    assert body["lock_contract"]["lock_mode"] == "legacy"
    assert body["execution_mode"] == "timing_preserve_structure"
    assert body["resolved_seed_schedule_path"] == SCHEDULE


def test_optimize_auto_seeds_from_sibling() -> None:
    response = client.post(
        "/runs/optimize",
        json={"scenario_path": SCENARIO, "seed": 42, "time_limit_sec": 2.0},
    )
    assert response.status_code == 200
    assert response.json()["resolved_seed_schedule_path"] == SCHEDULE


def test_optimize_rejected_when_no_seed_available() -> None:
    response = client.post(
        "/runs/optimize",
        json={
            "scenario_path": SCENARIO,
            "seed_schedule_path": "examples/reference_plant/missing_schedule.yaml",
            "seed": 42,
            "time_limit_sec": 2.0,
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "seed_schedule_required"


def test_optimize_capabilities_endpoint() -> None:
    response = client.get("/runs/optimize/capabilities")
    assert response.status_code == 200
    body = response.json()
    assert body["scenario_tunable_active"] is False
    assert "horizon_min" in body["allowlisted_scenario_paths"]


def test_optimize_capabilities_with_scenario_paths() -> None:
    response = client.get(
        "/runs/optimize/capabilities",
        params={"scenario_path": SCENARIO, "schedule_path": SCHEDULE},
    )
    assert response.status_code == 200
    body = response.json()
    assert "A1" in body["entities"]
    assert "A2" in body["entities"]
    assert body["global_entity_id"] == "__global__"
    assert "temporal_horizon" in {c["id"] for c in body["constraints"]}


def test_optimize_lock_effective_endpoint() -> None:
    response = client.post(
        "/runs/optimize/locks/effective",
        json={
            "scenario_path": SCENARIO,
            "schedule_path": SCHEDULE,
            "lock_mode": "enforced",
            "structure_mode": "locked",
            "constraint_param_locks": [
                {"entity_id": "__global__", "constraint_id": "temporal_horizon", "locked": False},
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["effective_constraint_locks"]["temporal_horizon"] is False
    assert "temporal_horizon" in body["shared_unlocked_constraint_ids"]


def test_optimize_lock_effective_invalid_pair_rejected() -> None:
    response = client.post(
        "/runs/optimize/locks/effective",
        json={
            "scenario_path": SCENARIO,
            "schedule_path": SCHEDULE,
            "lock_mode": "enforced",
            "structure_mode": "locked",
            "constraint_param_locks": [
                {"entity_id": "__global__", "constraint_id": "not_a_constraint", "locked": False},
            ],
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "lock_contract_invalid"


def test_optimize_enforced_locked_roundtrip() -> None:
    response = client.post(
        "/runs/optimize",
        json={
            "scenario_path": SCENARIO,
            "seed_schedule_path": SCHEDULE,
            "seed": 42,
            "time_limit_sec": 3.0,
            "lock_mode": "enforced",
            "structure_mode": "locked",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["lock_contract"]["active"] is True
    assert body["lock_contract"]["structure_mode"] == "locked"


def test_optimize_enforced_locked_without_explicit_seed_uses_sibling() -> None:
    response = client.post(
        "/runs/optimize",
        json={
            "scenario_path": SCENARIO,
            "lock_mode": "enforced",
            "structure_mode": "locked",
            "seed": 42,
            "time_limit_sec": 3.0,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["resolved_seed_schedule_path"] == SCHEDULE
    assert body["execution_mode"] == "timing_preserve_structure"


def test_optimize_invalid_lock_contract_rejected() -> None:
    response = client.post(
        "/runs/optimize",
        json={
            "scenario_path": SCENARIO,
            "lock_mode": "enforced",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "lock_contract_invalid"


def test_optimize_scenario_lock_warning() -> None:
    response = client.post(
        "/runs/optimize",
        json={
            "scenario_path": SCENARIO,
            "seed_schedule_path": SCHEDULE,
            "lock_mode": "enforced",
            "structure_mode": "locked",
            "scenario_locks": ["horizon_min"],
        },
    )
    assert response.status_code == 200
    assert response.json()["lock_contract"].get("warning") == "scenario_locks_not_applied"


def test_api_cli_simulate_parity() -> None:
    api = client.post(
        "/runs/simulate",
        json={
            "scenario_path": SCENARIO,
            "schedule_path": SCHEDULE,
            "runtime_mode": "fail_fast",
        },
    ).json()
    cli = run_simulation(WORKSPACE / SCENARIO, WORKSPACE / SCHEDULE, WORKSPACE)
    assert api["manifest"]["scenario_id"] == cli["manifest"]["scenario_id"]
    assert api["manifest"]["failed"] == cli["manifest"]["failed"]


def test_stale_scenario_save_rejected() -> None:
    current = client.get(f"/scenarios/{SCENARIO}").json()
    payload = current["data"]
    response = client.put(
        f"/scenarios/{SCENARIO}",
        headers={"If-Match": "deadbeef"},
        json={"data": payload},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "stale_write"


def test_schedule_roundtrip_with_etag() -> None:
    current = client.get(f"/schedules/{SCHEDULE}").json()
    response = client.put(
        f"/schedules/{SCHEDULE}",
        headers={"If-Match": current["etag"]},
        json={"data": current["data"]},
    )
    assert response.status_code == 200
    assert "digest" in response.json()
