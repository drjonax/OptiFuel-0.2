"""Contract freeze snapshots for API envelopes."""

from __future__ import annotations

import json
from pathlib import Path

from fuelflow.api.app import app

SNAPSHOT = Path(__file__).resolve().parent / "snapshots" / "openapi.json"

REQUIRED_PATHS = {
    "/health",
    "/scenarios",
    "/scenarios/{scenario_id}",
    "/schedules/{schedule_id}",
    "/runs/simulate",
    "/runs/optimize",
    "/scenarios/fork",
}


def test_openapi_contract_snapshot() -> None:
    schema = app.openapi()
    paths = set(schema.get("paths", {}).keys())
    assert REQUIRED_PATHS.issubset(paths)

    if not SNAPSHOT.exists():
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(json.dumps(schema, indent=2, sort_keys=True), encoding="utf-8")

    stored = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert set(stored.get("paths", {}).keys()) == paths
    assert stored["info"]["title"] == schema["info"]["title"]
