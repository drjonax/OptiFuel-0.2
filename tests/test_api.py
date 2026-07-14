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


def test_optimize_endpoint() -> None:
    response = client.post(
        "/runs/optimize",
        json={"scenario_path": SCENARIO, "seed": 42, "time_limit_sec": 2.0},
    )
    assert response.status_code == 200
    assert response.json()["outcome"] in {"feasible", "infeasible_or_timeout"}


def test_fork_endpoint() -> None:
    response = client.post(
        "/scenarios/fork",
        json={
            "scenario_path": SCENARIO,
            "schedule_path": SCHEDULE,
            "state_at_min": 0.0,
            "amendments": {"new_id": "api_fork_test", "horizon_min": 11000},
            "output_path": "examples/reference_plant/api_fork_test.yaml",
        },
    )
    assert response.status_code == 200
    assert response.json()["scenario_id"] == "api_fork_test"
    forked = WORKSPACE / "examples/reference_plant/api_fork_test.yaml"
    assert forked.exists()


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
