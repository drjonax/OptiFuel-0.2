"""Persistence, guardrails, and adversarial I/O tests."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from fuelflow.io.yaml_io import YamlIOError, cleanup_orphan_temps, load_yaml, save_yaml
from fuelflow.services import MAX_HORIZON_MIN, ServiceError, run_simulation, save_scenario, startup_cleanup
from fuelflow.io.canonical import digest

from tests.conftest import REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT


def test_path_escape_rejected(tmp_path: Path) -> None:
    with pytest.raises(YamlIOError) as exc:
        save_yaml(tmp_path / ".." / "escaped.yaml", {"id": "x"}, root=tmp_path)
    assert exc.value.code == "path_escape"


def test_symlink_target_rejected(tmp_path: Path) -> None:
    real = tmp_path / "real.yaml"
    real.write_text("id: x\n", encoding="utf-8")
    link = tmp_path / "link.yaml"
    link.symlink_to(real)
    with pytest.raises(YamlIOError) as exc:
        load_yaml(link)
    assert exc.value.code == "symlink_rejected"


def test_stale_write_rejected(tmp_path: Path) -> None:
    target = tmp_path / "scenario.yaml"
    data = {"schema_version": 4, "id": "x", "horizon_min": 10, "topology": {"nodes": [], "edges": []}, "entities": [], "resources": []}
    save_yaml(target, data, root=tmp_path)
    with pytest.raises(YamlIOError) as exc:
        save_yaml(target, data, root=tmp_path, expected_digest="deadbeef")
    assert exc.value.code == "stale_write"


def test_concurrent_stale_write_one_wins(tmp_path: Path) -> None:
    target = tmp_path / "scenario.yaml"
    data_v1 = {"schema_version": 4, "id": "x", "horizon_min": 10, "topology": {"nodes": [], "edges": []}, "entities": [], "resources": []}
    etag = save_yaml(target, data_v1, root=tmp_path)

    save_yaml(target, {**data_v1, "horizon_min": 11}, root=tmp_path, expected_digest=etag)
    with pytest.raises(YamlIOError) as exc:
        save_yaml(target, {**data_v1, "horizon_min": 12}, root=tmp_path, expected_digest=etag)
    assert exc.value.code == "stale_write"


def test_orphan_temp_cleanup(tmp_path: Path) -> None:
    orphan = tmp_path / "orphan.tmp"
    orphan.write_text("partial", encoding="utf-8")
    removed = cleanup_orphan_temps(tmp_path)
    assert removed >= 1
    assert not orphan.exists()


def test_startup_cleanup_service(tmp_path: Path) -> None:
    (tmp_path / "leftover.tmp").write_text("x", encoding="utf-8")
    assert startup_cleanup(tmp_path) >= 1


def test_horizon_guardrail_rejected(tmp_path: Path) -> None:
    scenario_path = tmp_path / "big_horizon.yaml"
    scenario_path.write_text(
        f"schema_version: 4\nid: big\nhorizon_min: {MAX_HORIZON_MIN + 1}\ntopology:\n  nodes: []\n  edges: []\nentities: []\nresources: []\n",
        encoding="utf-8",
    )
    with pytest.raises(ServiceError) as exc:
        run_simulation(scenario_path, REFERENCE_SCHEDULE, tmp_path)
    assert exc.value.code == "horizon_limit"


def test_queue_limit_guardrail(monkeypatch: pytest.MonkeyPatch) -> None:
    import fuelflow.services as services

    monkeypatch.setattr(services, "_active_runs", services.MAX_CONCURRENT_RUNS)
    with pytest.raises(ServiceError) as exc:
        run_simulation(REFERENCE_SCENARIO, REFERENCE_SCHEDULE, ROOT)
    assert exc.value.code == "queue_limit"


def test_save_scenario_validation_failure(tmp_path: Path) -> None:
    bad = {
        "schema_version": 3,
        "id": "bad",
        "horizon_min": 10,
        "topology": {"nodes": [], "edges": []},
        "entities": [],
        "resources": [],
    }
    with pytest.raises(ServiceError) as exc:
        save_scenario(tmp_path / "bad.yaml", bad, tmp_path)
    assert exc.value.code == "validation_failed"
